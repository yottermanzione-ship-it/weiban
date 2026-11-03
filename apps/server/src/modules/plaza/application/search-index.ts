/**
 * 站内搜索：广场作品的名称投影（T-20261104b，迁移 0157）。只收上架中的作品：名字 + 预设改版「基于的角色」。
 *
 * 刷新方式与 characters 的投影相同（触发器登记 search_dirty → 定时任务 / 搜索前顺手按批刷新，
 * 每个作品一个短事务，加锁一律 SKIP LOCKED，不等业务事务的锁）。撤稿（unlisted_by_author）、
 * 下架（removed_by_admin）刷新时删投影，删除作品随外键级联；作者停权有到期时间，不写进投影，
 * 查询时按 bans 现查（与广场列表 visibleCond 同一口径），刷新前的旧投影也不会漏出。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { PlazaWorkCard } from '@weiban/contracts';
import {
  JOB_QUEUE,
  LOGGER,
  escapeLikePattern,
  scoreTerm,
  termRecord,
  typoKind,
  uniqueTerms,
  type JobQueue,
  type Logger,
  type SearchMatch,
  type TypoKind,
} from '../../../platform/index.js';
import { adoptions, searchDirty, searchTerms, works, type WorkRow } from '../infra/db/schema.js';
import { PlazaStore } from './plaza-store.js';

type TermInsert = typeof searchTerms.$inferInsert;

export const PLAZA_SEARCH_REFRESH_JOB = 'plaza.refresh_search_index';
const INLINE_REFRESH = 50;
const JOB_REFRESH = 5000;
const BATCH = 100;
const MATCH_ROWS = 600;
const MATCH_WORKS = 400;
const TYPO_ROWS = 300;

export interface PlazaSearchHit {
  workId: string;
  displayName: string;
  score: number;
  match: SearchMatch;
  matchedTerm: { text: string; kind: 'based_on' } | null;
  adoptCount: number;
}

export interface PlazaSearchTypo {
  text: string;
  kind: TypoKind;
}

interface TermRow {
  work_id: string;
  term_key: string;
  term: string;
  kind: 'name' | 'based_on';
  pinyin: string;
  initials: string;
  display_name: string;
  adopt_count: number;
}

/** 上架中且作者未停权（$1 = 现在）；与 PlazaStore.visibleCond 同一口径。 */
const VISIBLE = `w.status = 'listed' AND NOT EXISTS (
  SELECT 1 FROM plaza.bans b WHERE b.user_id = w.author_user_id AND (b.permanent OR b.until > $1)
)`;
const SELECT_TERMS = `SELECT t.work_id, t.term_key, t.term, t.kind, t.pinyin, t.initials, t.display_name,
  w.adopt_count
FROM plaza.search_terms t JOIN plaza.works w ON w.id = t.work_id`;

