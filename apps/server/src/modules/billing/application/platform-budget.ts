/**
 * 平台每日总上限：原子预留（billing.md 第 7 节第 2 条，Q-007）。
 *
 * 冻结时在同一事务里执行一条带条件的 UPDATE：
 *   reserved += 预留成本 WHERE settled + reserved + 预留成本 <= cap
 * 更新到 0 行 = 超上限。这一行的行锁让并发请求排队检查，不会同时通过。
 * 结算：reserved −= 预留、settled += 实际成本（实际成本可能略高于预留，允许小幅超出，以估算偏差为界）。
 * 解冻 / 过期：归还预留；平台吸收的失败调用成本计入 settled。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  APP_CONFIG,
  AUDIT_LOG,
  CLOCK,
  LOGGER,
  type AppConfig,
  type AuditLog,
  type Clock,
  type DbTx,
  type Logger,
} from '../../../platform/index.js';
import { PLATFORM_BUDGET_ALERT_RATIO } from '../domain/rules.js';

@Injectable()
export class PlatformBudget {
  private readonly log: Logger;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'billing' });
  }

  private async ensureDay(tx: DbTx, day: string): Promise<void> {
    await tx.query(
      `INSERT INTO billing.platform_daily_budget
         (budget_day, cap_micros, settled_cost_micros, reserved_cost_micros)
       VALUES ($1, $2, 0, 0) ON CONFLICT (budget_day) DO NOTHING`,
      [day, this.config.billing.platformDailyCapMicros],
    );
  }

  /** 预留；超上限返回 false（调用方返回 budget_exceeded，不留下任何冻结）。 */
  async reserve(tx: DbTx, day: string, costMicros: number): Promise<boolean> {
    await this.ensureDay(tx, day);
    const { rows } = await tx.query<{
      cap: string;
      settled: string;
      reserved: string;
      alerted: Date | null;
    }>(
      `UPDATE billing.platform_daily_budget
          SET reserved_cost_micros = reserved_cost_micros + $2
        WHERE budget_day = $1
          AND settled_cost_micros + reserved_cost_micros + $2 <= cap_micros
        RETURNING cap_micros AS cap, settled_cost_micros AS settled,
                  reserved_cost_micros AS reserved, alert_sent_at AS alerted`,
      [day, costMicros],
    );
    const row = rows[0];
    if (!row) {
      this.log.warn({ budgetDay: day }, '平台每日总上限已满，拒绝冻结');
      return false;
    }
    const cap = Number(row.cap);
    const used = Number(row.settled) + Number(row.reserved);
    if (!row.alerted && cap > 0 && used >= cap * PLATFORM_BUDGET_ALERT_RATIO) {
      await this.alert(tx, day, used, cap);
    }
    return true;
  }

  /** 结算或吸收：归还预留（可为 0）、记实际成本。 */
  async settle(
    tx: DbTx,
    day: string,
    reservedMicros: number,
    actualCostMicros: number,
  ): Promise<void> {
    await this.ensureDay(tx, day);
    await tx.query(
      `UPDATE billing.platform_daily_budget
          SET reserved_cost_micros = GREATEST(reserved_cost_micros - $2, 0),
              settled_cost_micros = settled_cost_micros + $3
        WHERE budget_day = $1`,
      [day, reservedMicros, actualCostMicros],
    );
  }

  /** 今天（北京时间）已结算的成本与上限。 */
  async today(tx: DbTx, day: string): Promise<{ settled: number; reserved: number; cap: number }> {
    const { rows } = await tx.query<{ settled: string; reserved: string; cap: string }>(
      `SELECT settled_cost_micros AS settled, reserved_cost_micros AS reserved, cap_micros AS cap
         FROM billing.platform_daily_budget WHERE budget_day = $1`,
      [day],
    );
    const row = rows[0];
    return row
      ? { settled: Number(row.settled), reserved: Number(row.reserved), cap: Number(row.cap) }
      : { settled: 0, reserved: 0, cap: this.config.billing.platformDailyCapMicros };
  }

  /**
   * 达到 80% 通知管理员。契约里还没有「通知管理员」的事件 / 模块（推送与管理后台红点未实现），
   * 目前写审计日志 + 错误级日志（运维监控按日志告警），见交接说明。
   */
  private async alert(tx: DbTx, day: string, used: number, cap: number): Promise<void> {
    await tx.query(
      `UPDATE billing.platform_daily_budget SET alert_sent_at = $2 WHERE budget_day = $1`,
      [day, this.clock.now()],
    );
    await this.audit.record(
      {
        module: 'billing',
        action: 'platform_budget.alert',
        actorType: 'system',
        targetType: 'budget_day',
        targetId: day,
        details: { usedMicros: used, capMicros: cap },
      },
      tx,
    );
    this.log.error(
      { budgetDay: day, usedMicros: used, capMicros: cap },
      '平台每日成本已达上限的 80%',
    );
  }
}
