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
import type { Events, UserDataOwner } from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import {
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

  /** 任务：执行某个模块的删除清单并回报。可重复执行。 */
  async runPurgeJob({ userId, module }: PurgeJob): Promise<void> {
    const owner = this.registry.list().find((o) => o.module === module);
    if (!owner) throw new Error(`模块 ${module} 没有登记删除清单`);
    const deletedRows = await owner.purgeUser(userId);
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
    await this.purgeIdentityData(tx, userId, user.username);
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
    this.log.info({ userIdHash: hashUserId(userId) }, '账号注销完成');
    return true;
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
