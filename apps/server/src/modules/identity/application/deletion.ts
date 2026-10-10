/**
 * 注销编排（删除清单框架，security-and-privacy.md 第 5.1 节；说明见 docs/backend/identity.md 第 6 节）。
 *
 * 1. AccountService.requestDeletion 发布 identity.user_deletion_requested。
 * 2. identity.on_user_deletion_requested：对删除清单登记处（platform USER_DATA_REGISTRY）里的每个模块
 *    （identity 自己除外）在同一事务投递一个 pg-boss 任务 identity.purge_user_data（订阅者只做快速的数据库写入，
 *    删除这种可能很慢的工作放进任务，engineering-standards.md 第 3.4 节第 2 条）。
 *    任务执行该模块的 purgeUser(userId)，再发布 platform.user_data_purged（模块名、删除行数）。
 *    任务至少执行一次，purgeUser 必须可重复调用（第二次通常返回 0）。
 * 3. identity.on_user_data_purged：记入 identity.deletion_progress；登记的模块全部回报后，
 *    删除 identity 自己的数据（账号行，级联删除资料、设置、会话、进度），写审计（只记用户 ID 的哈希）。
 *    没有其他模块登记时，第 2 步直接完成。
 *
 * identity 自己也登记为删除清单（只用于 countUserData 核验；它的删除由第 3 步在最后执行）。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Events, PendingAccountDeletion, UserDataOwner } from '@weiban/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  EVENT_BUS,
  JOB_QUEUE,
  LOGGER,
  OUTBOX,
  USER_DATA_REGISTRY,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type EventBus,
  type JobQueue,
  type Logger,
  type Outbox,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { throttleKey } from '../domain/rules.js';
import { deletionProgress, loginThrottle, users } from '../infra/db/schema.js';
import { hashUserId } from './user-hash.js';

const IDENTITY: Events.ModuleName = 'identity';
export const PURGE_JOB = 'identity.purge_user_data';
/** 注销完成后清理平台表里的残留痕迹（已送达事件、审计中的明文 ID），完成时一次 + 1 小时后再一次。 */
export const SCRUB_JOB = 'identity.scrub_user_traces';
/** 完成判定前的复核轮数上限：超过后停在「注销未完成」，交管理员重新触发（重新触发会清零）。 */
export const MAX_DELETION_RECHECKS = 3;

interface PurgeJob {
  userId: string;
  module: Events.ModuleName;
}

