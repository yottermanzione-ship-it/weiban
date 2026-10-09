/**
 * 公开动态（D-L3-02，PRD SIM-03、ADM-03）：录入、审核状态机、自动候选搜索、PublicUpdateReadPort。
 * 说明见 docs/backend/public-updates.md。
 *
 * 状态机（与契约 http/public-updates.ts 一致）：
 *   draft ─submit→ pending ─approve→ effective ─withdraw→ withdrawn
 *                     └─reject→ rejected
 * 状态迁移用「带旧状态条件的 UPDATE」完成，并发的两次审核只有一次成功，另一次返回 conflict。
 * 自动候选永远以 pending 创建，永不自动生效（hard-boundaries.md SAFE-02）。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  Id,
  type CreatePublicUpdateRequest,
  type EffectivePublicUpdate,
  type IdentityDirectoryPort,
  type PublicUpdate,
  type PublicUpdateKind,
  type PublicUpdateReadPort,
  type PublicUpdateSearchResult,
  type PublicUpdateSettings,
  type PublicUpdateSource,
  type PublicUpdateStatus,
  type UpdatePublicUpdateRequest,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  LOGGER,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type JobQueue,
  type Logger,
} from '../../../platform/index.js';
import { IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
import type { WebSearchProvider } from '../../model-access/index.js';
import { characters, publicUpdateSettings, publicUpdates } from '../infra/db/schema.js';
import {
  CHARACTER_CONTACT_ACCESS,
  PUBLIC_UPDATE_WEB_SEARCH,
  type CharacterContactAccess,
} from '../tokens.js';

/** 每角色每次最多候选条数（prd-answers.md 第 7 节第 3 条）。 */
const MAX_CANDIDATES = 5;
/** 搜索最近多少天（第 7 节第 2 条）。 */
const RECENCY_DAYS = 7;
/** 每周一次自动搜索：北京时间周一 03:00 = UTC 周日 19:00。 */
const WEEKLY_CRON = '0 19 * * 0';
export const PUBLIC_UPDATE_WEEKLY_JOB = 'characters.public_updates_weekly';
export const PUBLIC_UPDATE_SEARCH_JOB = 'characters.public_updates_search';
const SETTINGS_ID = 'default';

type Row = typeof publicUpdates.$inferSelect;

