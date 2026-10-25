/**
 * 年度回忆服务（10-25 会员 v6，PRO+ 权益）。
 *
 * 时间与幂等：
 * - 每年 12 月 31 日 22:00（北京时间，`recap.year_end`）生成一次，统计窗口 [当年 1/1 00:00, 12/31 22:00)；
 *   窗口截止就是生成时刻，不宣称包含最后一秒。
 * - 幂等靠 `recap.year_recaps` 的 (user_id, year) 唯一键 + `ON CONFLICT DO NOTHING`：任务重试、多实例、
 *   重启补跑都只会有一份；只有真正插入成功的那一次才推送 / 发实时更新。
 * - 补跑（`recap.year_end_retry`，1 月 1–7 日 03:15）沿用同一截止时刻，并且要求会员记录在截止前就已存在
 *   （`membership.updatedAt <= 截止时刻`），所以「新年才开通 PRO+」的用户不会被凭空补发上一年。
 *   这是用现有会员记录做的最小判定，没有新建订阅史；局限：若用户恰好在截止后、补跑前续费，也会被跳过
 *   （只影响生成失败后需要补跑的极少数用户）。
 *
 * 权限：
 * - 生成时要求当前是 PRO+（`IdentityMembershipReadPort.isProPlus` 语义的同一个端口取 getMembership().tier）。
 * - 读取不再检查会员：报告已经生成但用户当晚离线、之后会员到期，也仍由本人收下（错过一次就永久看不到
 *   不是产品想要的结果）。只认 `user_id = 本人` 且按用户 DEK 解密，跨用户读不出来。
 * - 没有手动生成接口；读取是只读的，不可能通过改客户端日期提前看到（服务端只认自己写过的行）。
 *
 * 隐私：整份载荷（统计 + 文案）按用户 DEK 信封加密，明文只在内存里；统计只来自 chat 的聚合端口
 * （数字 / 日期 / 角色 id），不读消息正文，因此私密内容不会混进年度回忆，也不会外发给任何模型。
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
  AnnualRecap,
  Id,
  type ChatRecapAggregates,
  type ChatRecapReadPort,
  type CharacterNameReadPort,
  type IdentityMembershipReadPort,
  type PushPort,
  type RecapStats,
  type SyncPort,
  type Tx,
  type UserDataOwner,
} from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  LOGGER,
  USER_DATA_REGISTRY,
  newId,
  parseContract,
  type Clock,
  type Database,
  type EnvelopeCrypto,
  type JobQueue,
  type Logger,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { CHAT_RECAP_READ_PORT } from '../../chat/index.js';
import { CHARACTER_NAME_READ_PORT } from '../../characters/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../../identity/index.js';
import { PUSH_PORT } from '../../push/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import {
  longestStreak,
  pickLatestNight,
  recapCaveat,
  recapCutoffNote,
  recapLocalYear,
  recapLines,
  recapWindow,
  toNightMessage,
  type RecapWindow,
} from '../domain/recap-rules.js';

export const RECAP_YEAR_END_JOB = 'recap.year_end';
export const RECAP_YEAR_END_RETRY_JOB = 'recap.year_end_retry';
/** 一次取多少个候选用户；按 user id 升序翻页，配合唯一键可安全重跑。 */
const CANDIDATE_PAGE = 100;

/** 加密载荷：除行上的元信息外，年度回忆的全部内容都在这里。 */
interface RecapPayload {
  version: 1;
  year: number;
  windowStart: string;
  windowEnd: string;
  cutoffNote: string;
  lines: string[];
  caveat: string | null;
  stats: RecapStats;
}

interface RecapRow {
  id: string;
  year: number;
  payload_ciphertext: Buffer;
  generated_at: Date;
}

