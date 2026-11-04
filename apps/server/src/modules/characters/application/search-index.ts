/**
 * 站内搜索：官方角色与本人角色的名称 / 别名投影（T-20261104b，迁移 0157，契约 CharacterSearchPort）。
 *
 * 写投影：数据库触发器在 characters.characters 相关列变化时登记 search_dirty（与业务写入同一事务），
 * 这里按批刷新——每分钟定时任务 + 每次搜索前顺手刷一小批。每个角色一个短事务，加锁一律 SKIP LOCKED：
 *   1. 角色行 FOR KEY SHARE SKIP LOCKED（正在被删除就跳过，删除会级联清掉投影与登记）；
 *   2. 登记行 FOR UPDATE SKIP LOCKED 且 version 未变（被重新登记或别的刷新者在处理就跳过，下一轮再来）；
 *   3. 删旧投影、写新投影、删登记。
 * 刷新者从不等待业务事务持有的锁，业务写入最多等一个刷新短事务提交，不会互等（T-20261104c 教训）。
 * 投影内容（加解密、拼音）在事务外算好，事务里只有几条写入。
 *
 * 资格：官方 = 预设且已上架（下架 / 停用 / 草稿都不进）；本人 = 非试聊自定义角色，只按 owner 查。
 * 查询时仍 JOIN characters 再核一次，所以刷新前的旧投影也不会让下架角色出现在结果里。
 * 投影只存名字、经审核别名、关键词（代表作品、后台检索词、旧卡签名）与拼音，以及一句身份说明。
 *
 * 5.6（T-20261104e）：官方角色再叠加后台人工修正（SearchEntityService）：已通过的搜索别名进投影、
 * 被去掉的人设别名 / 关键词不进投影、关联实体的核实身份说明优先，并带上实体键与第一条出处。
 * 这些修正表的写入由 0158 的触发器登记待刷新，走同一套刷新。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import {
  CharacterSummary,
  type CharacterSearchCard,
  type CharacterSearchEntity,
  type CharacterSearchNameHit,
  type CharacterSearchPort,
  type CharacterSearchTypoHit,
  type SiteSearchTextQuery,
} from '@weiban/contracts';
import {
  DATABASE,
  JOB_QUEUE,
  LOGGER,
  escapeLikePattern,
  scoreTerm,
  searchKey,
  termRecord,
  typoKind,
  uniqueTerms,
  type Database,
  type JobQueue,
  type Logger,
  type SearchTermKind,
} from '../../../platform/index.js';
import { legacyDisplayName } from '../domain/legacy-admin.js';
import { parseLegacyCard } from '../domain/legacy-card.js';
import { legacyIdentity, officialIdentity, ownIdentity } from '../domain/search-identity.js';
import { characters, searchDirty, searchTerms } from '../infra/db/schema.js';
import { CharacterService } from './characters.js';
import { SearchEntityService, type SearchProjectionInput } from './search-entities.js';

type CharacterRow = typeof characters.$inferSelect;
type TermInsert = typeof searchTerms.$inferInsert;
type ProjectedKind = 'name' | 'alias' | 'keyword';

export const CHARACTER_SEARCH_REFRESH_JOB = 'characters.refresh_search_index';
/** 每次搜索前顺手刷新的条数（通常为 0；后台改名 / 上架后第一次搜索就能看到）。 */
export const SEARCH_INLINE_REFRESH = 50;
/** 定时任务一轮最多刷新的条数（每批 100 条）。 */
const SEARCH_JOB_REFRESH = 5000;
const SEARCH_BATCH = 100;
/** 一个角色最多写多少个词条（名字 + 别名 + 关键词）。 */
const MAX_TERMS = 40;
/** 候选上限：先取这么多词条，再在内存里打分去重。 */
const MATCH_ROWS = 600;
const MATCH_CHARACTERS = 400;
const TYPO_ROWS = 300;

interface TermRow {
  character_id: string;
  term_key: string;
  term: string;
  kind: ProjectedKind;
  pinyin: string;
  initials: string;
  scope: 'official' | 'own';
  display_name: string;
  identity: string | null;
  entity_key: string | null;
  source_url: string | null;
}

