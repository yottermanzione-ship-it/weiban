/**
 * 名片推荐账本（CHR-04、P-27，T-064）。推荐时机由 ai-runtime 决定，频率与冷却由这里强制：
 * - 所有角色合计每 7 天最多主动推荐 1 次（用户主动询问时 ignoreWeeklyLimit 跳过此限制，CHR-04 第 4 条）；
 * - 「不感兴趣」后该角色冷却 90 天；
 * - 已在通讯录（含待通过）的角色不推荐。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, inArray } from 'drizzle-orm';
import { Id, type ContactCardRecommendationPort, type Tx } from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  P27_CARD_RECOMMENDATION,
  asDbTx,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { cardDismissals, cardRecommendations, contacts } from '../infra/db/schema.js';

@Injectable()
export class ContactCardRecommendationService implements ContactCardRecommendationPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canRecommend(
    userId: string,
    characterId: string,
    options?: { ignoreWeeklyLimit?: boolean },
  ): Promise<boolean> {
    parseContract(Id, userId);
    parseContract(Id, characterId);
    const now = this.clock.nowMs();
    const [existing] = await this.db.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, userId),
          eq(contacts.characterId, characterId),
          inArray(contacts.status, ['pending', 'active']),
        ),
      );
    if (existing) return false;
    const [dismissed] = await this.db.db
      .select({ at: cardDismissals.dismissedAt })
      .from(cardDismissals)
      .where(and(eq(cardDismissals.userId, userId), eq(cardDismissals.characterId, characterId)));
    if (dismissed && now - dismissed.at.getTime() < P27_CARD_RECOMMENDATION.notInterestedCooldownMs)
      return false;
    if (options?.ignoreWeeklyLimit) return true;
    const [recent] = await this.db.db
      .select({ n: count() })
      .from(cardRecommendations)
      .where(
        and(
          eq(cardRecommendations.userId, userId),
          gt(cardRecommendations.createdAt, new Date(now - P27_CARD_RECOMMENDATION.windowMs)),
        ),
      );
    return (recent?.n ?? 0) < P27_CARD_RECOMMENDATION.total;
  }

  async recordRecommendation(
    transaction: Tx | null,
    input: Parameters<ContactCardRecommendationPort['recordRecommendation']>[1],
  ): Promise<void> {
    parseContract(Id, input.userId);
    parseContract(Id, input.characterId);
    parseContract(Id, input.recommenderCharacterId);
    parseContract(Id, input.messageId);
    const write = async (tx: DbTx) => {
      await tx.db
        .insert(cardRecommendations)
        .values({
          id: newId(),
          userId: input.userId,
          characterId: input.characterId,
          recommenderCharacterId: input.recommenderCharacterId,
          messageId: input.messageId,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing();
    };
    await (transaction ? write(asDbTx(transaction)) : this.db.transaction(write));
  }

  /** 「不感兴趣」：重复点刷新冷却起点。 */
  async dismiss(userId: string, characterId: string): Promise<void> {
    parseContract(Id, characterId);
    const at = this.clock.now();
    await this.db.db
      .insert(cardDismissals)
      .values({ userId, characterId, dismissedAt: at })
      .onConflictDoUpdate({
        target: [cardDismissals.userId, cardDismissals.characterId],
        set: { dismissedAt: at },
      });
  }

  async purgeUser(userId: string): Promise<number> {
    const a = await this.db.db
      .delete(cardRecommendations)
      .where(eq(cardRecommendations.userId, userId))
      .returning({ id: cardRecommendations.id });
    const b = await this.db.db
      .delete(cardDismissals)
      .where(eq(cardDismissals.userId, userId))
      .returning({ id: cardDismissals.characterId });
    return a.length + b.length;
  }
  async countUserData(userId: string): Promise<number> {
    const [a] = await this.db.db
      .select({ n: count() })
      .from(cardRecommendations)
      .where(eq(cardRecommendations.userId, userId));
    const [b] = await this.db.db
      .select({ n: count() })
      .from(cardDismissals)
      .where(eq(cardDismissals.userId, userId));
    return (a?.n ?? 0) + (b?.n ?? 0);
  }
}
