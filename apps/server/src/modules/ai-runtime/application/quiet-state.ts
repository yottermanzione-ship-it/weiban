/**
 * T-072 P-45「不方便」静默（契约 UserQuietStatePort、QuietStateEndpoints）。
 *
 * P-45 原文：「2 小时，或用户再次发来消息时提前结束（以先到者为准）；期间该用户的所有角色都不发语音、不主动来电」。
 * 识别：用户在任一会话发的文字里说自己不方便（开会、上课、在忙、别打电话、不方便听语音……）→ 静默 2 小时；
 * 之后用户再发任何一条消息 → 提前结束。规则版识别（行为规划决策层 T-090 可替换为更细的判断）。
 * 专注（PLAY-06）：play 模块尚未提供 PlayReadPort，focusUntil 暂为 null；接入后在 getQuietState 里读取。
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { QuietState, UserQuietStatePort } from '@weiban/contracts';
import { CLOCK, DATABASE, type Clock, type Database, type DbTx } from '../../../platform/index.js';
import { userQuietStates } from '../infra/db/schema.js';

/** P-45：2 小时。 */
export const P45_INCONVENIENT_MS = 2 * 3600_000;

const INCONVENIENT =
  /(现在|这会儿?|暂时|目前|今天)?.{0,4}(不方便|没法|不能|别).{0,4}(打电话|接电话|通话|语音|听语音|说话)|我(在|正在)(开会|上课|上班|考试|图书馆|自习|加班|地铁上|公司)|(在忙|忙着呢|开会中|上课中)|(先)?别(给我)?打(电话)?(过来)?了?|不方便/u;

export function saysInconvenient(text: string): boolean {
  return INCONVENIENT.test(text.slice(0, 500));
}

@Injectable()
export class QuietStateService implements UserQuietStatePort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
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
    return { inconvenientUntil: await this.getInconvenientUntil(userId), focusUntil: null };
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
