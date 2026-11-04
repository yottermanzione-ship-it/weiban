/**
 * 5.6（T-20261104e）：搜索实体与后台人工修正（docs/refactor/24-character-search.md「索引和身份」、分步实现第 3 条）。
 *
 * 实体 = 后台确认是「同一个公开人物 / 作品」的一组公开资料标识（baike:…、wiki:zh:… 等）和本站官方角色。
 * - 只有这里登记过的标识才会把站外候选并到官方角色上（plaza 聚合层经 CharacterSearchPort.resolveEntities 查）；
 *   名字相同、头像相同、模型一句判断都不算证据，不会自动登记。
 * - 合并 / 拆分 / 关联 / 取消关联、身份说明与出处、搜索别名（添加待审核 → 通过才进投影；去掉 / 恢复人设别名），
 *   每次修改与审计写在同一个事务（谁、何时、改了什么、原因）。
 * - 投影刷新复用 0157 的待刷新登记：0158 的触发器在这些表变化时登记 characters.search_dirty
 *   （与本事务一起提交），定时任务 / 下一次搜索前分批刷新。本事务里不调用其他模块端口（审计是平台内核，传同一个 tx）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type {
  AdminSearchAlias,
  AdminSearchAliasChange,
  AdminSearchCharacterView,
  AdminSearchCorrection,
  AdminSearchEntity,
  AdminSearchEntityCreate,
  AdminSearchEntityDetail,
  AdminSearchEntityLinks,
  AdminSearchEntityMerge,
  AdminSearchEntitySplit,
  AdminSearchEntityUpdate,
  CharacterSearchEntity,
  IdentityDirectoryPort,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  displayTerm,
  identifierFrom,
  isEntityKey,
  manualEntityKey,
  newId,
  publicSourceUrl,
  searchKey,
  type AuditLog,
  type AuditRecord,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
import { parseLegacyCard } from '../domain/legacy-card.js';
import {
  characters,
  searchAliases,
  searchEntities,
  searchEntityCharacters,
  searchEntityIdentifiers,
  type SearchEntitySource,
} from '../infra/db/schema.js';
import { CharacterService } from './characters.js';

const MODULE = 'characters';
const ENTITY_TARGET = 'search_entity';
const CHARACTER_TARGET = 'character';
const HISTORY_LIMIT = 50;
const SOURCE_LIMIT = 5;

/** 投影刷新时一个官方角色的人工修正。 */
export interface SearchProjectionInput {
  entity: { entityKey: string; identity: string | null; sourceUrl: string | null } | null;
  /** 已通过的后台别名。 */
  approved: string[];
  /** 从搜索里去掉的人设别名 / 关键词（比较键）。 */
  blocked: Set<string>;
}

type EntityRow = typeof searchEntities.$inferSelect;

function sourceList(input: Array<{ url: string; title: string }>): SearchEntitySource[] {
  const out: SearchEntitySource[] = [];
  for (const item of input) {
    const url = publicSourceUrl(item.url);
    if (!url) throw new AppError('bad_request', '出处必须是公开的 http(s) 网址', { status: 422 });
    if (out.some((s) => s.url === url)) continue;
    out.push({ url, title: item.title.trim() || url, site: new URL(url).hostname });
  }
  return out.slice(0, SOURCE_LIMIT);
}

function parseIdentifiers(
  inputs: string[],
): Array<{ identifier: string; sourceUrl: string | null }> {
  const out: Array<{ identifier: string; sourceUrl: string | null }> = [];
  for (const raw of inputs) {
    const identifier = identifierFrom(raw);
    if (!identifier)
      throw new AppError(
        'bad_request',
        `认不出公开资料标识：${[...raw].slice(0, 60).join('')}（支持百度百科、维基百科、Wikidata、豆瓣影人、Bangumi、萌娘百科等条目地址）`,
        { status: 422 },
      );
    if (out.some((o) => o.identifier === identifier)) continue;
    out.push({
      identifier,
      sourceUrl: /^https?:/iu.test(raw.trim()) ? publicSourceUrl(raw) : null,
    });
  }
  return out;
}

function clip(text: string, max = 500): string {
  return [...text].slice(0, max).join('');
}

