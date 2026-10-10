/**
 * T-072 P-45「不方便」静默（契约 UserQuietStatePort、QuietStateEndpoints）。
 *
 * P-45 原文：「2 小时，或用户再次发来消息时提前结束（以先到者为准）；期间该用户的所有角色都不发语音、不主动来电」。
 * 识别：用户在任一会话发的文字里说自己不方便（开会、上课、在忙、别打电话、不方便听语音……）→ 静默 2 小时；
 * 之后用户再发任何一条消息 → 提前结束。规则版识别（行为规划决策层 T-090 可替换为更细的判断）。
 * 专注（PLAY-06）：数据归 play，经 PlayReadPort.getActiveFocus 读取，focusUntil = 进行中专注的结束时间（T-094）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PlayReadPort, QuietState, UserQuietStatePort } from '@weiban/contracts';
import { CLOCK, DATABASE, type Clock, type Database, type DbTx } from '../../../platform/index.js';
import { PLAY_READ_PORT } from '../../play/index.js';
import { userQuietStates } from '../infra/db/schema.js';

/** P-45：2 小时。 */
export const P45_INCONVENIENT_MS = 2 * 3600_000;

/**
 * T-090 behavior-planning.md 6.1 节「不方便」识别（规则层，毫秒级，不花钱，不调用模型）：
 * 上课 / 学习、工作、睡觉、公共场合 / 出行、直接表达。拿不准（如「在外面」）按不方便处理（宁可安静）。
 * 同一条里出现结束信号（下课了、开完会了、到家了、醒了、方便了）则不生效；否定与假设句（明天要上课、不想上课、睡不着）排除。
 */
const INCONVENIENT_PATTERNS: RegExp[] = [
  // 上课 / 学习
  /(在|正在|还在)(上课|上自习|上晚自习|图书馆|考试|考场|听课|做实验)|老师在讲(课)?|上课中|考试中|晚自习/u,
  // 工作
  /(在|正在|还在)(开会|上班|加班|工位|公司|会议室|值班|面试)|开会中|领导在(旁边|边上)/u,
  // 睡觉
  /(准备|要|该|快)睡(了|觉)|躺下了|睡觉了|已经睡了|困死了先睡/u,
  // 公共场合 / 出行
  /(在|正在)(地铁|公交|高铁|火车|飞机|车)上|在开车|开车中|在外面|旁边有人|人很多不方便/u,
  // 直接表达
  /(现在|这会儿?|暂时|目前)?.{0,4}(不方便|没法|不能|别).{0,4}(打电话|接电话|通话|语音|听语音|说话)|(先)?别(给我)?打(电话)?(过来)?了?|别发语音|等会(儿)?再说|晚点(再)?聊|在忙|忙着呢|不方便/u,
];
const END_SIGNALS =
  /下课了|放学了|开完会了|会开完了|下班了|到家了|回家了|醒了|起床了|方便了|忙完了|考完了/u;
const NEGATED_OR_FUTURE =
  /(明天|后天|下周|待会|等下|一会|晚上|下午|上午|周[一二三四五六日天]).{0,3}(要|得|去)(上课|开会|上班|考试|加班)|不想(上课|上班|开会|睡)|睡不着|不困|没在(上课|开会|上班)|如果|要是/u;

export function saysInconvenient(text: string): boolean {
  const t = text.slice(0, 500);
  if (END_SIGNALS.test(t)) return false;
  const hit = INCONVENIENT_PATTERNS.some((re) => re.test(t));
  if (!hit) return false;
  // 否定 / 假设句：只有在没有「现在」「正在」这类当下标记时才排除。
  if (NEGATED_OR_FUTURE.test(t) && !/现在|正在|这会|此刻/u.test(t)) return false;
  return true;
}

@Injectable()
export class QuietStateService implements UserQuietStatePort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PLAY_READ_PORT) private readonly play: PlayReadPort,
  ) {}

  async getInconvenientUntil(userId: string): Promise<string | null> {
    const [row] = await this.db.db
      .select()
      .from(userQuietStates)
      .where(eq(userQuietStates.userId, userId));
    if (!row?.inconvenientUntil || row.inconvenientUntil.getTime() <= this.clock.nowMs())
      return null;
    return row.inconvenientUntil.toISOString();
  }

  async getQuietState(userId: string): Promise<QuietState> {
    return {
      inconvenientUntil: await this.getInconvenientUntil(userId),
      focusUntil: await this.getFocusUntil(userId),
    };
  }

  /** PLAY-06 第 3 条：用户正在专注时到何时为止（所有角色的主动消息、来电、群聊自发话题都要安静）；没有为 null。 */
  async getFocusUntil(userId: string): Promise<string | null> {
    const focus = await this.play.getActiveFocus(userId);
    return focus?.endsAt ?? null;
  }

  /** 用户发了一条消息（任一会话）：说不方便 → 静默 2 小时；否则结束已有静默。 */
  async onUserMessage(tx: DbTx, userId: string, text: string | null): Promise<void> {
    const now = this.clock.now();
    if (text && saysInconvenient(text)) {
      const until = new Date(now.getTime() + P45_INCONVENIENT_MS);
      await tx.db
        .insert(userQuietStates)
        .values({ userId, inconvenientUntil: until, updatedAt: now })
        .onConflictDoUpdate({
          target: userQuietStates.userId,
          set: { inconvenientUntil: until, updatedAt: now },
        });
      return;
    }
    await tx.db
      .update(userQuietStates)
      .set({ inconvenientUntil: null, updatedAt: now })
      .where(eq(userQuietStates.userId, userId));
  }
}
