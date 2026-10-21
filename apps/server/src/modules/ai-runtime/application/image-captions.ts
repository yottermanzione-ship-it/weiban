import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { ChatReadPort, ContentScope, Message } from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  newId,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { imageCaptions } from '../infra/db/schema.js';
import { CAPTION_TEMPLATE, ImageCaption } from '../domain/image-caption.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { ReplyPlanStore } from './plan-store.js';

/** 按 mediaId 取到的描述（附带它的范围）。 */
export type CaptionMap = ReadonlyMap<string, ImageCaption>;
export const NO_CAPTIONS: CaptionMap = new Map();

/** 一条消息里需要描述的图片：用户发的图、用户自己的表情（没有库内含义）、转发记录里的图。 */
export function captionMediaIds(messages: readonly Message[]): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    const c = m.content;
    if (!c) continue;
    if (c.type === 'image') ids.add(c.mediaId);
    else if (c.type === 'sticker' && !c.description && c.mediaId) ids.add(c.mediaId);
    else if (c.type === 'forwarded_record')
      for (const item of c.items) {
        if (item.content.type === 'image') ids.add(item.content.mediaId);
        else if (
          item.content.type === 'sticker' &&
          !item.content.description &&
          item.content.mediaId
        )
          ids.add(item.content.mediaId);
      }
  }
  return [...ids];
}

/**
 * H3（迁移 0130）：图片描述存档。描述按用户密钥加密（AAD 绑定图片与范围），种类等都只在密文里。
 * 读：只返回调用方给的范围（日常范围读不到私密模式里看过的图的描述）。写：同一张图同一范围只存第一次（幂等）。
 */
@Injectable()
export class ImageCaptionStore {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(ReplyPlanStore) private readonly plans: ReplyPlanStore,
  ) {}

  private aad(mediaId: string, scope: ContentScope): string {
    return `ai:image-caption:${mediaId}:${scope}`;
  }

  /** 取一批图片的描述；同一张图日常与私密都有时优先日常那份。失败返回空表（不影响聊天）。 */
  async load(
    userId: string,
    mediaIds: readonly string[],
    scopes: readonly ContentScope[],
  ): Promise<CaptionMap> {
    const out = new Map<string, ImageCaption>();
    if (!mediaIds.length || !scopes.length) return out;
    try {
      const rows = await this.db.db
        .select()
        .from(imageCaptions)
        .where(
          and(
            eq(imageCaptions.userId, userId),
            inArray(imageCaptions.mediaId, [...new Set(mediaIds)].slice(0, 500)),
            inArray(imageCaptions.scope, [...scopes]),
          ),
        );
      rows.sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'normal' ? -1 : 1));
      const plains = await this.crypto.openMany(
        userId,
        rows.map((r) => ({
          aad: this.aad(r.mediaId, r.scope as ContentScope),
          sealed: r.captionCiphertext,
        })),
      );
      rows.forEach((row, index) => {
        if (out.has(row.mediaId)) return;
        try {
          const parsed = ImageCaption.safeParse(JSON.parse(plains[index]!.toString('utf8')));
          if (parsed.success) out.set(row.mediaId, parsed.data);
        } catch {
          // 坏数据当作没有描述
        }
      });
    } catch {
      return new Map();
    }
    return out;
  }

  /** 读一批消息里所有图片的描述。 */
  async forMessages(
    userId: string,
    messages: readonly Message[],
    scopes: readonly ContentScope[],
  ): Promise<CaptionMap> {
    const ids = captionMediaIds(messages);
    return ids.length ? this.load(userId, ids, scopes) : NO_CAPTIONS;
  }

  /** 存一张图的描述（同一用户、同一张图、同一范围只存第一次）。 */
  async save(
    input: {
      userId: string;
      mediaId: string;
      scope: ContentScope;
      messageId: string | null;
      conversationId: string | null;
      caption: ImageCaption;
      modelKey: string | null;
    },
    tx?: DbTx,
  ): Promise<void> {
    const run = async (t: DbTx) => {
      // 与注销 / 好友清除共用锁；模型迟到返回不能复原已清除的描述。
      if (!(await this.plans.lock(t, input.userId, input.conversationId ?? undefined))) return;
      if (input.messageId) {
        const source = await this.chat.getMessage(input.messageId, [input.scope], t);
        if (
          !source ||
          source.status !== 'normal' ||
          source.conversationId !== input.conversationId ||
          !captionMediaIds([source]).includes(input.mediaId)
        )
          return;
      }
      const cipher = await this.crypto.seal(
        input.userId,
        this.aad(input.mediaId, input.scope),
        JSON.stringify(ImageCaption.parse(input.caption)),
        t,
      );
      await t.db
        .insert(imageCaptions)
        .values({
          id: newId(),
          userId: input.userId,
          mediaId: input.mediaId,
          scope: input.scope,
          messageId: input.messageId,
          conversationId: input.conversationId,
          captionCiphertext: cipher,
          modelKey: input.modelKey?.slice(0, 200) ?? null,
          template: CAPTION_TEMPLATE,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing();
    };
    if (tx) await run(tx);
    else await this.db.transaction(run);
  }

  /** 撤回消息：删掉这条消息带出来的描述。 */
  async deleteByMessage(tx: DbTx, messageId: string): Promise<void> {
    await tx.db.delete(imageCaptions).where(eq(imageCaptions.messageId, messageId));
  }

  /** 好友会话被清除：删掉这个会话里的描述。 */
  async deleteByConversation(tx: DbTx, userId: string, conversationId: string): Promise<void> {
    await tx.db
      .delete(imageCaptions)
      .where(
        and(eq(imageCaptions.userId, userId), eq(imageCaptions.conversationId, conversationId)),
      );
  }
}
