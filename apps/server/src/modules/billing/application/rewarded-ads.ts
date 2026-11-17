import { Injectable, Inject } from '@nestjs/common';
import type { z } from 'zod';
import { AdRevenueDay, RewardDayStatus, pointsToMicros } from '@weiban/contracts';
import {
  APP_CONFIG,
  CLOCK,
  DATABASE,
  AUDIT_LOG,
  AppError,
  newId,
  type AppConfig,
  type Clock,
  type Database,
  type DbTx,
  type AuditLog,
} from '../../../platform/index.js';
import { localDate, PLATFORM_TIME_ZONE } from '../domain/local-time.js';
import { Ledger } from './ledger.js';

type Revenue = z.infer<typeof AdRevenueDay>;
const CHECK_IN_POINTS = 1,
  AD_POINTS = 2;
const REPORT_COLUMNS =
  'report_day::text AS day,provider,estimated_micros::float8 AS "estimatedMicros",settled_micros::float8 AS "settledMicros",revision';

@Injectable()
export class RewardedAdsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  private today() {
    return localDate(this.clock.now(), PLATFORM_TIME_ZONE);
  }
  private get demo() {
    return this.config.nodeEnv === 'test' && this.config.billing.rewardedAdsDemo === true;
  }
  private requireCampaign() {
    if (!this.demo) throw new AppError('not_found', '签到活动尚未开放');
  }
  async status(userId: string): Promise<z.infer<typeof RewardDayStatus>> {
    const day = this.today();
    const row = this.demo
      ? (
          await this.database.query<{ checked: boolean; rewarded: boolean }>(
            `SELECT d.checkin_points>0 checked,d.rewarded_at IS NOT NULL rewarded FROM billing.reward_days d
       JOIN billing.accounts a ON a.id=d.account_id WHERE a.user_id=$1 AND d.reward_day=$2`,
            [userId, day],
          )
        ).rows[0]
      : undefined;
    return {
      available: this.demo,
      day,
      checkedIn: row?.checked ?? false,
      rewarded: row?.rewarded ?? false,
      checkInPoints: CHECK_IN_POINTS,
      adPoints: AD_POINTS,
    };
  }
  async checkIn(userId: string) {
    this.requireCampaign();
    await this.database.transaction(async (tx) => {
      const account = await this.ledger.lockUserAccount(tx, userId);
      const day = this.today();
      const added = await tx.query(
        `INSERT INTO billing.reward_days(account_id,reward_day,checkin_points) VALUES($1,$2,$3)
        ON CONFLICT(account_id,reward_day) DO NOTHING RETURNING account_id`,
        [account.id, day, CHECK_IN_POINTS],
      );
      if (added.rows.length)
        await this.grant(tx, account, CHECK_IN_POINTS, 'daily_checkin', day, '每日签到赠送');
    });
    return this.status(userId);
  }
  async startAd(userId: string) {
    this.requireCampaign();
    return this.database.transaction(async (tx) => {
      const account = await this.ledger.lockUserAccount(tx, userId);
      const day = this.today();
      const {
        rows: [row],
      } = await tx.query<{
        intent_id: string | null;
        ready_at: Date | null;
        expires_at: Date | null;
        rewarded_at: Date | null;
        ad_points: number;
      }>(
        'SELECT intent_id,ready_at,expires_at,rewarded_at,ad_points FROM billing.reward_days WHERE account_id=$1 AND reward_day=$2 FOR UPDATE',
        [account.id, day],
      );
      if (!row) throw new AppError('bad_request', '请先完成今天的签到');
      if (row.rewarded_at) throw new AppError('conflict', '今日广告奖励已领取');
      const now = this.clock.nowMs();
      if (row.intent_id && row.ready_at && row.expires_at && row.expires_at.getTime() > now)
        return {
          intentId: row.intent_id,
          readyAt: row.ready_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          points: row.ad_points,
        };
      const intentId = newId(),
        readyAt = new Date(now + 6000),
        expiresAt = new Date(now + 10 * 60000);
      await tx.query(
        `UPDATE billing.reward_days SET intent_id=$3,provider='local_demo',ready_at=$4,expires_at=$5,ad_points=$6
        WHERE account_id=$1 AND reward_day=$2`,
        [account.id, day, intentId, readyAt, expiresAt, AD_POINTS],
      );
      return {
        intentId,
        readyAt: readyAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        points: AD_POINTS,
      };
    });
  }
  async cancelAd(userId: string, intentId: string) {
    this.requireCampaign();
    await this.database.transaction(async (tx) => {
      const account = await this.ledger.lockUserAccount(tx, userId);
      await tx.query(
        `UPDATE billing.reward_days SET intent_id=NULL,provider=NULL,ready_at=NULL,expires_at=NULL,ad_points=0
        WHERE account_id=$1 AND intent_id=$2 AND rewarded_at IS NULL`,
        [account.id, intentId],
      );
    });
    return this.status(userId);
  }
  /** 只有独立本机示例程序装配测试回执入口。生产 App 没有浏览器发奖接口。 */
  async finishDemo(userId: string, intentId: string) {
    this.requireCampaign();
    await this.database.transaction(async (tx) => {
      const account = await this.ledger.lockUserAccount(tx, userId);
      const {
        rows: [row],
      } = await tx.query<{
        reward_day: string;
        ad_points: number;
        ready_at: Date;
        expires_at: Date;
        rewarded_at: Date | null;
      }>(
        `SELECT reward_day::text,ad_points,ready_at,expires_at,rewarded_at FROM billing.reward_days
         WHERE account_id=$1 AND intent_id=$2 AND provider='local_demo' FOR UPDATE`,
        [account.id, intentId],
      );
      if (!row) throw new AppError('not_found', '找不到这次广告体验');
      if (row.rewarded_at) return;
      const now = this.clock.now();
      if (row.reward_day !== this.today() || now < row.ready_at || now >= row.expires_at)
        throw new AppError('conflict', '广告体验尚未完成或已经过期');
      await this.grant(tx, account, row.ad_points, 'rewarded_ad', row.reward_day, '激励广告赠送');
      await tx.query(
        'UPDATE billing.reward_days SET receipt_id=$2,rewarded_at=$3 WHERE intent_id=$1',
        [intentId, 'demo:' + intentId, now],
      );
    });
    return this.status(userId);
  }
  private async grant(
    tx: DbTx,
    account: Awaited<ReturnType<Ledger['lockUserAccount']>>,
    points: number,
    purpose: 'daily_checkin' | 'rewarded_ad',
    day: string,
    reason: string,
  ) {
    await this.ledger.postEntry(tx, account, {
      type: 'adjustment',
      amountMicros: pointsToMicros(points),
      bonusCredit: true,
      purpose,
      reason,
      idempotencyKey: `reward:${purpose}:${account.id}:${day}`,
    });
    await tx.query(
      `INSERT INTO billing.reward_daily_totals AS t(reward_day,checkins,completions,points) VALUES($1,$2,$3,$4)
      ON CONFLICT(reward_day) DO UPDATE SET checkins=t.checkins+EXCLUDED.checkins,completions=t.completions+EXCLUDED.completions,points=t.points+EXCLUDED.points`,
      [day, Number(purpose === 'daily_checkin'), Number(purpose === 'rewarded_ad'), points],
    );
  }
  async revenue(days: number) {
    const until = this.today();
    const [reports, rewards] = await Promise.all([
      this.database.query<Revenue>(
        `SELECT ${REPORT_COLUMNS} FROM billing.ad_revenue_reports
        WHERE report_day BETWEEN $1::date-($2::int-1) AND $1::date ORDER BY report_day DESC,provider`,
        [until, days],
      ),
      this.database.query<{ day: string; checkins: number; completions: number; points: number }>(
        `SELECT reward_day::text AS day,checkins,completions,points FROM billing.reward_daily_totals WHERE reward_day BETWEEN $1::date-($2::int-1) AND $1::date ORDER BY reward_day DESC`,
        [until, days],
      ),
    ]);
    return { reports: reports.rows, rewards: rewards.rows };
  }
  async saveReport(operator: string, input: Revenue) {
    if (input.day > this.today()) throw new AppError('bad_request', '报表日期不能晚于今天');
    return this.database.transaction(async (tx) => {
      const args = [
        input.day,
        input.provider,
        input.estimatedMicros,
        input.settledMicros,
        this.clock.now(),
      ];
      const saved =
        input.revision === 0
          ? await tx.query<Revenue>(
              `INSERT INTO billing.ad_revenue_reports(report_day,provider,estimated_micros,settled_micros,updated_at)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING ${REPORT_COLUMNS}`,
              args,
            )
          : await tx.query<Revenue>(
              `UPDATE billing.ad_revenue_reports SET estimated_micros=$3,settled_micros=$4,updated_at=$5,revision=revision+1
              WHERE report_day=$1 AND provider=$2 AND revision=$6 RETURNING ${REPORT_COLUMNS}`,
              [...args, input.revision],
            );
      const row = saved.rows[0];
      if (!row) throw new AppError('conflict', '报表版本已变化，请刷新后再保存');
      await this.audit.record(
        {
          module: 'billing',
          action: 'ad_revenue.saved',
          actorType: 'admin',
          actorId: operator,
          targetType: 'ad_revenue_report',
          targetId: input.day,
          details: {
            provider: input.provider,
            estimatedMicros: input.estimatedMicros,
            settledMicros: input.settledMicros,
            revision: row.revision,
          },
        },
        tx,
      );
      return row;
    });
  }
}
