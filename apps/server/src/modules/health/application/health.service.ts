/**
 * 经期日记的用户侧用例（HealthEndpoints）与 HealthReadPort 实现。
 * 需求：PLAY-01；设计：docs/architecture/health-data.md；实现说明：docs/backend/health.md。
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  CreateCycleRequest,
  CycleRecord,
  HealthEndpoints,
  Id,
  PredictionResult,
  UpdateAuthorizationRequest,
  UpdateCycleRequest,
  type AuthorizationResponse,
  type ContactsReadPort,
  type HealthReadPort,
  type HealthReadScene,
  type IdentityReadPort,
  type PeriodContext,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  parseContract,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import {
  P37,
  PREDICTION_DISCLAIMER,
  currentStatus,
  effectiveEnd,
  localDate,
  overlaps,
  predict,
} from '../domain/prediction.js';
import { grants } from '../infra/db/schema.js';
import { HealthStore, type LoadedCycle } from './store.js';

const ALLOWED_SCENES: ReadonlySet<HealthReadScene> = new Set([
  'direct_reply',
  'proactive_direct',
  'planning',
]);

function toRecord(c: LoadedCycle): CycleRecord {
  return CycleRecord.parse({
    cycleId: c.id,
    startDate: c.startDate,
    endDate: c.endDate,
    dayLogs: c.dayLogs.map((l) => ({
      date: l.date,
      flow: l.flow,
      pain: l.pain,
      symptoms: l.symptoms,
      notes: l.notes,
    })),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  });
}

@Injectable()
export class HealthService implements HealthReadPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(HealthStore) private readonly store: HealthStore,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
  ) {}

  /** 用户时区下的「今天」。 */
  private async today(userId: string, tx?: DbTx): Promise<string> {
    const profile = await this.identity.getProfile(userId, tx);
    return localDate(this.clock.now(), profile?.timeZone ?? 'Asia/Shanghai');
  }

  private assertNoOverlap(
    cycles: LoadedCycle[],
    selfId: string | null,
    start: string,
    end: string,
    today: string,
  ): void {
    for (const c of cycles) {
      if (c.id === selfId) continue;
      if (overlaps(start, end, c.startDate, effectiveEnd(c, today)))
        throw new AppError('conflict', '这段日期与已有的经期记录重叠');
    }
  }

  // ---------- 用户侧接口 ----------

  async createCycle(userId: string, input: unknown): Promise<CycleRecord> {
    const body = parseContract(CreateCycleRequest, input);
    return this.db.transaction(async (tx) => {
      const today = await this.today(userId, tx);
      if (body.startDate > today) throw new AppError('bad_request', '开始日不能晚于今天');
      const cycles = await this.store.loadAll(tx, userId);
      this.assertNoOverlap(cycles, null, body.startDate, body.startDate, today);
      const id = await this.store.insertCycle(tx, userId, {
        startDate: body.startDate,
        endDate: null,
      });
      const created = (await this.store.loadAll(tx, userId)).find((c) => c.id === id);
      if (!created) throw new AppError('internal_error', '记录未能保存');
      return toRecord(created);
    });
  }

  async updateCycle(userId: string, cycleId: string, input: unknown): Promise<CycleRecord> {
    parseContract(Id, cycleId);
    const body = parseContract(UpdateCycleRequest, input);
    return this.db.transaction(async (tx) => {
      const today = await this.today(userId, tx);
      const cycles = await this.store.loadAll(tx, userId);
      const cycle = cycles.find((c) => c.id === cycleId);
      if (!cycle) throw new AppError('not_found', '经期记录不存在');
      if (body.endDate !== undefined) {
        if (body.endDate < cycle.startDate)
          throw new AppError('bad_request', '结束日不能早于开始日');
        if (body.endDate > today) throw new AppError('bad_request', '结束日不能晚于今天');
        this.assertNoOverlap(cycles, cycle.id, cycle.startDate, body.endDate, today);
        await this.store.updateCycle(tx, userId, cycle.id, {
          startDate: cycle.startDate,
          endDate: body.endDate,
        });
        // 结束日提前后，落在范围外的日记一并删除（它们已不属于这次经期）。
        const outside = cycle.dayLogs.filter((l) => l.date > body.endDate!);
        await this.store.deleteEntries(
          tx,
          userId,
          outside.map((l) => l.entryId),
        );
        cycle.endDate = body.endDate;
        cycle.dayLogs = cycle.dayLogs.filter((l) => l.date <= body.endDate!);
      }
      if (body.dayLog) {
        const log = body.dayLog;
        if (log.date < cycle.startDate || log.date > today)
          throw new AppError('bad_request', '日记日期不在这次经期内');
        if (cycle.endDate && log.date > cycle.endDate)
          throw new AppError('bad_request', '日记日期不在这次经期内');
        const symptoms = [...new Set(log.symptoms)];
        const existing = cycle.dayLogs.find((l) => l.date === log.date);
        await this.store.upsertDayLog(tx, userId, existing?.entryId ?? null, {
          cycleId: cycle.id,
          date: log.date,
          flow: log.flow,
          pain: log.pain,
          symptoms,
          notes: log.notes,
        });
        if (body.endDate === undefined) await this.store.touch(tx, userId, cycle.id);
      }
      const updated = (await this.store.loadAll(tx, userId)).find((c) => c.id === cycleId);
      if (!updated) throw new AppError('internal_error', '记录未能保存');
      return toRecord(updated);
    });
  }

  async deleteCycle(userId: string, cycleId: string): Promise<void> {
    parseContract(Id, cycleId);
    await this.db.transaction(async (tx) => {
      const cycles = await this.store.loadAll(tx, userId);
      const cycle = cycles.find((c) => c.id === cycleId);
      if (!cycle) throw new AppError('not_found', '经期记录不存在');
      await this.store.deleteEntries(tx, userId, [
        ...cycle.dayLogs.map((l) => l.entryId),
        cycle.id,
      ]);
    });
  }

  async listCycles(userId: string, input: unknown) {
    const query = parseContract(HealthEndpoints.listCycles.query!, input) as {
      cursor?: string;
      limit: number;
    };
    const offset = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new AppError('bad_request', '游标不正确');
    const cycles = await this.db.transaction((tx) => this.store.loadAll(tx, userId));
    const page = cycles.slice(offset, offset + query.limit);
    const next = offset + page.length;
    return {
      items: page.map(toRecord),
      nextCursor: next < cycles.length ? String(next) : null,
    };
  }

  async getPrediction(userId: string): Promise<PredictionResult> {
    return this.db.transaction(async (tx) => {
      const today = await this.today(userId, tx);
      const cycles = await this.store.loadAll(tx, userId);
      return PredictionResult.parse({
        ...predict(cycles, today),
        disclaimer: PREDICTION_DISCLAIMER,
      });
    });
  }

  async getAuthorization(userId: string): Promise<AuthorizationResponse> {
    return { authorizedCharacterIds: await this.getAuthorizedCharacters(userId) };
  }

  async updateAuthorization(userId: string, input: unknown): Promise<AuthorizationResponse> {
    const body = parseContract(UpdateAuthorizationRequest, input);
    const wanted = [...new Set(body.authorizedCharacterIds)];
    return this.db.transaction(async (tx) => {
      for (const characterId of wanted) {
        const contact = await this.contacts.getActiveContact(userId, characterId, tx);
        if (!contact || contact.status !== 'active')
          throw new AppError('bad_request', '只能授权通讯录里的角色');
      }
      const current = await tx.db
        .select({ characterId: grants.characterId })
        .from(grants)
        .where(eq(grants.userId, userId));
      const have = new Set(current.map((r) => r.characterId));
      const removed = [...have].filter((id) => !wanted.includes(id));
      const added = wanted.filter((id) => !have.has(id));
      if (removed.length)
        await tx.db
          .delete(grants)
          .where(and(eq(grants.userId, userId), inArray(grants.characterId, removed)));
      const at = this.clock.now();
      for (const characterId of added)
        await tx.db
          .insert(grants)
          .values({ userId, characterId, grantedAt: at })
          .onConflictDoNothing();
      // 审计只记「谁授权 / 撤销了哪个角色」，不记任何经期内容（health-data.md 第 6 节）。
      if (added.length || removed.length)
        await this.audit.record(
          {
            module: 'health',
            action: 'health.authorization_updated',
            actorType: 'user',
            actorId: userId,
            targetType: 'user',
            targetId: userId,
            details: { added, removed },
          },
          tx,
        );
      return { authorizedCharacterIds: wanted.sort() };
    });
  }

  // ---------- HealthReadPort（只给 ai-runtime） ----------

  async getAuthorizedCharacters(userId: string): Promise<string[]> {
    parseContract(Id, userId);
    const rows = await this.db.db
      .select({ characterId: grants.characterId })
      .from(grants)
      .where(eq(grants.userId, userId))
      .orderBy(grants.grantedAt, grants.characterId);
    return rows.map((r) => r.characterId);
  }

  async getPeriodContext(input: {
    userId: string;
    characterId: string;
    scene: HealthReadScene;
  }): Promise<PeriodContext | null> {
    if (!ALLOWED_SCENES.has(input.scene)) return null;
    parseContract(Id, input.userId);
    parseContract(Id, input.characterId);
    return this.db.transaction(async (tx) => {
      // 每次实时查授权（不缓存），撤销立即生效。
      const [grant] = await tx.db
        .select()
        .from(grants)
        .where(and(eq(grants.userId, input.userId), eq(grants.characterId, input.characterId)));
      if (!grant) return null;
      const cycles = await this.store.loadAll(tx, input.userId);
      if (!cycles.length) return null;
      const today = await this.today(input.userId, tx);
      const status = currentStatus(cycles, today);
      const prediction = predict(cycles, today);
      const todayLog = cycles.flatMap((c) => c.dayLogs).find((l) => l.date === today) ?? null;
      // cycleKey：以「上一次经期」为锚点的不透明哈希，不含日期。经期前提醒与该次经期中的关心
      // 落在同一个 key 下（提醒时锚点是最近一次经期；进入新经期后锚点是它的前一次）。
      const ascending = [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
      let anchor: string;
      if (status.current) {
        const idx = ascending.findIndex((c) => c.id === status.current!.id);
        anchor = idx > 0 ? ascending[idx - 1]!.id : 'first';
      } else {
        anchor = ascending[ascending.length - 1]!.id;
      }
      const cycleKey = createHash('sha256')
        .update(`weiban.health.cycle:${input.userId}:${anchor}`)
        .digest('base64url')
        .slice(0, 22);
      return {
        inPeriod: status.inPeriod,
        dayOfPeriod: status.dayOfPeriod,
        predictedNextStart: prediction.predictedNextStart,
        todayPain: todayLog?.pain ?? null,
        todaySymptoms: todayLog?.symptoms ?? [],
        longPeriodHint: status.inPeriod && (status.dayOfPeriod ?? 0) > P37.longPeriodDays,
        prediction: prediction.confidence,
        cycleKey,
      };
    });
  }
}