@Injectable()
export class PlazaSearchIndex implements OnModuleInit {
  constructor(
    @Inject(PlazaStore) private readonly store: PlazaStore,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  private get db() {
    return this.store.db;
  }

  async onModuleInit(): Promise<void> {
    await this.jobs.work(PLAZA_SEARCH_REFRESH_JOB, async () => {
      await this.refresh(JOB_REFRESH);
    });
    await this.jobs.schedule(PLAZA_SEARCH_REFRESH_JOB, '* * * * *');
  }

  // ---------- 刷新投影 ----------

  async refresh(limit: number): Promise<number> {
    let done = 0;
    while (done < limit) {
      const batch = await this.db.db
        .select()
        .from(searchDirty)
        .orderBy(asc(searchDirty.markedAt), asc(searchDirty.workId))
        .limit(Math.min(BATCH, limit - done));
      if (!batch.length) break;
      let progressed = 0;
      for (const entry of batch) {
        try {
          if (await this.refreshOne(entry.workId, entry.version)) progressed++;
        } catch (error) {
          this.logger.warn(
            { err: error, workId: entry.workId },
            '广场搜索投影刷新失败，下一轮重试',
          );
        }
      }
      done += progressed;
      if (!progressed || batch.length < BATCH) break;
    }
    return done;
  }

  private async refreshOne(workId: string, version: number): Promise<boolean> {
    const work = await this.store.work(workId);
    const terms = work ? project(work) : [];
    return this.db.transaction(async (tx) => {
      const alive = await tx.query(
        'SELECT 1 FROM plaza.works WHERE id = $1 FOR KEY SHARE SKIP LOCKED',
        [workId],
      );
      if (!alive.rowCount) return false;
      const claimed = await tx.query(
        'SELECT 1 FROM plaza.search_dirty WHERE work_id = $1 AND version = $2 FOR UPDATE SKIP LOCKED',
        [workId, version],
      );
      if (!claimed.rowCount) return false;
      await tx.db.delete(searchTerms).where(eq(searchTerms.workId, workId));
      if (terms.length) await tx.db.insert(searchTerms).values(terms);
      await tx.db.delete(searchDirty).where(eq(searchDirty.workId, workId));
      return true;
    });
  }

  // ---------- 查询 ----------

  async match(query: Parameters<typeof scoreTerm>[0]): Promise<PlazaSearchHit[]> {
    await this.refresh(INLINE_REFRESH);
    const values: unknown[] = [
      this.store.clock.now(),
      `${escapeLikePattern(query.key)}%`,
      query.key,
    ];
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
    const { rows } = await this.db.query<TermRow>(
      `${SELECT_TERMS}
        WHERE ${VISIBLE} AND (${any.join(' OR ')})
        ORDER BY (t.term_key = $3) DESC, char_length(t.term_key), t.work_id
        LIMIT ${MATCH_ROWS}`,
      values,
    );
    const best = new Map<string, PlazaSearchHit>();
    for (const row of rows) {
      const scored = scoreTerm(query, {
        key: row.term_key,
        kind: row.kind,
        pinyin: row.pinyin,
        initials: row.initials,
      });
      if (!scored) continue;
      const seen = best.get(row.work_id);
      if (seen && seen.score >= scored.score) continue;
      best.set(row.work_id, {
        workId: row.work_id,
        displayName: row.display_name,
        score: scored.score,
        match: scored.match,
        matchedTerm: row.kind === 'name' ? null : { text: row.term, kind: 'based_on' },
        adoptCount: Number(row.adopt_count),
      });
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score || a.workId.localeCompare(b.workId))
      .slice(0, MATCH_WORKS);
  }

  async typos(query: Parameters<typeof typoKind>[0]): Promise<PlazaSearchTypo[]> {
    const values: unknown[] = [this.store.clock.now()];
    const any: string[] = [];
    if (query.hasCjk && query.chars >= 2 && query.pinyin) {
      values.push(query.chars >= 3 ? `${escapeLikePattern(query.pinyin)}%` : query.pinyin);
      any.push(
        query.chars >= 3
          ? `t.pinyin LIKE $${values.length} ESCAPE '\\'`
          : `t.pinyin = $${values.length}`,
      );
    }
    const chars = Array.from(query.key);
    if (query.chars >= (query.ascii ? 4 : 3)) {
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
    const { rows } = await this.db.query<TermRow>(
      `${SELECT_TERMS}
        WHERE ${VISIBLE} AND (${any.join(' OR ')})
        ORDER BY t.work_id, t.term_key
        LIMIT ${TYPO_ROWS}`,
      values,
    );
    const out: PlazaSearchTypo[] = [];
    for (const row of rows) {
      const kind = typoKind(query, {
        key: row.term_key,
        kind: row.kind,
        pinyin: row.pinyin,
        initials: row.initials,
      });
      if (kind) out.push({ text: row.term, kind });
    }
    return out;
  }

  /** 结果卡片：重新按「上架中且作者未停权」读一遍，不再可见的跳过；按给定顺序返回。 */
  async cards(
    viewerId: string,
    workIds: string[],
  ): Promise<Map<string, { card: PlazaWorkCard; row: WorkRow }>> {
    const ids = [...new Set(workIds)];
    if (!ids.length) return new Map();
    const rows = await this.db.db
      .select()
      .from(works)
      .where(and(inArray(works.id, ids), this.store.visibleCond()));
    const cards = await this.store.cards(viewerId, rows);
    return new Map(rows.map((row, index) => [row.id, { card: cards[index]!, row }]));
  }

  /** 我从这些作品复制出的角色（最近一次），用于「已添加 → 去聊天」。 */
  async myCopies(viewerId: string, workIds: string[]): Promise<Map<string, string>> {
    if (!workIds.length) return new Map();
    const rows = await this.db.db
      .select({ workId: adoptions.workId, characterId: adoptions.characterId })
      .from(adoptions)
      .where(
        and(
          eq(adoptions.userId, viewerId),
          eq(adoptions.kind, 'copy'),
          inArray(adoptions.workId, workIds),
        ),
      )
      .orderBy(desc(adoptions.createdAt));
    const out = new Map<string, string>();
    for (const row of rows) if (!out.has(row.workId)) out.set(row.workId, row.characterId);
    return out;
  }
}

/** 作品应有的投影：只收上架中的；名字 + 预设改版「基于的角色」。 */
export function project(work: WorkRow): TermInsert[] {
  if (work.status !== 'listed') return [];
  const name = termRecord(work.name, 'name');
  if (!name) return [];
  const records = [name];
  if (work.kind === 'preset_variant' && work.basedOnPresetName) {
    const basedOn = termRecord(work.basedOnPresetName, 'based_on');
    if (basedOn) records.push(basedOn);
  }
  return uniqueTerms(records).map((record) => ({
    workId: work.id,
    termKey: record.key,
    term: record.term,
    kind: record.kind as 'name' | 'based_on',
    pinyin: record.pinyin,
    initials: record.initials,
    authorUserId: work.authorUserId,
    displayName: name.term,
  }));
}