@Injectable()
export class PublicUpdateService implements PublicUpdateReadPort, OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory: IdentityDirectoryPort,
    @Inject(PUBLIC_UPDATE_WEB_SEARCH) private readonly search: WebSearchProvider,
    @Inject(CHARACTER_CONTACT_ACCESS) private readonly contactAccess: CharacterContactAccess,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work(PUBLIC_UPDATE_WEEKLY_JOB, () => this.runWeekly());
    await this.jobs.work<{ characterId: string; week: string }>(PUBLIC_UPDATE_SEARCH_JOB, (job) =>
      this.runScheduledSearch(job.data.characterId, job.data.week).then(() => undefined),
    );
    await this.jobs.schedule(PUBLIC_UPDATE_WEEKLY_JOB, WEEKLY_CRON);
  }

  // ---------------------------------------------------------------------------
  // PublicUpdateReadPort（ai-runtime 使用）
  // ---------------------------------------------------------------------------

  async listEffective(
    characterId: string,
    asOfDate: string,
    opts: { limit?: number; pastDays?: number } = {},
  ): Promise<EffectivePublicUpdate[]> {
    if (!Id.safeParse(characterId).success || !isDate(asOfDate)) return [];
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const oldest = addDays(asOfDate, -(opts.pastDays ?? 90));
    const rows = await this.database.db
      .select()
      .from(publicUpdates)
      .where(
        and(
          eq(publicUpdates.characterId, characterId),
          eq(publicUpdates.status, 'effective'),
          lte(publicUpdates.effectiveDate, asOfDate),
          sql`coalesce(${publicUpdates.endDate}, ${publicUpdates.startDate}) >= ${oldest}`,
        ),
      )
      .orderBy(desc(publicUpdates.startDate), desc(publicUpdates.id))
      .limit(limit);
    return rows.map((r) => ({
      updateId: r.id,
      characterId: r.characterId,
      kind: r.kind as PublicUpdateKind,
      content: r.content,
      startDate: r.startDate,
      endDate: r.endDate,
      effectiveDate: r.effectiveDate,
      sourceUrl: r.sourceUrl,
      phase: (r.endDate ?? r.startDate) < asOfDate ? 'past' : 'recent',
    }));
  }

  // ---------------------------------------------------------------------------
  // 管理端
  // ---------------------------------------------------------------------------

  async list(q: {
    status?: PublicUpdateStatus;
    source?: PublicUpdateSource;
    characterId?: string;
    limit: number;
    cursor?: string;
  }): Promise<{ items: PublicUpdate[]; nextCursor: string | null }> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const conds: (SQL | undefined)[] = [
      q.status ? eq(publicUpdates.status, q.status) : undefined,
      q.source ? eq(publicUpdates.source, q.source) : undefined,
      q.characterId ? eq(publicUpdates.characterId, q.characterId) : undefined,
      cursor
        ? or(
            lt(publicUpdates.createdAt, cursor.at),
            and(eq(publicUpdates.createdAt, cursor.at), lt(publicUpdates.id, cursor.id)),
          )
        : undefined,
    ];
    const rows = await this.database.db
      .select({ row: publicUpdates, name: characters.name })
      .from(publicUpdates)
      .innerJoin(characters, eq(characters.id, publicUpdates.characterId))
      .where(and(...conds))
      .orderBy(desc(publicUpdates.createdAt), desc(publicUpdates.id))
      .limit(q.limit + 1);
    const hasMore = rows.length > q.limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    return {
      items: rows.map((r) => toDto(r.row, r.name)),
      nextCursor: hasMore && last ? encodeCursor(last.row.createdAt, last.row.id) : null,
    };
  }

  async get(updateId: string): Promise<PublicUpdate> {
    const [r] = await this.database.db
      .select({ row: publicUpdates, name: characters.name })
      .from(publicUpdates)
      .innerJoin(characters, eq(characters.id, publicUpdates.characterId))
      .where(eq(publicUpdates.id, updateId));
    if (!r) throw new AppError('not_found', '公开动态不存在');
    return toDto(r.row, r.name);
  }

  async create(adminId: string, input: CreatePublicUpdateRequest): Promise<PublicUpdate> {
    const character = await this.realPersonCharacter(input.characterId);
    checkDates(input.startDate, input.endDate, input.effectiveDate);
    const now = this.clock.now();
    const effective = input.status === 'effective';
    const [row] = await this.database.db
      .insert(publicUpdates)
      .values({
        id: newId(),
        characterId: input.characterId,
        kind: input.kind,
        content: input.content,
        startDate: input.startDate,
        endDate: input.endDate,
        effectiveDate: input.effectiveDate,
        sourceUrl: input.sourceUrl,
        sourceKey: sourceKeyOf(input.sourceUrl),
        source: 'manual',
        status: input.status,
        reviewNote: null,
        createdBy: adminId,
        reviewedBy: effective ? adminId : null,
        reviewedAt: effective ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.audit.record({
      module: 'characters',
      action: 'public_update.created',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'public_update',
      targetId: row!.id,
      details: { characterId: input.characterId, status: input.status },
    });
    return toDto(row!, character.name);
  }

  async update(
    adminId: string,
    updateId: string,
    input: UpdatePublicUpdateRequest,
  ): Promise<PublicUpdate> {
    const row = await this.transition(adminId, updateId, ['draft', 'pending'], null, input);
    return this.withName(row);
  }

  async submit(adminId: string, updateId: string): Promise<PublicUpdate> {
    return this.withName(await this.transition(adminId, updateId, ['draft'], 'pending'));
  }

  async approve(
    adminId: string,
    updateId: string,
    edits: UpdatePublicUpdateRequest,
  ): Promise<PublicUpdate> {
    return this.withName(
      await this.transition(adminId, updateId, ['pending'], 'effective', edits, null),
    );
  }

  async reject(adminId: string, updateId: string, note: string | null): Promise<PublicUpdate> {
    return this.withName(
      await this.transition(adminId, updateId, ['pending'], 'rejected', {}, note),
    );
  }

  async withdraw(adminId: string, updateId: string, note: string | null): Promise<PublicUpdate> {
    return this.withName(
      await this.transition(adminId, updateId, ['effective'], 'withdrawn', {}, note),
    );
  }

  async remove(adminId: string, updateId: string): Promise<void> {
    const deleted = await this.database.db
      .delete(publicUpdates)
      .where(
        and(eq(publicUpdates.id, updateId), inArray(publicUpdates.status, ['draft', 'rejected'])),
      )
      .returning({ id: publicUpdates.id });
    if (deleted.length === 0) {
      await this.mustExist(updateId);
      throw new AppError('conflict', '只能删除草稿或已驳回的动态；已生效的请用撤回');
    }
    await this.audit.record({
      module: 'characters',
      action: 'public_update.deleted',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'public_update',
      targetId: updateId,
    });
  }

  async getSettings(): Promise<PublicUpdateSettings> {
    const [row] = await this.database.db
      .select()
      .from(publicUpdateSettings)
      .where(eq(publicUpdateSettings.id, SETTINGS_ID));
    return {
      autoSearchEnabled: row?.autoSearchEnabled ?? true,
      lastAutoRunAt: row?.lastAutoRunAt?.toISOString() ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async updateSettings(adminId: string, autoSearchEnabled: boolean): Promise<PublicUpdateSettings> {
    const now = this.clock.now();
    await this.database.db
      .insert(publicUpdateSettings)
      .values({ id: SETTINGS_ID, autoSearchEnabled, lastAutoRunAt: null, updatedAt: now })
      .onConflictDoUpdate({
        target: publicUpdateSettings.id,
        set: { autoSearchEnabled, updatedAt: now },
      });
    await this.audit.record({
      module: 'characters',
      action: 'public_update.settings_changed',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'public_update_settings',
      targetId: SETTINGS_ID,
      details: { autoSearchEnabled },
    });
    return this.getSettings();
  }

  // ---------------------------------------------------------------------------
  // 候选搜索
  // ---------------------------------------------------------------------------

  /** 管理员对单个角色手动触发一次（ADM-03 第 2 条）。手动触发不受「自动候选开关」限制。 */
  async triggerSearch(adminId: string, characterId: string): Promise<PublicUpdateSearchResult> {
    const [character] = await this.database.db
      .select({ id: characters.id, basis: characters.basis, name: characters.name })
      .from(characters)
      .where(eq(characters.id, characterId));
    if (!character) throw new AppError('not_found', '角色不存在');
    if (character.basis !== 'real_person')
      return { outcome: 'not_eligible', created: [], duplicates: 0 };
    const result = await this.searchCandidates(adminId, character, `manual:${newId()}`);
    await this.audit.record({
      module: 'characters',
      action: 'public_update.search_triggered',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'character',
      targetId: characterId,
      details: { outcome: result.outcome, created: result.created.length },
    });
    return result;
  }

  /** 每周任务：只针对已上架、真人、至少被一个用户添加的预设角色（prd-answers.md 第 7 节第 2 条）。 */
  async runWeekly(): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.autoSearchEnabled) return;
    const week = isoWeek(this.clock.now());
    const rows = await this.database.db
      .select({ id: characters.id })
      .from(characters)
      .where(
        and(
          eq(characters.kind, 'preset'),
          eq(characters.status, 'published'),
          eq(characters.basis, 'real_person'),
        ),
      );
    for (const row of rows) {
      if (!(await this.contactAccess.hasAnyContact?.(row.id))) continue;
      await this.jobs.send(
        PUBLIC_UPDATE_SEARCH_JOB,
        { characterId: row.id, week },
        { retryLimit: 1, singletonKey: `${row.id}:${week}` },
      );
    }
    const now = this.clock.now();
    await this.database.db
      .insert(publicUpdateSettings)
      .values({ id: SETTINGS_ID, autoSearchEnabled: true, lastAutoRunAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: publicUpdateSettings.id, set: { lastAutoRunAt: now } });
  }

  async runScheduledSearch(characterId: string, week: string): Promise<PublicUpdateSearchResult> {
    if (!(await this.getSettings()).autoSearchEnabled)
      return { outcome: 'disabled', created: [], duplicates: 0 };
    const [character] = await this.database.db
      .select({
        id: characters.id,
        basis: characters.basis,
        name: characters.name,
        status: characters.status,
      })
      .from(characters)
      .where(eq(characters.id, characterId));
    if (!character || character.basis !== 'real_person' || character.status !== 'published')
      return { outcome: 'not_eligible', created: [], duplicates: 0 };
    // 平台账户记账要求调用方是管理员：用第一个管理员账号作为「发起人」（只用于记账归属）。
    const [adminId] = await this.directory.listAdminUserIds();
    if (!adminId) return { outcome: 'unavailable', created: [], duplicates: 0 };
    return this.searchCandidates(adminId, character, `weekly:${week}`);
  }

  private async searchCandidates(
    adminId: string,
    character: { id: string; name: string },
    nonce: string,
  ): Promise<PublicUpdateSearchResult> {
    const today = toDate(this.clock.now());
    const result = await this.search.webSearch({
      userId: adminId,
      purpose: 'admin_public_update_search',
      billingOwner: 'platform',
      query: `${character.name} 最近${RECENCY_DAYS}天 新作品 演唱会 活动 行程 获奖`,
      maxResults: 10,
      idempotencyKey: `public_update_search:${character.id}:${nonce}`,
    });
    if (!result.ok) {
      this.logger.warn(
        { characterId: character.id, error: result.error },
        'public update search unavailable',
      );
      return { outcome: 'unavailable', created: [], duplicates: 0 };
    }
    const existing = await this.database.db
      .select({ sourceKey: publicUpdates.sourceKey, content: publicUpdates.content })
      .from(publicUpdates)
      .where(eq(publicUpdates.characterId, character.id));
    const seenKeys = new Set(existing.map((e) => e.sourceKey));
    const seenTexts = existing.map((e) => normalizeText(e.content));
    const oldest = addDays(today, -RECENCY_DAYS * 2);
    const created: PublicUpdate[] = [];
    let duplicates = 0;
    const now = this.clock.now();
    for (const item of result.value.items) {
      if (created.length >= MAX_CANDIDATES) break;
      const key = sourceKeyOf(item.url);
      const content = `${item.title}${item.snippet ? '：' + item.snippet : ''}`.trim().slice(0, 500);
      if (!content) continue;
      const text = normalizeText(content);
      if (seenKeys.has(key) || seenTexts.some((t) => similar(t, text))) {
        duplicates++;
        continue;
      }
      const published = item.publishedAt?.slice(0, 10);
      const startDate =
        published && isDate(published) && published >= oldest && published <= addDays(today, 365)
          ? published
          : today;
      const [row] = await this.database.db
        .insert(publicUpdates)
        .values({
          id: newId(),
          characterId: character.id,
          kind: 'other',
          content,
          startDate,
          endDate: null,
          effectiveDate: today,
          sourceUrl: item.url.slice(0, 2000),
          sourceKey: key,
          source: 'auto_search',
          status: 'pending',
          reviewNote: null,
          createdBy: null,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      seenKeys.add(key);
      seenTexts.push(text);
      created.push(toDto(row!, character.name));
    }
    return { outcome: 'ok', created, duplicates };
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private async transition(
    adminId: string,
    updateId: string,
    from: PublicUpdateStatus[],
    to: PublicUpdateStatus | null,
    edits: UpdatePublicUpdateRequest = {},
    note?: string | null,
  ): Promise<Row> {
    const current = await this.mustExist(updateId);
    if (!from.includes(current.status as PublicUpdateStatus))
      throw new AppError('conflict', `当前状态（${current.status}）不允许此操作`);
    const startDate = edits.startDate ?? current.startDate;
    const endDate = edits.endDate === undefined ? current.endDate : edits.endDate;
    const effectiveDate = edits.effectiveDate ?? current.effectiveDate;
    checkDates(startDate, endDate, effectiveDate);
    const now = this.clock.now();
    const set: Partial<Row> = {
      ...(edits.kind ? { kind: edits.kind } : {}),
      ...(edits.content ? { content: edits.content } : {}),
      ...(edits.sourceUrl
        ? { sourceUrl: edits.sourceUrl, sourceKey: sourceKeyOf(edits.sourceUrl) }
        : {}),
      startDate,
      endDate,
      effectiveDate,
      updatedAt: now,
    };
    if (to) {
      set.status = to;
      if (to !== 'pending') {
        set.reviewedBy = adminId;
        set.reviewedAt = now;
      }
      if (note !== undefined) set.reviewNote = note;
    }
    const [row] = await this.database.db
      .update(publicUpdates)
      .set(set)
      .where(and(eq(publicUpdates.id, updateId), eq(publicUpdates.status, current.status)))
      .returning();
    if (!row) throw new AppError('conflict', '动态状态已被其他操作改变，请刷新后重试');
    await this.audit.record({
      module: 'characters',
      action: to ? `public_update.${to}` : 'public_update.edited',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'public_update',
      targetId: updateId,
      details: { from: current.status, edited: Object.keys(edits) },
    });
    return row;
  }

  private async mustExist(updateId: string): Promise<Row> {
    const [row] = await this.database.db
      .select()
      .from(publicUpdates)
      .where(eq(publicUpdates.id, updateId));
    if (!row) throw new AppError('not_found', '公开动态不存在');
    return row;
  }

  private async withName(row: Row): Promise<PublicUpdate> {
    const [c] = await this.database.db
      .select({ name: characters.name })
      .from(characters)
      .where(eq(characters.id, row.characterId));
    return toDto(row, c?.name ?? '');
  }

  private async realPersonCharacter(characterId: string): Promise<{ name: string }> {
    const [c] = await this.database.db
      .select({ name: characters.name, basis: characters.basis, kind: characters.kind })
      .from(characters)
      .where(eq(characters.id, characterId));
    if (!c) throw new AppError('not_found', '角色不存在');
    if (c.basis !== 'real_person' || c.kind !== 'preset')
      throw new AppError('bad_request', '公开动态只能录给预设真人角色');
    return c;
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function toDto(r: Row, characterName: string): PublicUpdate {
  return {
    updateId: r.id,
    characterId: r.characterId,
    characterName,
    kind: r.kind as PublicUpdateKind,
    content: r.content,
    startDate: r.startDate,
    endDate: r.endDate,
    effectiveDate: r.effectiveDate,
    sourceUrl: r.sourceUrl,
    source: r.source as PublicUpdateSource,
    status: r.status as PublicUpdateStatus,
    reviewNote: r.reviewNote,
    createdBy: r.createdBy,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function checkDates(start: string, end: string | null, effective: string): void {
  if (end !== null && end < start) throw new AppError('bad_request', '结束日期不能早于开始日期');
  if (!isDate(start) || !isDate(effective) || (end !== null && !isDate(end)))
    throw new AppError('bad_request', '日期格式应为 YYYY-MM-DD');
}

function isDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function toDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDate(d);
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** 规范化来源链接：小写主机、去掉查询串和锚点、去掉末尾斜杠。 */
export function sourceKeyOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeText(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

/** 字符二元组 Dice 相似度 ≥ 0.8 视为重复。 */
function similar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  const total = Math.max(a.length - 1, 0) + Math.max(b.length - 1, 0);
  return total > 0 && (2 * inter) / total >= 0.8;
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (!id || !Id.safeParse(id).success || Number.isNaN(at.getTime()))
    throw new AppError('bad_request', '分页游标无效');
  return { at, id };
}

