/**
 * billing 的启动登记：注册事件订阅（注册赠送，billing.md 8.3）、删除清单（billing.md 第 11 节）、定时任务
 * （每分钟清理过期冻结、每天 3:30 北京时间对账前一天）。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { IdentityAccountStatusPort, IdentityReadPort, UserDataOwner } from '@weiban/contracts';
import {
  AUDIT_LOG,
  DATABASE,
  EVENT_BUS,
  JOB_QUEUE,
  LOGGER,
  USER_DATA_REGISTRY,
  type AuditLog,
  type Database,
  type DbTx,
  type EventBus,
  type JobQueue,
  type Logger,
  type UserDataRegistry,
} from '../../../platform/index.js';
import {
  hashUserId,
  IDENTITY_ACCOUNT_STATUS_PORT,
  IDENTITY_READ_PORT,
} from '../../identity/index.js';
import { Ledger } from './ledger.js';
import { ReconciliationService } from './reconciliation.js';
import { ReservationService } from './reservations.js';

export const EXPIRE_HOLDS_JOB = 'billing.expire_holds';
export const RECONCILE_JOB = 'billing.reconcile';
/** 注册赠送流水的备注（用户在余额明细里看到「管理员加余额 · 注册赠送」）。 */
export const SIGNUP_BONUS_REASON = '注册赠送';

@Injectable()
export class BillingLifecycle implements OnModuleInit, UserDataOwner {
  readonly module = 'billing' as const;
  private readonly log: Logger;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(ReservationService) private readonly reservations: ReservationService,
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accountStatus: IdentityAccountStatusPort,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'billing' });
  }

  async onModuleInit(): Promise<void> {
    this.registry.register(this);
    this.bus.subscribe({
      consumer: 'billing.on_user_registered',
      eventType: 'identity.user_registered',
      handle: (event, tx) => this.onUserRegistered(event.payload, tx),
    });
    await this.jobs.work(EXPIRE_HOLDS_JOB, async () => {
      await this.reservations.expireHolds();
    });
    await this.jobs.work(RECONCILE_JOB, async () => {
      await this.reconciliation.runForYesterday();
    });
    await this.jobs.schedule(EXPIRE_HOLDS_JOB, '* * * * *');
    await this.jobs.schedule(RECONCILE_JOB, '30 3 * * *');
  }

  /**
   * identity.user_registered（billing.md 8.3 第 2 条）：账号仍是 active 才处理；建钱包（已有则跳过）；
   * 有注册赠送时写一条 admin_grant（幂等键 signup_bonus:{userId}，重复投递只记一次）。
   * 只做数据库写入（订阅者要快，规范 3.4 第 2 条）。
   */
  async onUserRegistered(
    payload: {
      userId: string;
      signupBonus?: { amountMicros: number; grantedByUserId: string | null } | undefined;
    },
    tx: DbTx,
  ): Promise<void> {
    const { userId, signupBonus } = payload;
    const status = await this.accountStatus.getAccountStatus(userId);
    if (status !== 'active') {
      this.log.info({ status }, '注册事件到达时账号已不是 active，跳过建钱包');
      return;
    }
    const timeZone = (await this.identity.getProfile(userId))?.timeZone;
    if (!signupBonus) {
      await this.ledger.createUserAccountIfMissing(tx, userId, timeZone);
      return;
    }
    const account = await this.ledger.lockUserAccount(tx, userId, timeZone);
    const key = `signup_bonus:${userId}`;
    if (await this.ledger.findByIdempotencyKey(tx, key)) return;
    await this.ledger.postEntry(tx, account, {
      type: 'admin_grant',
      amountMicros: signupBonus.amountMicros,
      idempotencyKey: key,
      reason: SIGNUP_BONUS_REASON,
      operatorUserId: signupBonus.grantedByUserId,
    });
  }

  // ---------- 删除清单（UserDataOwner） ----------

  /** 物理删除该用户的钱包、流水、冻结、每日汇总（数据库函数 billing.purge_user_account）。可重复调用。 */
  async purgeUser(userId: string): Promise<number> {
    return this.database.transaction(async (tx) => {
      const { rows: before } = await tx.query<{ balance: string }>(
        `SELECT balance_micros AS balance FROM billing.accounts WHERE user_id = $1`,
        [userId],
      );
      const { rows } = await tx.query<{ n: number }>(`SELECT billing.purge_user_account($1) AS n`, [
        userId,
      ]);
      const deleted = Number(rows[0]?.n ?? 0);
      if (before[0]) {
        // 审计只记用户 ID 的哈希和删除时余额（billing.md 第 11 节）；负余额 = 平台承担的透支（TD-024）
        await this.audit.record(
          {
            module: 'billing',
            action: 'wallet.purged',
            actorType: 'system',
            targetType: 'user_hash',
            targetId: hashUserId(userId),
            details: { balanceAtDeletionMicros: Number(before[0].balance), deletedRows: deleted },
          },
          tx,
        );
      }
      return deleted;
    });
  }

  async countUserData(userId: string): Promise<number> {
    const { rows } = await this.database.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM billing.accounts WHERE user_id = $1)
            + (SELECT count(*) FROM billing.ledger_entries l JOIN billing.accounts a ON a.id = l.account_id
                WHERE a.user_id = $1)
            + (SELECT count(*) FROM billing.holds h JOIN billing.accounts a ON a.id = h.account_id
                WHERE a.user_id = $1)
            + (SELECT count(*) FROM billing.daily_spend d JOIN billing.accounts a ON a.id = d.account_id
                WHERE a.user_id = $1) AS n`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