@Injectable()
export class RecapService implements OnModuleInit, UserDataOwner {
  readonly module = 'recap';
  private readonly logger: Logger;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(CHAT_RECAP_READ_PORT) private readonly chat: ChatRecapReadPort,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT)
    private readonly membership: IdentityMembershipReadPort,
    @Inject(CHARACTER_NAME_READ_PORT) private readonly names: CharacterNameReadPort,
    @Inject(LOGGER) logger: Logger,
    @Optional() @Inject(PUSH_PORT) private readonly push?: PushPort,
    @Optional() @Inject(SYNC_PORT) private readonly sync?: SyncPort,
  ) {
    this.logger = logger;
  }

  async onModuleInit(): Promise<void> {
    this.registry.register(this);
    await this.jobs.work(RECAP_YEAR_END_JOB, () => this.runYearEnd(false));
    await this.jobs.work(RECAP_YEAR_END_RETRY_JOB, () => this.runYearEnd(true));
    await this.jobs.schedule(RECAP_YEAR_END_JOB, '0 22 31 12 *', { tz: 'Asia/Shanghai' });
    // 补跑：1 月 1–7 日 03:15，只补上一年、只补截止前就是 PRO+ 且真的漏掉的人。
    await this.jobs.schedule(RECAP_YEAR_END_RETRY_JOB, '15 3 1-7 1 *', { tz: 'Asia/Shanghai' });
  }

  /** 主任务：当年 12-31 22:00 生成本年度；补跑任务：1 月上旬补上一年。 */
  private async runYearEnd(retry: boolean): Promise<void> {
    const now = this.clock.now();
    const year = retry ? recapLocalYear(now) - 1 : recapLocalYear(now);
    await this.generate(year, { retry });
  }

  /**
   * 生成某一年度的报告。可在任务重试 / 补跑里重复调用：唯一键保证每用户每年一份，
   * 已存在的用户直接跳过（不重复推送）。
   */
  async generate(
    year: number,
    options: { retry: boolean } = { retry: false },
  ): Promise<{ year: number; candidates: number; generated: number; skipped: number }> {
    const window = recapWindow(year);
    const now = this.clock.now();
    if (now.getTime() < window.end.getTime())
      return { year, candidates: 0, generated: 0, skipped: 0 };
    let afterUserId: string | undefined;
    let candidates = 0;
    let generated = 0;
    let skipped = 0;
    for (;;) {
      const page = await this.chat.recapCandidates({
        fromIso: window.start.toISOString(),
        toIso: window.end.toISOString(),
        ...(afterUserId ? { afterUserId } : {}),
        limit: CANDIDATE_PAGE,
      });
      if (!page.userIds.length) break;
      candidates += page.userIds.length;
      for (const userId of page.userIds) {
        try {
          if (await this.generateOne(userId, year, window, options.retry)) generated += 1;
          else skipped += 1;
        } catch (error) {
          // 单个用户失败不影响整批；任务重试时会因为唯一键跳过已生成的用户。
          skipped += 1;
          this.logger.warn({ err: error, year }, '年度回忆：单个用户生成失败');
        }
      }
      afterUserId = page.userIds[page.userIds.length - 1]!;
      if (page.userIds.length < CANDIDATE_PAGE) break;
    }
    this.logger.info({ year, candidates, generated, skipped }, '年度回忆生成完成');
    return { year, candidates, generated, skipped };
  }

  /** 某个用户那一年的一份；返回 false 表示没生成（不是 PRO+ / 补跑不满足资格 / 没有数据 / 已存在）。 */
  private async generateOne(
    userId: string,
    year: number,
    window: RecapWindow,
    retry: boolean,
  ): Promise<boolean> {
    const member = await this.membership.getMembership(userId);
    if (member.tier !== 'pro_plus') return false;
    if (retry) {
      // 补跑只补给「截止前就已是 PRO+」的人：会员记录必须早于截止时刻。
      if (!member.updatedAt || Date.parse(member.updatedAt) > window.end.getTime()) return false;
    }
    const aggregates = await this.chat.recapAggregates(userId, {
      fromIso: window.start.toISOString(),
      toIso: window.end.toISOString(),
    });
    if (aggregates.totalMessages <= 0) return false;
    const payload = await this.buildPayload(userId, year, window, aggregates);
    const sealed = await this.crypto.seal(userId, this.aad(year), JSON.stringify(payload));
    const now = this.clock.now();
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO recap.year_recaps
         (id, user_id, year, payload_ciphertext, generated_at, version)
       VALUES ($1::uuid, $2::uuid, $3::int, $4::bytea, $5::timestamptz, 1)
       ON CONFLICT (user_id, year) DO NOTHING
       RETURNING id::text AS id`,
      [newId(), userId, year, sealed, now],
    );
    if (!rows.length) return false;
    await this.notify(userId, year);
    return true;
  }

  private async buildPayload(
    userId: string,
    year: number,
    window: RecapWindow,
    aggregates: ChatRecapAggregates,
  ): Promise<RecapPayload> {
    const latestNightCandidate = pickLatestNight(aggregates.nightCandidates);
    const latestNight = toNightMessage(latestNightCandidate);
    const streak = longestStreak(aggregates.activeDates);
    const topNames = await this.resolveNames(userId, aggregates);
    const stats: RecapStats = {
      totalMessages: aggregates.totalMessages,
      userMessages: aggregates.userMessages,
      characterMessages: aggregates.characterMessages,
      groupMessages: aggregates.groupMessages,
      directMessages: aggregates.directMessages,
      characterCount: aggregates.characterCount,
      activeDays: aggregates.activeDays,
      monthlyUserMessages: aggregates.monthlyUserMessages,
      topCharacters: aggregates.topCharacters.map((row) => ({
        characterId: row.characterId,
        name: topNames[row.characterId] ?? '一位角色',
        userMessages: row.userMessages,
        lastMessageAt: row.lastMessageAt,
      })),
      busiestDays: aggregates.busiestDays,
      latestNight,
      nightCount: aggregates.nightCount,
      streak,
      migratedMessages: aggregates.migratedMessages,
    };
    return {
      version: 1,
      year,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      cutoffNote: recapCutoffNote(year),
      lines: recapLines({
        stats,
        topNames,
        latestNight,
        nightCount: stats.nightCount,
        streak,
      }),
      caveat: recapCaveat(stats),
      stats,
    };
  }

  /** 角色名在生成时快照进加密载荷：之后角色被删、改名都不影响这份回顾。 */
  private async resolveNames(
    userId: string,
    aggregates: ChatRecapAggregates,
  ): Promise<Record<string, string>> {
    const names: Record<string, string> = {};
    for (const row of aggregates.topCharacters) {
      try {
        const name = await this.names.getDisplayName(userId, row.characterId);
        if (name) names[row.characterId] = name;
      } catch {
        // 取不到名字就不写，用「一位角色」兜底，不影响统计。
      }
    }
    return names;
  }

  /** 推送只泛称「年度回忆已准备好」，不带角色 / 内容；实时更新让在线用户直接弹出来。 */
  private async notify(userId: string, year: number): Promise<void> {
    if (this.sync) {
      try {
        await this.db.transaction(async (tx) => {
          await this.sync!.appendUpdate(tx as unknown as Tx, userId, {
            type: 'data.changed',
            data: { section: 'recap', characterId: null, itemId: null },
          });
        });
      } catch (error) {
        this.logger.warn({ err: error, year }, '年度回忆：发实时更新失败');
      }
    }
    if (!this.push) return;
    try {
      await this.push.send({
        userId,
        kind: 'system',
        title: '年度回忆已准备好',
        body: '打开微伴就能看到这一年和 TA 们的回忆',
        deepLink: '/chat',
        conversationId: null,
        dedupeKey: `recap:${year}:${userId}`,
        dedupeWindowHours: 24 * 30,
        respectsDoNotDisturb: true,
      });
      await this.db.query(
        'UPDATE recap.year_recaps SET delivered_at = $3::timestamptz WHERE user_id = $1::uuid AND year = $2::int AND delivered_at IS NULL',
        [userId, year, this.clock.now()],
      );
    } catch (error) {
      this.logger.warn({ err: error, year }, '年度回忆：推送失败（不影响报告本身）');
    }
  }

  /**
   * 待展示的那一份（只读，不触发生成）。
   * 不检查会员：已经生成但当晚离线、之后会员到期的用户，仍应由本人收下；跨用户读不出来（按 user_id 查 + DEK）。
   */
  async getPending(userId: string): Promise<AnnualRecap | null> {
    parseContract(Id, userId);
    const { rows } = await this.db.query<RecapRow>(
      `SELECT id::text AS id, year, payload_ciphertext, generated_at
         FROM recap.year_recaps
        WHERE user_id = $1::uuid AND seen_at IS NULL
        ORDER BY generated_at DESC
        LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    const plain = await this.crypto.open(userId, this.aad(row.year), row.payload_ciphertext);
    let payload: RecapPayload;
    try {
      payload = JSON.parse(plain.toString('utf8')) as RecapPayload;
    } finally {
      plain.fill(0);
    }
    return AnnualRecap.parse({
      recapId: row.id,
      year: payload.year,
      generatedAt: row.generated_at.toISOString(),
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      cutoffNote: payload.cutoffNote,
      lines: payload.lines,
      caveat: payload.caveat,
      stats: payload.stats,
    });
  }

  /** 确认看过（幂等）：只消耗刚才返回的那一份（最近一次生成的未读年度），之后不再自动弹出。 */
  async markSeen(userId: string): Promise<void> {
    parseContract(Id, userId);
    await this.db.query(
      `UPDATE recap.year_recaps SET seen_at = $2::timestamptz
        WHERE user_id = $1::uuid AND seen_at IS NULL
          AND id = (
            SELECT id FROM recap.year_recaps
             WHERE user_id = $1::uuid AND seen_at IS NULL
             ORDER BY generated_at DESC
             LIMIT 1
          )`,
      [userId, this.clock.now()],
    );
  }

  // ---------- 注销删除清单 ----------

  async purgeUser(userId: string): Promise<number> {
    parseContract(Id, userId);
    const result = await this.db.query('DELETE FROM recap.year_recaps WHERE user_id = $1::uuid', [
      userId,
    ]);
    return result.rowCount ?? 0;
  }

  async countUserData(userId: string): Promise<number> {
    parseContract(Id, userId);
    const { rows } = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM recap.year_recaps WHERE user_id = $1::uuid',
      [userId],
    );
    return rows[0]?.n ?? 0;
  }

  /** 信封加密的附加认证数据：绑定年度，换年度或换用户都解不开。 */
  private aad(year: number): string {
    return `recap:year:${year}`;
  }
}
