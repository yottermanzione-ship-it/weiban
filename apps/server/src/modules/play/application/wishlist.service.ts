/**
 * 心愿清单（PLAY-04，T-092）。增删改、定日期、打勾都不调用模型。
 *
 * - 两个入口（服务页总览、聊天信息「和 TA 的相处」）读写同一张表，改动后 data.changed(wishlist) 让两处同步。
 * - 每个角色最多 P-41（50）项，满了 422 limit_reached。
 * - 定日期 = 一条「约定」：发 play.wishlist_item_changed（带 dueDate），ai-runtime 写 / 取消约定记忆（MEM-04），
 *   到期跟进按 SIM-07；取消日期或删除时 dueDate = null，约定一并取消。
 * - 只能由用户打勾。第一次完成：发瞬间卡（经 PLAY_CARD_ISSUER，同项只一次，取消完成不收回）、
 *   发 play.wishlist_item_completed（growth 记首次互动 +5 与成就 31 号）。
 * - 角色提议：PlayAgentPort.createWishlistProposal 登记（每角色每用户当地周最多 1 次），ai-runtime 发 action_card；
 *   用户点「加进去」（chat.message_action_chosen）后建项并标「TA 提议」，点「先不了」记为 declined。
 * - 删除角色：30 天内清单保留但不可访问（通讯录校验），恢复后原样回来；彻底删除时一并删除。
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import {
  PLAY_LIMITS,
  WishlistEndpoints,
  type PortResult,
  type Tx,
  type WishlistItem,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  AppError,
  DATABASE,
  ENVELOPE_CRYPTO,
  EVENT_BUS,
  LOGGER,
  OUTBOX,
  newId,
  parseContract,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type EventBus,
  type Logger,
  type Outbox,
} from '../../../platform/index.js';
import { wishlistItems, wishlistProposals } from '../infra/db/schema.js';
import {
  PLAY_CARD_ISSUER,
  WISHLIST_PROPOSAL_ACTIONS,
  WISHLIST_PROPOSAL_REF_KIND,
  type PlayCardIssuer,
  type PlayWishlistFollowUp,
} from '../tokens.js';
import { PlayContext, isUniqueViolation, weekStartOf } from './context.js';
import type { PlayFeature } from './play-feature.js';

type ItemRow = typeof wishlistItems.$inferSelect;
type AddBody = z.infer<NonNullable<typeof WishlistEndpoints.addItem.body>>;
type UpdateBody = z.infer<NonNullable<typeof WishlistEndpoints.updateItem.body>>;

const itemAad = (id: string) => `play:wish:${id}`;
const proposalAad = (id: string) => `play:wish_proposal:${id}`;
const LIMIT = PLAY_LIMITS.wishlistItemsPerCharacter;

@Injectable()
export class WishlistService implements PlayFeature, PlayWishlistFollowUp, OnModuleInit {
  readonly featureName = 'wishlist';

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(PlayContext) private readonly ctx: PlayContext,
    @Optional() @Inject(PLAY_CARD_ISSUER) private readonly cards?: PlayCardIssuer,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe({
      consumer: 'play.on_message_action_chosen',
      eventType: 'chat.message_action_chosen',
      handle: async (event, tx) => {
        const { cardKind, ref, actionId, userId } = event.payload;
        if (cardKind !== 'wishlist_proposal' || ref?.kind !== WISHLIST_PROPOSAL_REF_KIND) return;
        await this.onProposalChosen(tx, userId, ref.id, actionId);
      },
    });
  }

  // ---------- 用户接口 ----------

  async listSummaries(userId: string) {
    const contacts = await this.ctx.contacts.listActiveContacts(userId);
    const rows = await this.db.db
      .select({
        characterId: wishlistItems.characterId,
        total: count(),
        completed: sql<number>`count(${wishlistItems.completedAt})::int`,
      })
      .from(wishlistItems)
      .where(eq(wishlistItems.userId, userId))
      .groupBy(wishlistItems.characterId);
    const byCharacter = new Map(rows.map((r) => [r.characterId, r]));
    return {
      items: contacts.map((c) => {
        const r = byCharacter.get(c.characterId);
        return {
          characterId: c.characterId,
          total: Number(r?.total ?? 0),
          completed: Number(r?.completed ?? 0),
        };
      }),
    };
  }

  async listItems(userId: string, characterId: string) {
    await this.ctx.requireActiveContact(userId, characterId);
    const rows = await this.db.db
      .select()
      .from(wishlistItems)
      .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.characterId, characterId)))
      .orderBy(asc(wishlistItems.createdAt), asc(wishlistItems.id));
    const items: WishlistItem[] = [];
    for (const row of rows) items.push(await this.toDto(row));
    return { items, limit: LIMIT };
  }

  async addItem(userId: string, characterId: string, raw: unknown): Promise<WishlistItem> {
    const body: AddBody = parseContract(WishlistEndpoints.addItem.body!, raw);
    const retry = await this.findBySource(this.db, userId, body.clientRequestId);
    if (retry) return this.toDto(retry);
    await this.ctx.requireActiveContact(userId, characterId);
    try {
      const row = await this.db.transaction(async (tx) => {
        await this.lockList(tx, userId, characterId);
        if ((await this.countItems(tx, userId, characterId)) >= LIMIT)
          throw new AppError('limit_reached', `每个角色的心愿清单最多 ${LIMIT} 项`, {
            details: { limit: LIMIT },
          });
        return this.insertItem(tx, {
          userId,
          characterId,
          text: body.text,
          dueDate: body.dueDate ?? null,
          proposedByCharacter: false,
          sourceKey: body.clientRequestId,
        });
      });
      return this.toDto(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findBySource(this.db, userId, body.clientRequestId);
        if (again) return this.toDto(again);
      }
      throw error;
    }
  }

  async updateItem(userId: string, itemId: string, raw: unknown): Promise<WishlistItem> {
    const body: UpdateBody = parseContract(WishlistEndpoints.updateItem.body!, raw);
    const row = await this.db.transaction(async (tx) => {
      const current = await this.loadOwned(tx, userId, itemId);
      await this.ctx.requireActiveContact(userId, current.characterId, tx);
      const now = this.ctx.clock.now();
      const patch: Partial<typeof wishlistItems.$inferInsert> = { updatedAt: now };
      let changed = false;
      if (body.text !== undefined) {
        patch.textCiphertext = await this.crypto.seal(userId, itemAad(itemId), body.text, tx);
        changed = true;
      }
      const dueChanged = body.dueDate !== undefined && body.dueDate !== current.dueDate;
      if (dueChanged) {
        patch.dueDate = body.dueDate ?? null;
        changed = true;
      }
      let firstCompletion = false;
      let completedNow = false;
      if (body.completed === true && !current.completedAt) {
        patch.completedAt = now;
        completedNow = true;
        if (!current.firstCompletedAt) {
          patch.firstCompletedAt = now;
          firstCompletion = true;
        }
      } else if (body.completed === false && current.completedAt) {
        // 取消完成：已获得的卡不收回（cardIssued 不变）。
        patch.completedAt = null;
      }
      await tx.db.update(wishlistItems).set(patch).where(eq(wishlistItems.id, itemId));

      if (changed)
        await this.outbox.publish(tx, 'play.wishlist_item_changed', 'play', {
          userId,
          characterId: current.characterId,
          itemId,
          action: 'updated',
          dueDate: dueChanged ? (body.dueDate ?? null) : current.dueDate,
        });
      if (completedNow) {
        const text =
          body.text ?? (await this.openText(userId, itemAad(itemId), current.textCiphertext));
        const card = !current.cardIssued
          ? await this.issueCard(tx, userId, current.characterId, itemId, text)
          : null;
        // 3.1（积压 ㊲）：「{title} 已完成」系统提示（获得瞬间卡时加「· 获得瞬间卡」）。
        await this.ctx.postPlayNotice(tx, {
          userId,
          characterId: current.characterId,
          code: 'wishlist_item_completed',
          params: {
            itemId,
            title: text.slice(0, 60),
            cardIssued: !!card,
            ...(card ? { cardId: card } : {}),
          },
          idempotencyKey: `play:wishlist_item_completed:${itemId}:${now.getTime()}`,
        });
        await this.outbox.publish(tx, 'play.wishlist_item_completed', 'play', {
          userId,
          characterId: current.characterId,
          itemId,
          firstCompletion,
        });
      }
      await this.ctx.dataChanged(tx, userId, 'wishlist', current.characterId, itemId);
      const [saved] = await tx.db.select().from(wishlistItems).where(eq(wishlistItems.id, itemId));
      return saved!;
    });
    return this.toDto(row);
  }

  async deleteItem(userId: string, itemId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.loadOwned(tx, userId, itemId);
      await tx.db.delete(wishlistItems).where(eq(wishlistItems.id, itemId));
      // 有日期的约定一并取消（dueDate = null）。
      await this.outbox.publish(tx, 'play.wishlist_item_changed', 'play', {
        userId,
        characterId: current.characterId,
        itemId,
        action: 'deleted',
        dueDate: null,
      });
      await this.ctx.dataChanged(tx, userId, 'wishlist', current.characterId, itemId);
    });
  }

  // ---------- 给 ai-runtime ----------

  /** PlayReadPort.listWishlist：角色不在通讯录时返回空。 */
  async listForRuntime(userId: string, characterId: string): Promise<WishlistItem[]> {
    if (!(await this.ctx.contacts.getActiveContact(userId, characterId))) return [];
    return (await this.listItems(userId, characterId)).items;
  }

  /** PlayAgentPort.createWishlistProposal。 */
  async createProposal(input: {
    userId: string;
    characterId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<PortResult<{ proposalId: string }, 'weekly_limit' | 'list_full'>> {
    const text = input.text.trim().slice(0, PLAY_LIMITS.wishlistItemMaxChars);
    if (!text) return { ok: false, error: 'list_full', message: '提议内容为空' };
    const [existing] = await this.db.db
      .select({ id: wishlistProposals.id })
      .from(wishlistProposals)
      .where(
        and(
          eq(wishlistProposals.userId, input.userId),
          eq(wishlistProposals.characterId, input.characterId),
          eq(wishlistProposals.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) return { ok: true, value: { proposalId: existing.id } };
    if (!(await this.ctx.contacts.getActiveContact(input.userId, input.characterId)))
      return { ok: false, error: 'weekly_limit', message: '角色不在通讯录中' };
    const weekStart = weekStartOf(await this.ctx.localToday(input.userId));
    try {
      return await this.db.transaction(async (tx) => {
        await this.lockList(tx, input.userId, input.characterId);
        const [week] = await tx.db
          .select({ n: count() })
          .from(wishlistProposals)
          .where(
            and(
              eq(wishlistProposals.userId, input.userId),
              eq(wishlistProposals.characterId, input.characterId),
              eq(wishlistProposals.weekStart, weekStart),
            ),
          );
        if (Number(week?.n ?? 0) >= 1)
          return { ok: false as const, error: 'weekly_limit' as const, message: '本周已提议过' };
        if ((await this.countItems(tx, input.userId, input.characterId)) >= LIMIT)
          return { ok: false as const, error: 'list_full' as const, message: '清单已满' };
        const id = newId();
        const now = this.ctx.clock.now();
        await tx.db.insert(wishlistProposals).values({
          id,
          userId: input.userId,
          characterId: input.characterId,
          textCiphertext: await this.crypto.seal(input.userId, proposalAad(id), text, tx),
          weekStart,
          status: 'pending',
          itemId: null,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          updatedAt: now,
        });
        return { ok: true as const, value: { proposalId: id } };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const [again] = await this.db.db
          .select({ id: wishlistProposals.id })
          .from(wishlistProposals)
          .where(
            and(
              eq(wishlistProposals.userId, input.userId),
              eq(wishlistProposals.characterId, input.characterId),
              eq(wishlistProposals.idempotencyKey, input.idempotencyKey),
            ),
          );
        if (again) return { ok: true, value: { proposalId: again.id } };
      }
      throw error;
    }
  }

  async markWishlistFollowedUp(itemId: string): Promise<boolean> {
    const rows = await this.db.db
      .update(wishlistItems)
      .set({ followedUpAt: this.ctx.clock.now() })
      .where(
        and(
          eq(wishlistItems.id, itemId),
          isNull(wishlistItems.followedUpAt),
          isNull(wishlistItems.completedAt),
        ),
      )
      .returning({ id: wishlistItems.id });
    return rows.length > 0;
  }

  // ---------- PlayFeature ----------

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    let n = 0;
    n += (await tx.db.delete(wishlistItems).where(eq(wishlistItems.userId, userId))).rowCount ?? 0;
    n +=
      (await tx.db.delete(wishlistProposals).where(eq(wishlistProposals.userId, userId)))
        .rowCount ?? 0;
    return n;
  }

  async countUserData(userId: string): Promise<number> {
    const [a] = await this.db.db
      .select({ n: count() })
      .from(wishlistItems)
      .where(eq(wishlistItems.userId, userId));
    const [b] = await this.db.db
      .select({ n: count() })
      .from(wishlistProposals)
      .where(eq(wishlistProposals.userId, userId));
    return Number(a?.n ?? 0) + Number(b?.n ?? 0);
  }

  async onContactRemoved(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await this.ctx.dataChanged(tx, userId, 'wishlist', characterId, null);
  }

  async onContactRestored(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await this.ctx.dataChanged(tx, userId, 'wishlist', characterId, null);
  }

  async onContactPurged(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db
      .delete(wishlistItems)
      .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.characterId, characterId)));
    await tx.db
      .delete(wishlistProposals)
      .where(
        and(eq(wishlistProposals.userId, userId), eq(wishlistProposals.characterId, characterId)),
      );
    await this.ctx.dataChanged(tx, userId, 'wishlist', characterId, null);
  }

  // ---------- 内部 ----------

  private async onProposalChosen(
    tx: DbTx,
    userId: string,
    proposalId: string,
    actionId: string,
  ): Promise<void> {
    const [proposal] = await tx.db
      .select()
      .from(wishlistProposals)
      .where(and(eq(wishlistProposals.id, proposalId), eq(wishlistProposals.userId, userId)))
      .for('update');
    if (!proposal || proposal.status !== 'pending') return;
    const now = this.ctx.clock.now();
    const decline = async () =>
      tx.db
        .update(wishlistProposals)
        .set({ status: 'declined', updatedAt: now })
        .where(eq(wishlistProposals.id, proposalId));
    if (actionId !== WISHLIST_PROPOSAL_ACTIONS.add) {
      await decline();
      return;
    }
    const contact = await this.ctx.contacts.getActiveContact(
      userId,
      proposal.characterId,
      tx as unknown as Tx,
    );
    await this.lockList(tx, userId, proposal.characterId);
    if (!contact || (await this.countItems(tx, userId, proposal.characterId)) >= LIMIT) {
      // 清单已满或角色已删除：不建项（客户端按钮已点过，卡片显示原文即可）。
      this.logger.info({ proposalId }, '心愿提议无法加入（清单已满或角色不在通讯录）');
      await decline();
      return;
    }
    const text = await this.openText(userId, proposalAad(proposal.id), proposal.textCiphertext);
    const item = await this.insertItem(tx, {
      userId,
      characterId: proposal.characterId,
      text,
      dueDate: null,
      proposedByCharacter: true,
      sourceKey: proposal.id,
    });
    await tx.db
      .update(wishlistProposals)
      .set({ status: 'accepted', itemId: item.id, updatedAt: now })
      .where(eq(wishlistProposals.id, proposalId));
  }

  private async insertItem(
    tx: DbTx,
    input: {
      userId: string;
      characterId: string;
      text: string;
      dueDate: string | null;
      proposedByCharacter: boolean;
      sourceKey: string;
    },
  ): Promise<ItemRow> {
    const id = newId();
    const now = this.ctx.clock.now();
    await tx.db.insert(wishlistItems).values({
      id,
      userId: input.userId,
      characterId: input.characterId,
      textCiphertext: await this.crypto.seal(input.userId, itemAad(id), input.text, tx),
      proposedByCharacter: input.proposedByCharacter,
      dueDate: input.dueDate,
      completedAt: null,
      firstCompletedAt: null,
      cardIssued: false,
      followedUpAt: null,
      sourceKey: input.sourceKey,
      createdAt: now,
      updatedAt: now,
    });
    await this.outbox.publish(tx, 'play.wishlist_item_changed', 'play', {
      userId: input.userId,
      characterId: input.characterId,
      itemId: id,
      action: 'created',
      dueDate: input.dueDate,
    });
    await this.ctx.dataChanged(tx, input.userId, 'wishlist', input.characterId, id);
    const [row] = await tx.db.select().from(wishlistItems).where(eq(wishlistItems.id, id));
    return row!;
  }

  private async issueCard(
    tx: DbTx,
    userId: string,
    characterId: string,
    itemId: string,
    text: string,
  ): Promise<string | null> {
    if (!this.cards) return null;
    const result = await this.cards.issueCard(tx as unknown as Tx, {
      userId,
      characterId,
      kind: 'play',
      title: '一起完成的心愿',
      line: text.slice(0, 60),
      faceMediaId: null,
      templateId: null,
      sourceMessageIds: [],
      idempotencyKey: `wish:${itemId}`,
    });
    if (!result.ok) return null;
    await tx.db.update(wishlistItems).set({ cardIssued: true }).where(eq(wishlistItems.id, itemId));
    return result.value.cardId;
  }

  /** 同一用户同一角色的清单写入串行化（上限校验不被并发绕过）。 */
  private async lockList(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`play:wish:${userId}:${characterId}`}))`,
    );
  }

  private async countItems(tx: DbTx, userId: string, characterId: string): Promise<number> {
    const [r] = await tx.db
      .select({ n: count() })
      .from(wishlistItems)
      .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.characterId, characterId)));
    return Number(r?.n ?? 0);
  }

  private async findBySource(
    q: { db: DbTx['db'] },
    userId: string,
    sourceKey: string,
  ): Promise<ItemRow | null> {
    const [row] = await q.db
      .select()
      .from(wishlistItems)
      .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.sourceKey, sourceKey)));
    return row ?? null;
  }

  private async loadOwned(tx: DbTx, userId: string, itemId: string): Promise<ItemRow> {
    const [row] = await tx.db
      .select()
      .from(wishlistItems)
      .where(and(eq(wishlistItems.id, itemId), eq(wishlistItems.userId, userId)))
      .for('update');
    if (!row) throw new AppError('not_found', '这一项不存在');
    return row;
  }

  private async openText(userId: string, aad: string, sealed: Buffer): Promise<string> {
    return (await this.crypto.open(userId, aad, sealed)).toString('utf8');
  }

  private async toDto(row: ItemRow): Promise<WishlistItem> {
    return {
      itemId: row.id,
      characterId: row.characterId,
      text: await this.openText(row.userId, itemAad(row.id), row.textCiphertext),
      proposedByCharacter: row.proposedByCharacter,
      dueDate: row.dueDate,
      completedAt: row.completedAt?.toISOString() ?? null,
      cardIssued: row.cardIssued,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
