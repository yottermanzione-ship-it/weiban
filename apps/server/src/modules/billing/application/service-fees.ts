/**
 * 3.8（总对照表 Q5）：服务费端口 BillingServiceFeePort 的实现——固定金额的冻结 / 扣除 / 退回。
 * 调用方：plaza 申请制作（提交冻结、完成扣除、被拒或撤回退回）。
 *
 * 与模型调用冻结（ReservationService）的区别：金额固定（不查价目表）、不过期、不占平台每日预算、
 * 不计入后台每日上限、不允许透支。冻结同样计入账户 held_micros；扣除经 Ledger.postEntry 写 charge 流水
 * （purpose = service_fee，用户端分类 service，note = 调用方给的说明）。加锁顺序同 Ledger：账户 → 冻结记录。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  BillingServiceFeePort,
  IdentityReadPort,
  PortResult,
  ServiceFeeHold,
  ServiceFeeHoldInput,
} from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import {
  CLOCK,
  DATABASE,
  newId,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { safeTimeZone } from '../domain/local-time.js';
import { SERVICE_FEE_PURPOSE } from '../domain/rules.js';
import { feeHolds } from '../infra/db/schema.js';
import { available, Ledger } from './ledger.js';
import { BillingUsageError } from './reservations.js';

type FeeHoldRow = typeof feeHolds.$inferSelect;

const KINDS = new Set(['role_request']);

@Injectable()
export class ServiceFeeService implements BillingServiceFeePort {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async hold(
    input: ServiceFeeHoldInput,
  ): Promise<PortResult<ServiceFeeHold, 'insufficient_balance'>> {
    if (!KINDS.has(input.kind)) throw new BillingUsageError(`未知服务费种类 ${input.kind}`);
    if (!Number.isSafeInteger(input.amountMicros) || input.amountMicros <= 0)
      throw new BillingUsageError('服务费金额必须是正整数微元');
    if (!input.idempotencyKey) throw new BillingUsageError('服务费冻结缺少幂等键');
    const timeZone = safeTimeZone((await this.identity.getProfile(input.userId))?.timeZone);
    return this.database.transaction(async (tx) => {
      const account = await this.ledger.lockUserAccount(tx, input.userId, timeZone);
      const [existing] = await tx.db
        .select()
        .from(feeHolds)
        .where(eq(feeHolds.idempotencyKey, input.idempotencyKey));
      if (existing) {
        if (existing.accountId !== account.id || existing.amountMicros !== input.amountMicros)
          throw new BillingUsageError('同一个幂等键被用于不同的服务费冻结');
        return { ok: true as const, value: toDto(existing) };
      }
      if (available(account) < input.amountMicros)
        return { ok: false as const, error: 'insufficient_balance' as const, message: '积分不足' };
      const row: FeeHoldRow = {
        id: newId(),
        accountId: account.id,
        kind: input.kind,
        amountMicros: input.amountMicros,
        idempotencyKey: input.idempotencyKey,
        note: input.note.slice(0, 100),
        status: 'active',
        createdAt: this.clock.now(),
        closedAt: null,
        ledgerEntryId: null,
      };
      await tx.db.insert(feeHolds).values(row);
      await this.ledger.changeHeld(tx, account, input.amountMicros);
      return { ok: true as const, value: toDto(row) };
    });
  }

  async settle(holdId: string): Promise<{ ledgerEntryId: string; amountMicros: number }> {
    const first = await this.find(holdId);
    return this.database.transaction(async (tx) => {
      const account = await this.ledger.lockAccountById(tx, first.accountId);
      const hold = await this.lock(tx, holdId);
      if (hold.status === 'settled')
        return { ledgerEntryId: hold.ledgerEntryId!, amountMicros: hold.amountMicros };
      if (hold.status === 'released') throw new BillingUsageError('该服务费已退回，不能再扣除');
      const { entry } = await this.ledger.postEntry(tx, account, {
        type: 'charge',
        amountMicros: -hold.amountMicros,
        idempotencyKey: `service_fee:${hold.id}`,
        holdId: hold.id,
        purpose: SERVICE_FEE_PURPOSE,
        costMicros: 0,
        reason: hold.note,
        releaseHeldMicros: hold.amountMicros,
      });
      await tx.db
        .update(feeHolds)
        .set({ status: 'settled', closedAt: this.clock.now(), ledgerEntryId: entry.id })
        .where(eq(feeHolds.id, hold.id));
      return { ledgerEntryId: entry.id, amountMicros: hold.amountMicros };
    });
  }

  async release(holdId: string): Promise<void> {
    const first = await this.find(holdId);
    await this.database.transaction(async (tx) => {
      const account = await this.ledger.lockAccountById(tx, first.accountId);
      const hold = await this.lock(tx, holdId);
      if (hold.status === 'released') return;
      if (hold.status === 'settled') throw new BillingUsageError('该服务费已扣除，不能再退回');
      await this.ledger.changeHeld(tx, account, -hold.amountMicros);
      await tx.db
        .update(feeHolds)
        .set({ status: 'released', closedAt: this.clock.now() })
        .where(eq(feeHolds.id, hold.id));
    });
  }

  async get(holdId: string): Promise<ServiceFeeHold | null> {
    const [row] = await this.database.db.select().from(feeHolds).where(eq(feeHolds.id, holdId));
    return row ? toDto(row) : null;
  }

  private async find(holdId: string): Promise<FeeHoldRow> {
    const [row] = await this.database.db.select().from(feeHolds).where(eq(feeHolds.id, holdId));
    if (!row) throw new BillingUsageError('服务费冻结不存在');
    return row;
  }

  private async lock(tx: DbTx, holdId: string): Promise<FeeHoldRow> {
    const [row] = await tx.db.select().from(feeHolds).where(eq(feeHolds.id, holdId)).for('update');
    if (!row) throw new BillingUsageError('服务费冻结不存在');
    return row;
  }
}

function toDto(row: FeeHoldRow): ServiceFeeHold {
  return {
    holdId: row.id,
    amountMicros: row.amountMicros,
    status: row.status as ServiceFeeHold['status'],
  };
}