@Injectable()
export class SearchEntityService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory: IdentityDirectoryPort,
    @Inject(CharacterService) private readonly characterService: CharacterService,
  ) {}

  // ---------- 端口：站外候选合并（CharacterSearchPort.resolveEntities） ----------

  async resolveEntities(identifiers: string[]): Promise<CharacterSearchEntity[]> {
    const ids = [...new Set(identifiers)].filter((id) => id.length <= 120).slice(0, 50);
    if (!ids.length) return [];
    const { rows } = await this.database.query<{
      identifier: string;
      entity_key: string;
      display_name: string;
      identity: string | null;
      sources: SearchEntitySource[];
    }>(
      `SELECT i.identifier, e.entity_key, e.display_name, e.identity, e.sources
         FROM characters.search_entity_identifiers i
         JOIN characters.search_entities e ON e.entity_key = i.entity_key
        WHERE i.identifier = ANY($1::text[])`,
      [ids],
    );
    if (!rows.length) return [];
    const byKey = new Map<string, CharacterSearchEntity>();
    for (const row of rows) {
      const seen = byKey.get(row.entity_key);
      if (seen) {
        seen.identifiers.push(row.identifier);
        continue;
      }
      byKey.set(row.entity_key, {
        entityKey: row.entity_key,
        displayName: row.display_name,
        identity: row.identity,
        sources: Array.isArray(row.sources) ? row.sources : [],
        identifiers: [row.identifier],
        characterIds: [],
      });
    }
    const linked = await this.database.query<{ entity_key: string; character_id: string }>(
      `SELECT l.entity_key, l.character_id
         FROM characters.search_entity_characters l
         JOIN characters.characters c ON c.id = l.character_id
        WHERE l.entity_key = ANY($1::text[]) AND c.kind = 'preset' AND c.status = 'published'
        ORDER BY l.created_at, l.character_id`,
      [[...byKey.keys()]],
    );
    for (const row of linked.rows) byKey.get(row.entity_key)?.characterIds.push(row.character_id);
    return [...byKey.values()];
  }

  // ---------- 投影刷新 ----------

  async projectionInput(characterId: string): Promise<SearchProjectionInput> {
    const [entity] = await this.database.db
      .select({
        entityKey: searchEntities.entityKey,
        identity: searchEntities.identity,
        sources: searchEntities.sources,
      })
      .from(searchEntityCharacters)
      .innerJoin(searchEntities, eq(searchEntities.entityKey, searchEntityCharacters.entityKey))
      .where(eq(searchEntityCharacters.characterId, characterId));
    const aliases = await this.database.db
      .select()
      .from(searchAliases)
      .where(eq(searchAliases.characterId, characterId))
      .orderBy(asc(searchAliases.createdAt));
    return {
      entity: entity
        ? {
            entityKey: entity.entityKey,
            identity: entity.identity,
            sourceUrl: entity.sources[0]?.url ?? null,
          }
        : null,
      approved: aliases.filter((a) => a.status === 'approved').map((a) => a.alias),
      blocked: new Set(aliases.filter((a) => a.status === 'blocked').map((a) => a.aliasKey)),
    };
  }

  // ---------- 后台：实体 ----------

  async listEntities(
    q: string,
    cursor?: string,
    limit = 50,
  ): Promise<{ items: AdminSearchEntity[]; nextCursor: string | null }> {
    const text = q.trim();
    let after: { at: string; key: string; q: string } | undefined;
    if (cursor) {
      try {
        after = z
          .object({
            at: z.iso.datetime(),
            key: z.string().refine(isEntityKey),
            q: z.string().max(200),
          })
          .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
        if (after.q !== text) throw new Error('cursor query mismatch');
      } catch {
        throw new AppError('bad_request', '分页位置无效，请重新搜索');
      }
    }
    const pattern = text ? `%${text.replace(/[\\%_]/gu, '\\$&')}%` : '';
    // 保留数据库的微秒精度；只用 Date.toISOString 会丢失最后三位，翻页时可能漏记录。
    const { rows } = await this.database.query<{ entity_key: string; cursor_at: string }>(
      `SELECT e.entity_key,
              to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
         FROM characters.search_entities e
          WHERE ($1 = '' OR e.display_name ILIKE $1 ESCAPE '\\' OR e.entity_key ILIKE $1 ESCAPE '\\'
             OR EXISTS (SELECT 1 FROM characters.search_entity_identifiers i
                         WHERE i.entity_key = e.entity_key AND i.identifier ILIKE $1 ESCAPE '\\')
             OR EXISTS (SELECT 1 FROM characters.search_entity_characters l
                          JOIN characters.characters c ON c.id = l.character_id
                         WHERE l.entity_key = e.entity_key AND c.name ILIKE $1 ESCAPE '\\'))
            AND ($2::timestamptz IS NULL OR e.updated_at < $2::timestamptz
                 OR (e.updated_at = $2::timestamptz AND e.entity_key > $3))
          ORDER BY e.updated_at DESC, e.entity_key
          LIMIT $4`,
      [pattern, after?.at ?? null, after?.key ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await this.views(page.map((r) => r.entity_key)),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ at: last.cursor_at, key: last.entity_key, q: text }),
            ).toString('base64url')
          : null,
    };
  }

  async getEntity(entityKey: string): Promise<AdminSearchEntityDetail> {
    const [entity] = await this.views([entityKey]);
    if (!entity) throw new AppError('not_found', '实体不存在');
    return { entity, history: await this.history(ENTITY_TARGET, entityKey) };
  }

  async createEntity(
    adminId: string,
    input: AdminSearchEntityCreate,
  ): Promise<AdminSearchEntityDetail> {
    const identifiers = parseIdentifiers(input.identifiers);
    const sources = sourceList(input.sources);
    const characterIds = [...new Set(input.characterIds)];
    await this.requirePresets(characterIds);
    const entityKey = await this.database.transaction(async (tx) => {
      const now = this.clock.now();
      const first = identifiers[0]?.identifier;
      const taken = first
        ? await tx.db
            .select({ k: searchEntities.entityKey })
            .from(searchEntities)
            .where(eq(searchEntities.entityKey, first))
        : [];
      const key = first && !taken.length ? first : manualEntityKey(newId());
      await tx.db.insert(searchEntities).values({
        entityKey: key,
        displayName: input.displayName,
        identity: input.identity || null,
        sources,
        createdAt: now,
        updatedAt: now,
      });
      await this.addIdentifiers(tx, key, identifiers);
      await this.addCharacters(tx, key, characterIds);
      await this.record(tx, adminId, 'search.entity_created', ENTITY_TARGET, key, input.reason, {
        summary: clip(
          `新建实体「${input.displayName}」` +
            (input.identity ? `，身份说明「${input.identity}」` : '') +
            (identifiers.length
              ? `，标识 ${identifiers.map((i) => i.identifier).join('、')}`
              : '') +
            (characterIds.length ? `，关联 ${characterIds.length} 个官方角色` : ''),
        ),
        identifiers: identifiers.map((i) => i.identifier),
        characterIds,
      });
      for (const characterId of characterIds)
        await this.record(
          tx,
          adminId,
          'search.character_linked',
          CHARACTER_TARGET,
          characterId,
          input.reason,
          {
            summary: `关联到实体「${input.displayName}」（${key}）`,
            entityKey: key,
          },
        );
      return key;
    });
    return this.getEntity(entityKey);
  }

  async updateEntity(
    adminId: string,
    input: AdminSearchEntityUpdate,
  ): Promise<AdminSearchEntityDetail> {
    const sources = input.sources ? sourceList(input.sources) : undefined;
    await this.database.transaction(async (tx) => {
      const before = await this.lockEntity(tx, input.entityKey);
      const after = {
        displayName: input.displayName ?? before.displayName,
        identity: input.identity === undefined ? before.identity : input.identity || null,
        sources: sources ?? before.sources,
      };
      const changes: string[] = [];
      if (after.displayName !== before.displayName)
        changes.push(`显示名「${before.displayName}」→「${after.displayName}」`);
      if (after.identity !== before.identity)
        changes.push(
          `身份说明「${before.identity ?? '（无）'}」→「${after.identity ?? '（无）'}」`,
        );
      if (JSON.stringify(after.sources) !== JSON.stringify(before.sources))
        changes.push(`出处 ${before.sources.length} 条 → ${after.sources.length} 条`);
      if (!changes.length) return;
      await tx.db
        .update(searchEntities)
        .set({ ...after, updatedAt: this.clock.now() })
        .where(eq(searchEntities.entityKey, before.entityKey));
      await this.record(
        tx,
        adminId,
        'search.entity_updated',
        ENTITY_TARGET,
        before.entityKey,
        input.reason,
        {
          summary: clip(changes.join('；')),
          before: { displayName: before.displayName, identity: before.identity },
          after: { displayName: after.displayName, identity: after.identity },
          sourceUrls: after.sources.map((s) => s.url),
        },
      );
    });
    return this.getEntity(input.entityKey);
  }

  async linkEntity(
    adminId: string,
    input: AdminSearchEntityLinks,
  ): Promise<AdminSearchEntityDetail> {
    const addIdentifiers = parseIdentifiers(input.addIdentifiers);
    const addCharacters = [...new Set(input.addCharacterIds)];
    const removeCharacters = [...new Set(input.removeCharacterIds)];
    const removeIdentifiers = [...new Set(input.removeIdentifiers)];
    await this.requirePresets(addCharacters);
    await this.database.transaction(async (tx) => {
      const entity = await this.lockEntity(tx, input.entityKey);
      const key = entity.entityKey;
      await this.addIdentifiers(tx, key, addIdentifiers);
      await this.addCharacters(tx, key, addCharacters);
      const droppedIds = removeIdentifiers.length
        ? (
            await tx.query<{ identifier: string }>(
              `DELETE FROM characters.search_entity_identifiers
                WHERE entity_key = $1 AND identifier = ANY($2::text[]) RETURNING identifier`,
              [key, removeIdentifiers],
            )
          ).rows.map((r) => r.identifier)
        : [];
      const droppedChars = removeCharacters.length
        ? (
            await tx.query<{ character_id: string }>(
              `DELETE FROM characters.search_entity_characters
                WHERE entity_key = $1 AND character_id = ANY($2::uuid[]) RETURNING character_id`,
              [key, removeCharacters],
            )
          ).rows.map((r) => r.character_id)
        : [];
      if (
        droppedIds.length !== removeIdentifiers.length ||
        droppedChars.length !== removeCharacters.length
      )
        throw new AppError('bad_request', '要取消的标识或角色不属于这个实体', { status: 422 });
      const parts = [
        addIdentifiers.length ? `加标识 ${addIdentifiers.map((i) => i.identifier).join('、')}` : '',
        droppedIds.length ? `去标识 ${droppedIds.join('、')}` : '',
        addCharacters.length ? `关联 ${addCharacters.length} 个官方角色` : '',
        droppedChars.length ? `取消关联 ${droppedChars.length} 个官方角色` : '',
      ].filter(Boolean);
      if (!parts.length) return;
      await tx.db
        .update(searchEntities)
        .set({ updatedAt: this.clock.now() })
        .where(eq(searchEntities.entityKey, key));
      await this.record(tx, adminId, 'search.entity_linked', ENTITY_TARGET, key, input.reason, {
        summary: clip(parts.join('；')),
        addIdentifiers: addIdentifiers.map((i) => i.identifier),
        removeIdentifiers: droppedIds,
        addCharacterIds: addCharacters,
        removeCharacterIds: droppedChars,
      });
      for (const characterId of addCharacters)
        await this.record(
          tx,
          adminId,
          'search.character_linked',
          CHARACTER_TARGET,
          characterId,
          input.reason,
          {
            summary: `关联到实体「${entity.displayName}」（${key}）`,
            entityKey: key,
          },
        );
      for (const characterId of droppedChars)
        await this.record(
          tx,
          adminId,
          'search.character_unlinked',
          CHARACTER_TARGET,
          characterId,
          input.reason,
          {
            summary: `取消关联实体「${entity.displayName}」（${key}）`,
            entityKey: key,
          },
        );
    });
    return this.getEntity(input.entityKey);
  }

  async mergeEntity(
    adminId: string,
    input: AdminSearchEntityMerge,
  ): Promise<AdminSearchEntityDetail> {
    if (input.entityKey === input.fromEntityKey)
      throw new AppError('bad_request', '不能把实体合并到自己', { status: 422 });
    await this.database.transaction(async (tx) => {
      // 两个实体按键排序加锁，并发的反向合并不会互等。
      const locked = new Map<string, EntityRow>();
      for (const key of [input.entityKey, input.fromEntityKey].sort())
        locked.set(key, await this.lockEntity(tx, key));
      const into = locked.get(input.entityKey)!;
      const from = locked.get(input.fromEntityKey)!;
      const moved = await tx.query<{ identifier: string }>(
        `UPDATE characters.search_entity_identifiers SET entity_key = $1
          WHERE entity_key = $2 RETURNING identifier`,
        [into.entityKey, from.entityKey],
      );
      const movedChars = await tx.query<{ character_id: string }>(
        `UPDATE characters.search_entity_characters SET entity_key = $1
          WHERE entity_key = $2 RETURNING character_id`,
        [into.entityKey, from.entityKey],
      );
      const sources = [...into.sources];
      for (const s of from.sources)
        if (sources.length < SOURCE_LIMIT && !sources.some((x) => x.url === s.url)) sources.push(s);
      await tx.db
        .update(searchEntities)
        .set({ sources, identity: into.identity ?? from.identity, updatedAt: this.clock.now() })
        .where(eq(searchEntities.entityKey, into.entityKey));
      await tx.db.delete(searchEntities).where(eq(searchEntities.entityKey, from.entityKey));
      const summary = clip(
        `把实体「${from.displayName}」（${from.entityKey}）并入「${into.displayName}」：` +
          `${moved.rows.length} 个标识、${movedChars.rows.length} 个官方角色`,
      );
      const details = {
        summary,
        fromEntityKey: from.entityKey,
        intoEntityKey: into.entityKey,
        identifiers: moved.rows.map((r) => r.identifier),
        characterIds: movedChars.rows.map((r) => r.character_id),
      };
      await this.record(
        tx,
        adminId,
        'search.entity_merged',
        ENTITY_TARGET,
        into.entityKey,
        input.reason,
        details,
      );
      await this.record(
        tx,
        adminId,
        'search.entity_merged_away',
        ENTITY_TARGET,
        from.entityKey,
        input.reason,
        details,
      );
      for (const row of movedChars.rows)
        await this.record(
          tx,
          adminId,
          'search.character_linked',
          CHARACTER_TARGET,
          row.character_id,
          input.reason,
          {
            summary: `随实体合并改归「${into.displayName}」（${into.entityKey}）`,
            entityKey: into.entityKey,
          },
        );
    });
    return this.getEntity(input.entityKey);
  }

  async splitEntity(
    adminId: string,
    input: AdminSearchEntitySplit,
  ): Promise<AdminSearchEntityDetail> {
    const identifiers = [...new Set(input.identifiers)];
    const characterIds = [...new Set(input.characterIds)];
    if (!identifiers.length && !characterIds.length)
      throw new AppError('bad_request', '至少选一个要拆出去的标识或角色', { status: 422 });
    const newKey = await this.database.transaction(async (tx) => {
      const source = await this.lockEntity(tx, input.entityKey);
      const owned = await tx.query<{ identifier: string }>(
        `SELECT identifier FROM characters.search_entity_identifiers
          WHERE entity_key = $1 AND identifier = ANY($2::text[]) FOR UPDATE`,
        [source.entityKey, identifiers],
      );
      const ownedChars = await tx.query<{ character_id: string }>(
        `SELECT character_id FROM characters.search_entity_characters
          WHERE entity_key = $1 AND character_id = ANY($2::uuid[]) FOR UPDATE`,
        [source.entityKey, characterIds],
      );
      if (
        owned.rows.length !== identifiers.length ||
        ownedChars.rows.length !== characterIds.length
      )
        throw new AppError('bad_request', '要拆出去的标识或角色不属于这个实体', { status: 422 });
      const first = identifiers.find((id) => isEntityKey(id) && id !== source.entityKey);
      const taken = first
        ? await tx.db
            .select({ k: searchEntities.entityKey })
            .from(searchEntities)
            .where(eq(searchEntities.entityKey, first))
        : [];
      const key = first && !taken.length ? first : manualEntityKey(newId());
      const now = this.clock.now();
      await tx.db.insert(searchEntities).values({
        entityKey: key,
        displayName: input.displayName,
        identity: input.identity || null,
        sources: [],
        createdAt: now,
        updatedAt: now,
      });
      if (identifiers.length)
        await tx.query(
          `UPDATE characters.search_entity_identifiers SET entity_key = $1
            WHERE entity_key = $2 AND identifier = ANY($3::text[])`,
          [key, source.entityKey, identifiers],
        );
      if (characterIds.length)
        await tx.query(
          `UPDATE characters.search_entity_characters SET entity_key = $1
            WHERE entity_key = $2 AND character_id = ANY($3::uuid[])`,
          [key, source.entityKey, characterIds],
        );
      await tx.db
        .update(searchEntities)
        .set({ updatedAt: now })
        .where(eq(searchEntities.entityKey, source.entityKey));
      const details = {
        summary: clip(
          `从「${source.displayName}」拆出「${input.displayName}」（${key}）：` +
            `${identifiers.length} 个标识、${characterIds.length} 个官方角色`,
        ),
        fromEntityKey: source.entityKey,
        newEntityKey: key,
        identifiers,
        characterIds,
      };
      await this.record(
        tx,
        adminId,
        'search.entity_split',
        ENTITY_TARGET,
        source.entityKey,
        input.reason,
        details,
      );
      await this.record(
        tx,
        adminId,
        'search.entity_split_created',
        ENTITY_TARGET,
        key,
        input.reason,
        details,
      );
      for (const characterId of characterIds)
        await this.record(
          tx,
          adminId,
          'search.character_linked',
          CHARACTER_TARGET,
          characterId,
          input.reason,
          {
            summary: `随实体拆分改归「${input.displayName}」（${key}）`,
            entityKey: key,
          },
        );
      return key;
    });
    return this.getEntity(newKey);
  }

  // ---------- 后台：官方角色的搜索别名 ----------

  async characterView(characterId: string): Promise<AdminSearchCharacterView> {
    const row = await this.preset(characterId);
    const persona = await this.personaAliases(row);
    const rows = await this.database.db
      .select()
      .from(searchAliases)
      .where(eq(searchAliases.characterId, characterId))
      .orderBy(asc(searchAliases.createdAt));
    const byKey = new Map(rows.map((r) => [r.aliasKey, r]));
    const published = row.status === 'published';
    const aliases: AdminSearchAlias[] = [];
    const seen = new Set<string>();
    for (const alias of persona) {
      const key = searchKey(displayTerm(alias));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const blocked = byKey.get(key)?.status === 'blocked';
      aliases.push({
        alias: displayTerm(alias),
        aliasKey: key,
        origin: 'persona',
        status: blocked ? 'blocked' : 'approved',
        searchable: published && !blocked,
      });
    }
    for (const r of rows) {
      if (seen.has(r.aliasKey) || r.status === 'blocked') continue;
      seen.add(r.aliasKey);
      aliases.push({
        alias: r.alias,
        aliasKey: r.aliasKey,
        origin: 'admin',
        status: r.status,
        searchable: published && r.status === 'approved',
      });
    }
    const [link] = await this.database.db
      .select({ entityKey: searchEntityCharacters.entityKey })
      .from(searchEntityCharacters)
      .where(eq(searchEntityCharacters.characterId, characterId));
    const [entity] = link ? await this.views([link.entityKey]) : [];
    return {
      characterId,
      name: row.name.slice(0, 64),
      published,
      entity: entity ?? null,
      aliases: aliases.slice(0, 100),
      history: await this.history(CHARACTER_TARGET, characterId),
    };
  }

  async changeAlias(
    adminId: string,
    characterId: string,
    input: AdminSearchAliasChange,
  ): Promise<AdminSearchCharacterView> {
    const row = await this.preset(characterId);
    const alias = displayTerm(input.alias);
    const aliasKey = searchKey(alias);
    if (!aliasKey) throw new AppError('bad_request', '别名不能只有空白或标点', { status: 422 });
    const persona = new Set(
      (await this.personaAliases(row)).map((a) => searchKey(displayTerm(a))).filter(Boolean),
    );
    await this.database.transaction(async (tx) => {
      const current = (
        await tx.query<{ alias: string; status: 'pending' | 'approved' | 'blocked' }>(
          `SELECT alias, status FROM characters.search_aliases
            WHERE character_id = $1 AND alias_key = $2 FOR UPDATE`,
          [characterId, aliasKey],
        )
      ).rows[0];
      const now = this.clock.now();
      let action = '';
      let summary = '';
      switch (input.op) {
        case 'propose': {
          if (aliasKey === searchKey(displayTerm(row.name)))
            throw new AppError('conflict', '别名和角色名字相同');
          if (current) throw new AppError('conflict', '这个别名已经登记过（可通过、驳回或恢复）');
          if (persona.has(aliasKey)) throw new AppError('conflict', '人设里已有这个别名');
          const inserted = await tx.query(
            `INSERT INTO characters.search_aliases (character_id, alias_key, alias, status, created_at)
             VALUES ($1, $2, $3, 'pending', $4) ON CONFLICT DO NOTHING`,
            [characterId, aliasKey, alias, now],
          );
          if (!inserted.rowCount) throw new AppError('conflict', '这个别名刚被登记过，请刷新');
          action = 'search.alias_proposed';
          summary = `添加待审核别名「${alias}」`;
          break;
        }
        case 'approve': {
          if (current?.status !== 'pending')
            throw new AppError('conflict', '只有待审核的别名可以通过');
          await tx.query(
            `UPDATE characters.search_aliases SET status = 'approved', reviewed_at = $3
              WHERE character_id = $1 AND alias_key = $2`,
            [characterId, aliasKey, now],
          );
          action = 'search.alias_approved';
          summary = `通过别名「${current.alias}」（进入站内搜索）`;
          break;
        }
        case 'reject': {
          if (current?.status !== 'pending')
            throw new AppError('conflict', '只有待审核的别名可以驳回');
          await this.deleteAlias(tx, characterId, aliasKey);
          action = 'search.alias_rejected';
          summary = `驳回别名「${current.alias}」`;
          break;
        }
        case 'remove': {
          if (current?.status === 'approved' || current?.status === 'pending') {
            await this.deleteAlias(tx, characterId, aliasKey);
            summary = `去掉别名「${current.alias}」`;
          } else if (!current && persona.has(aliasKey)) {
            await tx.db.insert(searchAliases).values({
              characterId,
              aliasKey,
              alias,
              status: 'blocked',
              createdAt: now,
              reviewedAt: now,
            });
            summary = `把人设别名「${alias}」从站内搜索里去掉（人设本身不改）`;
          } else throw new AppError('not_found', '没有这个可去掉的别名');
          action = 'search.alias_removed';
          break;
        }
        case 'restore': {
          if (current?.status !== 'blocked')
            throw new AppError('conflict', '只有被去掉的人设别名可以恢复');
          await this.deleteAlias(tx, characterId, aliasKey);
          action = 'search.alias_restored';
          summary = `恢复人设别名「${current.alias}」`;
          break;
        }
      }
      await this.record(tx, adminId, action, CHARACTER_TARGET, characterId, input.reason, {
        summary,
        alias,
        op: input.op,
      });
    });
    return this.characterView(characterId);
  }

  // ---------- 内部 ----------

  private async deleteAlias(tx: DbTx, characterId: string, aliasKey: string) {
    await tx.query(
      'DELETE FROM characters.search_aliases WHERE character_id = $1 AND alias_key = $2',
      [characterId, aliasKey],
    );
  }

  private async preset(characterId: string) {
    const [row] = await this.database.db
      .select()
      .from(characters)
      .where(eq(characters.id, characterId));
    if (!row || row.kind !== 'preset') throw new AppError('not_found', '官方角色不存在');
    return row;
  }

  /** 已发布人设里的别名（旧卡：别名、昵称、本名）。没上架或读不出时为空。 */
  private async personaAliases(row: typeof characters.$inferSelect): Promise<string[]> {
    if (row.status !== 'published') return [];
    if (row.legacyCard) {
      const legacy = parseLegacyCard(row.legacyCard);
      return legacy
        ? [...legacy.aliases, legacy.nickname, legacy.canonicalName].filter(Boolean)
        : [];
    }
    try {
      const source = await this.characterService.publishedPresetSource(row.id);
      return source?.kind === 'card' ? source.body.aliases : [];
    } catch {
      return [];
    }
  }

  private async requirePresets(ids: string[]) {
    if (!ids.length) return;
    const rows = await this.database.db
      .select({ id: characters.id, kind: characters.kind })
      .from(characters)
      .where(inArray(characters.id, ids));
    const presets = new Set(rows.filter((r) => r.kind === 'preset').map((r) => r.id));
    if (ids.some((id) => !presets.has(id)))
      throw new AppError('bad_request', '只能关联官方角色', { status: 422 });
  }

  private async lockEntity(tx: DbTx, entityKey: string): Promise<EntityRow> {
    const [row] = await tx.db
      .select()
      .from(searchEntities)
      .where(eq(searchEntities.entityKey, entityKey))
      .for('update');
    if (!row) throw new AppError('not_found', '实体不存在');
    return row;
  }

  private async addIdentifiers(
    tx: DbTx,
    entityKey: string,
    identifiers: Array<{ identifier: string; sourceUrl: string | null }>,
  ) {
    for (const item of identifiers) {
      const inserted = await tx.query(
        `INSERT INTO characters.search_entity_identifiers (identifier, entity_key, source_url, created_at)
         VALUES ($1, $2, $3, $4) ON CONFLICT (identifier) DO NOTHING RETURNING identifier`,
        [item.identifier, entityKey, item.sourceUrl, this.clock.now()],
      );
      if (inserted.rowCount) continue;
      const owner = await tx.query<{ entity_key: string }>(
        'SELECT entity_key FROM characters.search_entity_identifiers WHERE identifier = $1',
        [item.identifier],
      );
      if (owner.rows[0]?.entity_key === entityKey) continue;
      throw new AppError(
        'conflict',
        `标识 ${item.identifier} 已属于实体 ${owner.rows[0]?.entity_key ?? '（未知）'}，如是同一人请用「合并」`,
      );
    }
  }

  private async addCharacters(tx: DbTx, entityKey: string, characterIds: string[]) {
    for (const characterId of characterIds) {
      const inserted = await tx.query(
        `INSERT INTO characters.search_entity_characters (character_id, entity_key, created_at)
         VALUES ($1, $2, $3) ON CONFLICT (character_id) DO NOTHING RETURNING character_id`,
        [characterId, entityKey, this.clock.now()],
      );
      if (inserted.rowCount) continue;
      const owner = await tx.query<{ entity_key: string }>(
        'SELECT entity_key FROM characters.search_entity_characters WHERE character_id = $1',
        [characterId],
      );
      if (owner.rows[0]?.entity_key === entityKey) continue;
      throw new AppError(
        'conflict',
        `这个官方角色已关联实体 ${owner.rows[0]?.entity_key ?? '（未知）'}，请先取消关联或用「拆分 / 合并」`,
      );
    }
  }

  private async record(
    tx: DbTx,
    adminId: string,
    action: string,
    targetType: string,
    targetId: string,
    reason: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.record(
      {
        module: MODULE,
        action,
        actorType: 'admin',
        actorId: adminId,
        targetType,
        targetId,
        details: { reason, ...details },
      },
      tx,
    );
  }

  private async history(targetType: string, targetId: string): Promise<AdminSearchCorrection[]> {
    const records: AuditRecord[] = await this.audit.list({
      module: MODULE,
      targetType,
      targetId,
      actionPrefix: 'search.',
      limit: HISTORY_LIMIT,
    });
    const actorIds = [...new Set(records.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const names = actorIds.length
      ? await this.directory.getUsernames(actorIds).catch(() => ({}) as Record<string, string>)
      : {};
    return records.map((r) => ({
      auditId: r.id,
      at: r.occurredAt.toISOString(),
      action: r.action.slice(0, 80),
      actorName: ((r.actorId && names[r.actorId]) || (r.actorId ? '已注销的管理员' : '系统')).slice(
        0,
        64,
      ),
      reason: clip(typeof r.details.reason === 'string' ? r.details.reason : '', 200),
      summary: clip(typeof r.details.summary === 'string' ? r.details.summary : r.action, 500),
    }));
  }

  /** 实体的后台视图（按传入顺序，不存在的跳过）。 */
  private async views(keys: string[]): Promise<AdminSearchEntity[]> {
    if (!keys.length) return [];
    const rows = await this.database.db
      .select()
      .from(searchEntities)
      .where(inArray(searchEntities.entityKey, keys));
    const ids = await this.database.db
      .select()
      .from(searchEntityIdentifiers)
      .where(inArray(searchEntityIdentifiers.entityKey, keys))
      .orderBy(asc(searchEntityIdentifiers.createdAt), asc(searchEntityIdentifiers.identifier));
    const links = await this.database.db
      .select({
        entityKey: searchEntityCharacters.entityKey,
        characterId: searchEntityCharacters.characterId,
        name: characters.name,
        status: characters.status,
      })
      .from(searchEntityCharacters)
      .innerJoin(characters, eq(characters.id, searchEntityCharacters.characterId))
      .where(inArray(searchEntityCharacters.entityKey, keys))
      .orderBy(asc(searchEntityCharacters.createdAt));
    const byKey = new Map(rows.map((r) => [r.entityKey, r]));
    return keys.flatMap((key) => {
      const row = byKey.get(key);
      if (!row) return [];
      return [
        {
          entityKey: row.entityKey,
          displayName: row.displayName,
          identity: row.identity,
          sources: row.sources.slice(0, SOURCE_LIMIT),
          identifiers: ids
            .filter((i) => i.entityKey === key)
            .slice(0, 50)
            .map((i) => ({ identifier: i.identifier, sourceUrl: i.sourceUrl })),
          characters: links
            .filter((l) => l.entityKey === key)
            .slice(0, 20)
            .map((l) => ({
              characterId: l.characterId,
              name: l.name.slice(0, 64),
              published: l.status === 'published',
            })),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
      ];
    });
  }
}