/** 两种可见范围的资格条件（t = 投影，c = 角色表；$1 = 当前用户）。 */
const VISIBLE = `(
  (t.scope = 'official' AND c.kind = 'preset' AND c.status = 'published')
  OR (t.scope = 'own' AND t.owner_id = $1 AND c.kind = 'custom' AND c.owner_id = $1 AND NOT c.is_trial)
)`;
const SELECT_TERMS = `SELECT t.character_id, t.term_key, t.term, t.kind, t.pinyin, t.initials, t.scope,
  t.display_name, t.identity, t.entity_key, t.source_url
FROM characters.search_terms t JOIN characters.characters c ON c.id = t.character_id`;

@Injectable()
export class CharacterSearchIndex implements CharacterSearchPort, OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CharacterService) private readonly characterService: CharacterService,
    @Inject(SearchEntityService) private readonly entities: SearchEntityService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work(CHARACTER_SEARCH_REFRESH_JOB, async () => {
      await this.refresh(SEARCH_JOB_REFRESH);
    });
    await this.jobs.schedule(CHARACTER_SEARCH_REFRESH_JOB, '* * * * *');
  }

  // ---------- 刷新投影 ----------

  /** 按登记先后刷新最多 limit 个角色；返回实际刷新数。失败的留在登记表，下一轮再试。 */
  async refresh(limit: number): Promise<number> {
    let done = 0;
    while (done < limit) {
      const batch = await this.database.db
        .select()
        .from(searchDirty)
        .orderBy(asc(searchDirty.markedAt), asc(searchDirty.characterId))
        .limit(Math.min(SEARCH_BATCH, limit - done));
      if (!batch.length) break;
      let progressed = 0;
      for (const entry of batch) {
        try {
          if (await this.refreshOne(entry.characterId, entry.version)) progressed++;
        } catch (error) {
          this.logger.warn(
            { err: error, characterId: entry.characterId },
            '站内搜索投影刷新失败，下一轮重试',
          );
        }
      }
      done += progressed;
      // 整批都被别人锁着 / 版本变了：留给下一轮，避免空转。
      if (!progressed || batch.length < SEARCH_BATCH) break;
    }
    return done;
  }

  private async refreshOne(characterId: string, version: number): Promise<boolean> {
    const [row] = await this.database.db
      .select()
      .from(characters)
      .where(eq(characters.id, characterId));
    const terms = row ? await this.project(row) : [];
    return this.database.transaction(async (tx) => {
      const alive = await tx.query(
        'SELECT 1 FROM characters.characters WHERE id = $1 FOR KEY SHARE SKIP LOCKED',
        [characterId],
      );
      if (!alive.rowCount) {
        // 角色已删除（登记随外键级联删除）或正在被删除：都不用再写投影。
        return false;
      }
      const claimed = await tx.query(
        `SELECT 1 FROM characters.search_dirty
          WHERE character_id = $1 AND version = $2 FOR UPDATE SKIP LOCKED`,
        [characterId, version],
      );
      if (!claimed.rowCount) return false;
      await tx.db.delete(searchTerms).where(eq(searchTerms.characterId, characterId));
      if (terms.length) await tx.db.insert(searchTerms).values(terms);
      await tx.db.delete(searchDirty).where(eq(searchDirty.characterId, characterId));
      return true;
    });
  }

  /** 一个角色应有的投影；不可搜返回空数组。 */
  private async project(row: CharacterRow): Promise<TermInsert[]> {
    if (row.kind === 'preset' && row.status === 'published') return this.projectOfficial(row);
    if (row.kind === 'custom' && !row.isTrial && row.ownerId)
      return this.rows(row, 'own', row.ownerId, row.name, [], ownIdentity(row));
    return [];
  }

  private async projectOfficial(row: CharacterRow): Promise<TermInsert[]> {
    const overrides = await this.entities.projectionInput(row.id);
    const base = await this.officialTerms(row);
    if (!base) return [];
    return this.rows(
      row,
      'official',
      null,
      base.name,
      [
        ...base.others.filter((o) => !overrides.blocked.has(searchKey(o.text))),
        ...overrides.approved.map((text) => ({ text, kind: 'alias' as const })),
      ],
      overrides.entity?.identity ?? base.identity,
      overrides,
    );
  }

  /** 已上架官方角色自己的名字、别名、关键词和自动身份说明（不含后台搜索修正）；不可搜为 null。 */
  private async officialTerms(row: CharacterRow): Promise<{
    name: string;
    others: Array<{ text: string; kind: Exclude<ProjectedKind, 'name'> }>;
    identity: string | null;
  } | null> {
    if (row.legacyCard) {
      const legacy = parseLegacyCard(row.legacyCard);
      const name = legacyDisplayName(row.legacyCard);
      if (!legacy) return { name, others: [], identity: null };
      return {
        name,
        others: [
          ...legacy.aliases.map((text) => ({ text, kind: 'alias' as const })),
          { text: legacy.nickname, kind: 'alias' },
          { text: legacy.canonicalName, kind: 'alias' },
          { text: legacy.signature, kind: 'keyword' },
        ],
        identity: legacyIdentity(legacy.signature),
      };
    }
    let source: Awaited<ReturnType<CharacterService['publishedPresetSource']>>;
    try {
      source = await this.characterService.publishedPresetSource(row.id);
    } catch (error) {
      // 已上架人设读不出来（密钥问题等）：只按名字列进投影，不卡住刷新队列。
      this.logger.warn(
        { err: error, characterId: row.id },
        '站内搜索：读取已上架人设失败，只按名字收录',
      );
      return { name: row.name, others: [], identity: null };
    }
    if (!source) return null;
    if (source.kind === 'legacy') {
      return { name: legacyDisplayName(row.legacyCard ?? {}), others: [], identity: null };
    }
    const body = source.body;
    const extra = body.card.data.profileExtra;
    return {
      name: body.name,
      others: [
        ...body.aliases.map((text) => ({ text, kind: 'alias' as const })),
        ...body.works.map((text) => ({ text, kind: 'keyword' as const })),
        ...(extra?.searchKeywords ?? []).map((text) => ({ text, kind: 'keyword' as const })),
      ],
      identity: officialIdentity({
        occupation: extra?.occupation,
        workSource: extra?.workSource,
        works: body.works,
        tagline: body.tagline,
      }),
    };
  }

  private rows(
    row: CharacterRow,
    scope: 'official' | 'own',
    ownerId: string | null,
    name: string,
    others: Array<{ text: string; kind: Exclude<ProjectedKind, 'name'> }>,
    identity: string | null,
    overrides?: SearchProjectionInput,
  ): TermInsert[] {
    const named = termRecord(name, 'name');
    if (!named) return [];
    const records = [named];
    for (const other of others) {
      const record = termRecord(other.text, other.kind);
      if (record) records.push(record);
    }
    return uniqueTerms(records)
      .slice(0, MAX_TERMS)
      .map((record) => ({
        characterId: row.id,
        termKey: record.key,
        term: record.term,
        kind: record.kind as ProjectedKind,
        pinyin: record.pinyin,
        initials: record.initials,
        scope,
        ownerId,
        displayName: named.term,
        identity,
        entityKey: overrides?.entity?.entityKey ?? null,
        sourceUrl: overrides?.entity?.sourceUrl ?? null,
      }));
  }

  // ---------- 查询（CharacterSearchPort） ----------

  async matchNames(userId: string, query: SiteSearchTextQuery): Promise<CharacterSearchNameHit[]> {
    await this.refresh(SEARCH_INLINE_REFRESH);
    const prefix = `${escapeLikePattern(query.key)}%`;
    const values: unknown[] = [userId, prefix, query.key];
    const any = [`t.term_key LIKE $2 ESCAPE '\\'`];
    if (query.chars >= 2) {
      values.push(`%${escapeLikePattern(query.key)}%`);
      any.push(`t.term_key LIKE $${values.length} ESCAPE '\\'`);
      if (query.ascii)
        any.push(
          `(t.pinyin <> '' AND t.pinyin LIKE $2 ESCAPE '\\')`,
          `(t.initials <> '' AND t.initials LIKE $2 ESCAPE '\\')`,
        );
    }
    const { rows } = await this.database.query<TermRow>(
      `${SELECT_TERMS}
        WHERE ${VISIBLE} AND (${any.join(' OR ')})
        ORDER BY (t.term_key = $3) DESC, char_length(t.term_key), t.character_id
        LIMIT ${MATCH_ROWS}`,
      values,
    );
    const best = new Map<string, CharacterSearchNameHit>();
    for (const row of rows) {
      const scored = scoreTerm(query, {
        key: row.term_key,
        kind: row.kind as SearchTermKind,
        pinyin: row.pinyin,
        initials: row.initials,
      });
      if (!scored) continue;
      const seen = best.get(row.character_id);
      if (seen && seen.score >= scored.score) continue;
      best.set(row.character_id, {
        characterId: row.character_id,
        scope: row.scope,
        displayName: row.display_name,
        score: scored.score,
        match: scored.match,
        matchedTerm: row.kind === 'name' ? null : { text: row.term, kind: row.kind },
        identity: row.identity,
        entityKey: row.scope === 'official' ? row.entity_key : null,
        sourceUrl: row.scope === 'official' ? row.source_url : null,
      });
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score || a.characterId.localeCompare(b.characterId))
      .slice(0, MATCH_CHARACTERS);
  }

  async typoNames(userId: string, query: SiteSearchTextQuery): Promise<CharacterSearchTypoHit[]> {
    const values: unknown[] = [userId];
    const any: string[] = [];
    if (query.hasCjk && query.chars >= 2 && query.pinyin) {
      // 至少 3 字时同音前缀也算（typoKind 同一规则）。
      values.push(query.chars >= 3 ? `${escapeLikePattern(query.pinyin)}%` : query.pinyin);
      any.push(
        query.chars >= 3
          ? `t.pinyin LIKE $${values.length} ESCAPE '\\'`
          : `t.pinyin = $${values.length}`,
      );
    }
    const chars = Array.from(query.key);
    const minEdit = query.ascii ? 4 : 3;
    if (query.chars >= minEdit) {
      values.push(query.chars, `${escapeLikePattern(chars[0]!)}%`, chars.at(-1)!);
      const [len, first, last] = [values.length - 2, values.length - 1, values.length];
      any.push(
        `(char_length(t.term_key) BETWEEN $${len} - 1 AND $${len} + 1
          AND (t.term_key LIKE $${first} ESCAPE '\\' OR right(t.term_key, 1) = $${last}))`,
      );
      if (query.ascii)
        any.push(
          `(t.pinyin <> '' AND char_length(t.pinyin) BETWEEN $${len} - 1 AND $${len} + 1
            AND (t.pinyin LIKE $${first} ESCAPE '\\' OR right(t.pinyin, 1) = $${last}))`,
        );
    }
    if (!any.length) return [];
    const { rows } = await this.database.query<TermRow>(
      `${SELECT_TERMS}
        WHERE ${VISIBLE} AND t.kind IN ('name', 'alias') AND (${any.join(' OR ')})
        ORDER BY t.character_id, t.term_key
        LIMIT ${TYPO_ROWS}`,
      values,
    );
    const out: CharacterSearchTypoHit[] = [];
    for (const row of rows) {
      const kind = typoKind(query, {
        key: row.term_key,
        kind: row.kind as SearchTermKind,
        pinyin: row.pinyin,
        initials: row.initials,
      });
      if (kind) out.push({ text: row.term, kind, scope: row.scope });
    }
    return out;
  }

  /** 5.6：按公开资料标识查后台登记的实体（站外候选合并用）。 */
  resolveEntities(identifiers: string[]): Promise<CharacterSearchEntity[]> {
    return this.entities.resolveEntities(identifiers);
  }

  async searchCards(userId: string, characterIds: string[]): Promise<CharacterSearchCard[]> {
    const ids = [...new Set(characterIds)].slice(0, 100);
    if (!ids.length) return [];
    const rows = await this.database.db
      .select({
        id: characters.id,
        kind: characters.kind,
        status: characters.status,
        ownerId: characters.ownerId,
        isTrial: characters.isTrial,
        originKind: characters.originKind,
        plazaWorkId: characters.plazaWorkId,
      })
      .from(characters)
      .where(inArray(characters.id, ids));
    const eligible = new Map(
      rows
        .filter(
          (r) =>
            (r.kind === 'preset' && r.status === 'published') ||
            (r.kind === 'custom' && r.ownerId === userId && !r.isTrial),
        )
        .map((r) => [r.id, r]),
    );
    const profiles = await this.characterService.searchProfiles(userId, [...eligible.keys()]);
    const byId = new Map(profiles.map((p) => [p.characterId, p]));
    return ids.flatMap((id) => {
      const row = eligible.get(id);
      const profile = byId.get(id);
      if (!row || !profile) return [];
      return [
        {
          summary: CharacterSummary.parse(profile),
          scope: row.kind === 'preset' ? ('official' as const) : ('own' as const),
          plazaWorkId: row.originKind === 'plaza_copy' ? row.plazaWorkId : null,
        },
      ];
    });
  }
}