@Injectable()
export class DeletionService implements OnModuleInit, UserDataOwner {
  readonly module = IDENTITY;
  private readonly log: Logger;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'identity' });
  }

  async onModuleInit(): Promise<void> {
    this.registry.register(this);
    await this.jobs.work<PurgeJob>(PURGE_JOB, (job) => this.runPurgeJob(job.data));
    await this.jobs.work<{ userId: string }>(SCRUB_JOB, (job) => this.scrubTraces(job.data.userId));
    this.bus.subscribe({
      consumer: 'identity.on_user_deletion_requested',
      eventType: 'identity.user_deletion_requested',
      handle: async (event, tx) => {
        const { userId } = event.payload;
        const owners = this.registry.modules().filter((m) => m !== IDENTITY);
        for (const module of owners) {
          await this.jobs.send<PurgeJob>(
            PURGE_JOB,
            { userId, module },
            { tx, singletonKey: `${module}:${userId}`, retryLimit: 10, retryBackoff: true },
          );
        }
        // 没有其他模块登记删除清单时，直接完成
        if (owners.length === 0) await this.tryFinalize(tx, userId);
      },
    });
    this.bus.subscribe({
      consumer: 'identity.on_user_data_purged',
      eventType: 'platform.user_data_purged',
      handle: async (event, tx) => {
        const { userId, module, deletedRows } = event.payload;
        const [user] = await tx.db
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        // 账号已删除完（重复投递 / 迟到的回报）或不在注销中：忽略
        if (!user || user.status !== 'deleting') return;
        await tx.db
          .insert(deletionProgress)
          .values({ userId, module, deletedRows, reportedAt: this.clock.now() })
          .onConflictDoNothing();
        await this.tryFinalize(tx, userId);
      },
    });
  }

  // ---------- 管理接口：注销未完成的账号（security-and-privacy.md 5.1 第 2 条，契约 1.2） ----------

  /** 全部「注销中」的账号，按申请时间从早到晚，含每个模块的删除进度。 */
  async listPending(): Promise<PendingAccountDeletion[]> {
    const rows = await this.database.db
      .select()
      .from(users)
      .where(eq(users.status, 'deleting'))
      .orderBy(asc(users.deletionRequestedAt), asc(users.id));
    const result: PendingAccountDeletion[] = [];
    for (const user of rows) result.push(await this.progressOf(this.database.db, user));
    return result;
  }

  /**
   * 重新触发删除：对尚未回报的模块（含注销之后才登记的模块）重新投递删除任务；全部已回报时直接完成账号删除。
   * 返回触发后的进度快照（账号已删完时 modules 全部为已回报）。账号不存在或不在注销中 → 404。可重复调用。
   */
  async retry(userId: string, operatorUserId: string): Promise<PendingAccountDeletion> {
    return this.database.transaction(async (tx) => {
      const [user] = await tx.db.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user || user.status !== 'deleting') {
        throw new AppError('not_found', '该账号不存在或不在注销中');
      }
      const now = this.clock.now();
      await tx.db
        .update(users)
        .set({ deletionRetriggeredAt: now, deletionRechecks: 0 })
        .where(eq(users.id, userId));
      const reported = new Set(
        (
          await tx.db
            .select({ module: deletionProgress.module })
            .from(deletionProgress)
            .where(eq(deletionProgress.userId, userId))
        ).map((r) => r.module),
      );
      const pending = this.registry.modules().filter((m) => m !== IDENTITY && !reported.has(m));
      for (const module of pending) {
        await this.jobs.send<PurgeJob>(
          PURGE_JOB,
          { userId, module },
          { tx, singletonKey: `${module}:${userId}`, retryLimit: 10, retryBackoff: true },
        );
      }
      await this.audit.record(
        {
          module: 'identity',
          action: 'user.deletion_retriggered',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'user_hash',
          targetId: hashUserId(userId),
          details: { pendingModules: pending },
        },
        tx,
      );
      const snapshot = await this.progressOf(tx.db, { ...user, deletionRetriggeredAt: now });
      if (pending.length === 0) await this.tryFinalize(tx, userId);
      return snapshot;
    });
  }

  private async progressOf(
    db: Database['db'],
    user: typeof users.$inferSelect,
  ): Promise<PendingAccountDeletion> {
    const reported = await db
      .select()
      .from(deletionProgress)
      .where(eq(deletionProgress.userId, user.id));
    const byModule = new Map(reported.map((r) => [r.module, r]));
    const modules = [
      ...new Set([
        ...this.registry.modules().filter((m) => m !== IDENTITY),
        ...reported.map((r) => r.module),
      ]),
    ];
    return {
      userId: user.id,
      username: user.username,
      requestedAt: (user.deletionRequestedAt ?? user.updatedAt).toISOString(),
      lastRetriggeredAt: user.deletionRetriggeredAt?.toISOString() ?? null,
      modules: modules.map((module) => {
        const r = byModule.get(module);
        return {
          module: module as PendingAccountDeletion['modules'][number]['module'],
          purged: r !== undefined,
          deletedRows: r?.deletedRows ?? null,
          purgedAt: r?.reportedAt.toISOString() ?? null,
        };
      }),
    };
  }

  /** 任务：执行某个模块的删除清单并回报。可重复执行。 */
  async runPurgeJob({ userId, module }: PurgeJob): Promise<void> {
    const owner = this.registry.list().find((o) => o.module === module);
    if (!owner) throw new Error(`模块 ${module} 没有登记删除清单`);
    let deletedRows: number;
    try {
      deletedRows = await owner.purgeUser(userId);
    } catch (error) {
      // 只记用户 ID 的哈希；任务失败由 pg-boss 自动重试（retryLimit 10，指数退避），用尽后停在「注销未完成」
      this.log.warn(
        {
          userIdHash: hashUserId(userId),
          module,
          err: error instanceof Error ? error.message : String(error),
        },
        '删除清单执行失败，等待重试',
      );
      throw error;
    }
    await this.database.transaction((tx) =>
      this.outbox.publish(tx, 'platform.user_data_purged', module, { userId, module, deletedRows }),
    );
  }

  /** 登记的模块（identity 除外）是否都已回报；是则删除账号本身。 */
  async tryFinalize(tx: DbTx, userId: string): Promise<boolean> {
    const [user] = await tx.db
      .select({ status: users.status, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user || user.status !== 'deleting') return false;
    const reported = new Set(
      (
        await tx.db
          .select({ module: deletionProgress.module })
          .from(deletionProgress)
          .where(eq(deletionProgress.userId, userId))
      ).map((r) => r.module),
    );
    const pending = this.registry.modules().filter((m) => m !== IDENTITY && !reported.has(m));
    if (pending.length > 0) return false;
    // 完成判定：全部回报后逐模块复核剩余条数（防止删除期间仍在运行的任务又写入数据）。
    const leftovers = await this.leftoverModules(userId);
    if (leftovers.length > 0) {
      await tx.db
        .delete(deletionProgress)
        .where(
          and(eq(deletionProgress.userId, userId), inArray(deletionProgress.module, leftovers)),
        );
      const [row] = await tx.db
        .update(users)
        .set({ deletionRechecks: sql`${users.deletionRechecks} + 1` })
        .where(eq(users.id, userId))
        .returning({ rechecks: users.deletionRechecks });
      const rechecks = row?.rechecks ?? MAX_DELETION_RECHECKS + 1;
      if (rechecks <= MAX_DELETION_RECHECKS) {
        for (const module of leftovers)
          await this.jobs.send<PurgeJob>(
            PURGE_JOB,
            { userId, module },
            { tx, retryLimit: 10, retryBackoff: true },
          );
      }
      this.log.warn(
        { userIdHash: hashUserId(userId), modules: leftovers, rechecks },
        rechecks <= MAX_DELETION_RECHECKS
          ? '复核发现残留，已重新投递删除'
          : '复核多次仍有残留，停在「注销未完成」等待管理员重新触发',
      );
      return false;
    }
    await this.purgeIdentityData(tx, userId, user.username);
    await this.audit.anonymizeUser(userId, hashUserId(userId), tx);
    await this.audit.record(
      {
        module: 'identity',
        action: 'user.deleted',
        actorType: 'system',
        targetType: 'user_hash',
        targetId: hashUserId(userId),
        details: { modules: [...reported] },
      },
      tx,
    );
    await this.jobs.send(SCRUB_JOB, { userId }, { tx, retryLimit: 5, retryBackoff: true });
    await this.jobs.send(
      SCRUB_JOB,
      { userId },
      { tx, delayMs: 3_600_000, retryLimit: 5, retryBackoff: true },
    );
    this.log.info({ userIdHash: hashUserId(userId) }, '账号注销完成');
    return true;
  }

  /** 复核：除 identity 外剩余条数大于 0 的模块。 */
  private async leftoverModules(userId: string): Promise<Events.ModuleName[]> {
    const result: Events.ModuleName[] = [];
    for (const owner of this.registry.list()) {
      if (owner.module === IDENTITY) continue;
      if ((await owner.countUserData(userId)) > 0) result.push(owner.module as Events.ModuleName);
    }
    return result;
  }

  /** 任务：清理平台表残留（已送达事件载荷、迟到审计中的明文 ID）。账号仍在注销中时跳过。可重复执行。 */
  async scrubTraces(userId: string): Promise<void> {
    const [user] = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));
    if (user) return;
    const events = await this.outbox.scrubDelivered(this.database, userId);
    const audits = await this.audit.anonymizeUser(userId, hashUserId(userId));
    this.log.info({ userIdHash: hashUserId(userId), events, audits }, '注销残留痕迹已清理');
  }

  /** identity 自己的删除：登录锁定记录 + 账号行（级联删除资料、设置、偏好、会话、注销进度）。 */
  private async purgeIdentityData(tx: DbTx, userId: string, username: string): Promise<number> {
    const throttle = await tx.db
      .delete(loginThrottle)
      .where(eq(loginThrottle.key, throttleKey('username', username)))
      .returning({ key: loginThrottle.key });
    const counted = await this.countWith(tx, userId);
    await tx.db.delete(users).where(eq(users.id, userId));
    return counted + throttle.length;
  }

  // ---------- UserDataOwner（identity 自己） ----------

  /** 强制删除 identity 中该用户的全部数据（正常流程不直接调用，由 tryFinalize 在最后执行）。 */
  async purgeUser(userId: string): Promise<number> {
    return this.database.transaction(async (tx) => {
      const [user] = await tx.db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId));
      if (!user) return 0;
      return this.purgeIdentityData(tx, userId, user.username);
    });
  }

  async countUserData(userId: string): Promise<number> {
    return this.database.transaction((tx) => this.countWith(tx, userId));
  }

  private async countWith(tx: DbTx, userId: string): Promise<number> {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM identity.users WHERE id = $1)
            + (SELECT count(*) FROM identity.sessions WHERE user_id = $1)
            + (SELECT count(*) FROM identity.profiles WHERE user_id = $1)
            + (SELECT count(*) FROM identity.notification_settings WHERE user_id = $1)
            + (SELECT count(*) FROM identity.preferences WHERE user_id = $1)
            + (SELECT count(*) FROM identity.deletion_progress WHERE user_id = $1) AS n`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
