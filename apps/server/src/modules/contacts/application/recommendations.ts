/**
 * 名片推荐账本（CHR-04、P-27，T-064）。推荐时机由 ai-runtime 决定，频率与冷却由这里强制：
 * - 所有角色合计每 7 天最多主动推荐 1 次（用户主动询问时 ignoreWeeklyLimit 跳过此限制，CHR-04 第 4 条）；
 * - 「不感兴趣」后该角色冷却 90 天；
 * - 已在通讯录（含待通过）的角色不推荐。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import {
  Id,
  NewFriendItem,
  type ContactCardRecommendationPort,
  type SyncPort,
  type Tx,
} from '@weiban/contracts';
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
  AppError,
} from '../../../platform/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import {
  cardDismissals,
  cardRecommendations,
  contacts,
  newFriendState,
} from '../infra/db/schema.js';

@Injectable()
export class ContactCardRecommendationService implements ContactCardRecommendationPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
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
      await this.changed(tx, input.userId);
    };
    await (transaction ? write(asDbTx(transaction)) : this.db.transaction(write));
  }

  /** 「不感兴趣」：重复点刷新冷却起点。 */
  async dismiss(userId: string, characterId: string): Promise<void> {
    parseContract(Id, characterId);
    const at = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx.db
        .insert(cardDismissals)
        .values({ userId, characterId, dismissedAt: at })
        .onConflictDoUpdate({
          target: [cardDismissals.userId, cardDismissals.characterId],
          set: { dismissedAt: at },
        });
      await this.changed(tx, userId);
    });
  }

  // ---------- 「新的朋友」（3.0.1，L4 收尾） ----------

  async listNewFriends(userId: string): Promise<{ items: NewFriendItem[]; unseenCount: number }> {
    parseContract(Id, userId);
    const now = this.clock.nowMs();
    const contactRows = await this.db.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.userId, userId), inArray(contacts.status, ['pending', 'active'])));
    const byCharacter = new Map(contactRows.map((c) => [c.characterId, c]));
    const dismissals = await this.db.db
      .select()
      .from(cardDismissals)
      .where(eq(cardDismissals.userId, userId));
    const dismissed = new Set(
      dismissals
        .filter(
          (d) => now - d.dismissedAt.getTime() < P27_CARD_RECOMMENDATION.notInterestedCooldownMs,
        )
        .map((d) => d.characterId),
    );
    const cards = await this.db.db
      .select()
      .from(cardRecommendations)
      .where(and(eq(cardRecommendations.userId, userId), isNull(cardRecommendations.hiddenAt)))
      .orderBy(desc(cardRecommendations.createdAt))
      .limit(200);
    const [state] = await this.db.db
      .select()
      .from(newFriendState)
      .where(eq(newFriendState.userId, userId));
    const items: NewFriendItem[] = [];
    let unseenCount = 0;
    const seenCards = new Set<string>();
    for (const card of cards) {
      // 同一角色被多次推荐只显示最新一条。
      if (seenCards.has(card.characterId)) continue;
      seenCards.add(card.characterId);
      const contact = byCharacter.get(card.characterId);
      const status = contact
        ? contact.status === 'active'
          ? 'added'
          : 'pending'
        : dismissed.has(card.characterId)
          ? 'dismissed'
          : 'can_add';
      if (status === 'can_add' && (!state || card.createdAt > state.seenAt)) unseenCount += 1;
      items.push({
        itemId: card.id,
        kind: 'card_recommendation',
        characterId: card.characterId,
        recommenderCharacterId: card.recommenderCharacterId,
        messageId: card.messageId,
        status,
        createdAt: card.createdAt.toISOString(),
      });
    }
    for (const contact of contactRows) {
      if (contact.newFriendHiddenAt) continue;
      items.push({
        itemId: contact.id,
        kind: 'contact_request',
        characterId: contact.characterId,
        recommenderCharacterId: contact.referrerCharacterId,
        messageId: null,
        status: contact.status === 'active' ? 'added' : 'pending',
        createdAt: contact.addedAt.toISOString(),
      });
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      items: items.slice(0, 200).map((item) => NewFriendItem.parse(item)),
      unseenCount,
    };
  }
  async markNewFriendsSeen(userId: string): Promise<void> {
    const at = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx.db
        .insert(newFriendState)
        .values({ userId, seenAt: at })
        .onConflictDoUpdate({ target: newFriendState.userId, set: { seenAt: at } });
      await this.changed(tx, userId);
    });
  }
  /** 只从列表移除，不影响通讯录与推荐冷却。 */
  async removeNewFriend(userId: string, itemId: string): Promise<void> {
    parseContract(Id, itemId);
    const at = this.clock.now();
    await this.db.transaction(async (tx) => {
      const cards = await tx.db
        .update(cardRecommendations)
        .set({ hiddenAt: at })
        .where(and(eq(cardRecommendations.id, itemId), eq(cardRecommendations.userId, userId)))
        .returning({ id: cardRecommendations.id });
      const rows = cards.length
        ? cards
        : await tx.db
            .update(contacts)
            .set({ newFriendHiddenAt: at })
            .where(and(eq(contacts.id, itemId), eq(contacts.userId, userId)))
            .returning({ id: contacts.id });
      if (!rows.length) throw new AppError('not_found', '记录不存在');
      await this.changed(tx, userId);
    });
  }
  private async changed(tx: DbTx, userId: string): Promise<void> {
    await this.sync.appendUpdate(tx, userId, {
      type: 'data.changed',
      data: { section: 'new_friends', characterId: null, itemId: null },
    });
  }

  async purgeUser(userId: string): Promise<number> {
    const a = await this.db.db
      .delete(cardRecommendations)
      .where(eq(cardRecommendations.userId, userId))
      .returning({ id: cardRecommendations.id });
    const nf = await this.db.db
      .delete(newFriendState)
      .where(eq(newFriendState.userId, userId))
      .returning({ id: newFriendState.userId });
    const b = await this.db.db
      .delete(cardDismissals)
      .where(eq(cardDismissals.userId, userId))
      .returning({ id: cardDismissals.characterId });
    return a.length + b.length + nf.length;
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
    const [c] = await this.db.db
      .select({ n: count() })
      .from(newFriendState)
      .where(eq(newFriendState.userId, userId));
    return (a?.n ?? 0) + (b?.n ?? 0) + (c?.n ?? 0);
  }
}
