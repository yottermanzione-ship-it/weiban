/**
 * 每个玩法（每日一问、心愿清单、慢信、陪你专注、TA 的提醒）实现这个接口，由 PlayLifecycle 统一接线：
 * - 删除清单（模块 play 只能登记一次，各玩法的表在这里汇总）；
 * - 角色软删除 / 恢复 / 彻底删除（contacts 事件）；
 * - 每分钟一次的到点扫描（兜底：精确到点另用 PlayLifecycle.schedule 投递延迟任务）。
 */
import type { DbTx } from '../../../platform/index.js';

export interface PlayFeature {
  /** 日志与任务名用，例 'daily_question'。 */
  readonly featureName: string;
  /** 注销：删除该用户在本玩法的全部数据，返回删除行数。 */
  purgeUser(tx: DbTx, userId: string): Promise<number>;
  /** 注销前统计（删除报告用）。 */
  countUserData(userId: string): Promise<number>;
  /** 角色进入 30 天回收期（contacts.contact_removed）。 */
  onContactRemoved?(tx: DbTx, userId: string, characterId: string): Promise<void>;
  /** 角色恢复或重新添加（contacts.contact_accepted）。 */
  onContactRestored?(tx: DbTx, userId: string, characterId: string): Promise<void>;
  /** 角色彻底删除（contacts.contact_purged）：删除与该角色相关的数据。 */
  onContactPurged?(tx: DbTx, userId: string, characterId: string): Promise<void>;
  /** 每分钟调用一次：处理已到点但还没处理的事（专注到点、回信送达、提醒到点等）。必须幂等。 */
  sweepDue?(now: Date): Promise<void>;
}
