import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  EVENT_DISPATCHER,
  OUTBOX,
  TestClock,
  newId,
  type Database,
  type EnvelopeCrypto,
  type EventDispatcher,
  type Outbox,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { MomentsService } from '../src/modules/moments/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

/**
 * 重置角色的朋友圈分流（真实 PG）：moments.on_contact_reset 按 forwarded_public
 * 分流删动态与互动子项，library.on_contact_reset 按同一分流删动态类收藏快照。
 * 数据直接按表结构播种（moments/library 表无指向用户/角色表的外键），事件经
 * Outbox 发布、由分发器投递，与生产路径一致。
 */
describeDb('重置角色朋友圈分流：真实PG', () => {
  let app: INestApplication;
  let db: Database;
  let outbox: Outbox;
  let crypto: EnvelopeCrypto;
  let userId: string;
  let mediaDir: string;
  const clock = new TestClock('2026-10-31T00:00:00Z');
  const logs = captureLogger();

  beforeAll(async () => {
    await resetTestDatabase();
    mediaDir = await mkdtemp(join(tmpdir(), 'weiban-moments-reset-'));
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web', MEDIA_DISK_ROOT: mediaDir }),
          clock,
          logger: logs.logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
    outbox = app.get(OUTBOX);
    crypto = app.get(ENVELOPE_CRYPTO);
    const identity = app.get(IdentityCommands);
    userId = await identity.createAdmin('moments_reset_owner', 'correct horse battery');
    await identity.setRole('moments_reset_owner', 'user');
  });

  afterAll(async () => {
    await app?.close();
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
  });

  async function dispatch(): Promise<void> {
    for (let i = 0; i < 20; i++)
      if ((await app.get<EventDispatcher>(EVENT_DISPATCHER).dispatchOnce(200)).claimed === 0)
        return;
    throw new Error('event backlog');
  }

  async function publishReset(characterId: string, conversationId: string | null): Promise<void> {
    await db.transaction(async (tx) => {
      await outbox.publish(tx, 'contacts.contact_reset', 'contacts', {
        userId,
        characterId,
        conversationId,
      });
    });
    await dispatch();
  }

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await db.query<{ n: string }>(sql, params);
    return Number(rows[0]?.n ?? 0);
  }

  const postCount = (id: string) =>
    count('SELECT count(*) AS n FROM moments.posts WHERE id = $1', [id]);
  const commentCount = (id: string) =>
    count('SELECT count(*) AS n FROM moments.comments WHERE id = $1', [id]);
  const likeCount = (postId: string, actorKind: string, actorRefId: string) =>
    count(
      'SELECT count(*) AS n FROM moments.likes WHERE post_id = $1 AND actor_kind = $2 AND actor_ref_id = $3',
      [postId, actorKind, actorRefId],
    );
  const favoriteCount = (sourceId: string) =>
    count('SELECT count(*) AS n FROM library.favorites WHERE source_id = $1', [sourceId]);

  async function seedPost(input: {
    authorKind: 'user' | 'character';
    authorCharacterId: string | null;
    forwardedPublic: boolean;
  }): Promise<string> {
    const id = newId();
    // 正文须为真密文：library 分流经 moments 端口 getPost 判定，会解密正文。
    const sealed = await crypto.seal(userId, `moments:post:${id}`, 'seed post');
    await db.query(
      `INSERT INTO moments.posts
         (id, owner_user_id, author_kind, author_character_id, text_ciphertext, link,
          visibility_kind, source_kind, source_id, forwarded_public, create_key, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, 'daily_event', NULL, $6, $7, $8)`,
      [
        id,
        userId,
        input.authorKind,
        input.authorCharacterId,
        sealed,
        input.forwardedPublic,
        `seed:${id}`,
        clock.now(),
      ],
    );
    return id;
  }

  async function seedComment(input: {
    postId: string;
    authorKind: 'user' | 'character';
    authorRefId: string;
    replyToCommentId?: string | null;
    replyToKind?: string | null;
    replyToRefId?: string | null;
  }): Promise<string> {
    const id = newId();
    const sealed = await crypto.seal(userId, `moments:comment:${id}`, 'seed comment');
    await db.query(
      `INSERT INTO moments.comments
         (id, post_id, author_kind, author_ref_id, reply_to_comment_id, reply_to_kind,
          reply_to_ref_id, text_ciphertext, mentions_user, create_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10)`,
      [
        id,
        input.postId,
        input.authorKind,
        input.authorRefId,
        input.replyToCommentId ?? null,
        input.replyToKind ?? null,
        input.replyToRefId ?? null,
        sealed,
        `seed:${id}`,
        clock.now(),
      ],
    );
    return id;
  }

  async function seedLike(
    postId: string,
    actorKind: 'user' | 'character',
    actorRefId: string,
  ): Promise<void> {
    await db.query(
      'INSERT INTO moments.likes (post_id, actor_kind, actor_ref_id, created_at) VALUES ($1, $2, $3, $4)',
      [postId, actorKind, actorRefId, clock.now()],
    );
  }

  async function seedFavorite(input: {
    sourceKind: 'message' | 'moments_post';
    sourceId: string;
    characterId: string | null;
    conversationId: string | null;
  }): Promise<void> {
    await db.query(
      `INSERT INTO library.favorites
         (id, user_id, source_kind, source_id, conversation_id, sender_kind, sender_ref_id,
          character_id, content_ciphertext, content_type, extra_images, scope, labels,
          source_created_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'character', $6, $7, $8, 'text', '{}'::uuid[],
               'normal', '{}'::text[], $9, $9)`,
      [
        newId(),
        userId,
        input.sourceKind,
        input.sourceId,
        input.conversationId,
        input.characterId,
        input.characterId,
        Buffer.from('seed'),
        clock.now(),
      ],
    );
  }

  /** 解出重置后新增的同步更新（post_changed / badge_updated），断言信号口径。 */
  async function syncUpdatesSince(seq: number): Promise<Array<{ type: string; data: unknown }>> {
    const { rows } = await db.query<{ seq: string; payload: Buffer }>(
      'SELECT update_seq AS seq, encrypted_payload AS payload FROM realtime.user_updates WHERE user_id = $1 AND update_seq > $2 ORDER BY update_seq',
      [userId, seq],
    );
    const out: Array<{ type: string; data: unknown }> = [];
    for (const row of rows) {
      const plain = await crypto.open(userId, `realtime:update:${row.seq}`, row.payload);
      const parsed = JSON.parse(plain.toString('utf8')) as { type: string; data: unknown };
      out.push(parsed);
    }
    return out;
  }

  async function cursorSeq(): Promise<number> {
    const { rows } = await db.query<{ seq: string }>(
      'SELECT last_update_seq AS seq FROM realtime.user_update_cursors WHERE user_id = $1',
      [userId],
    );
    return Number(rows[0]?.seq ?? 0);
  }

  it('私人动态删、微博同步动态留，其他人与用户自己的动态不动', async () => {
    const characterId = newId();
    const otherId = newId();
    const privatePost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: false,
    });
    const weiboPost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: true,
    });
    const otherPost = await seedPost({
      authorKind: 'character',
      authorCharacterId: otherId,
      forwardedPublic: false,
    });
    const userPost = await seedPost({
      authorKind: 'user',
      authorCharacterId: null,
      forwardedPublic: false,
    });
    await publishReset(characterId, null);
    expect(await postCount(privatePost)).toBe(0);
    expect(await postCount(weiboPost)).toBe(1);
    expect(await postCount(otherPost)).toBe(1);
    expect(await postCount(userPost)).toBe(1);
  });

  it('保留动态上的评论点赞分流：该角色与用户在该角色动态下的互动删，其余留', async () => {
    const characterId = newId();
    const otherId = newId();
    const weiboPost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: true,
    });
    const userPost = await seedPost({
      authorKind: 'user',
      authorCharacterId: null,
      forwardedPublic: false,
    });
    const charComment = await seedComment({
      postId: weiboPost,
      authorKind: 'character',
      authorRefId: characterId,
    });
    const userComment = await seedComment({
      postId: weiboPost,
      authorKind: 'user',
      authorRefId: userId,
    });
    const otherComment = await seedComment({
      postId: weiboPost,
      authorKind: 'character',
      authorRefId: otherId,
    });
    await seedLike(weiboPost, 'character', characterId);
    await seedLike(weiboPost, 'user', userId);
    await seedLike(weiboPost, 'character', otherId);
    const charCommentOnMine = await seedComment({
      postId: userPost,
      authorKind: 'character',
      authorRefId: characterId,
    });
    const myComment = await seedComment({
      postId: userPost,
      authorKind: 'user',
      authorRefId: userId,
    });
    await seedLike(userPost, 'character', characterId);
    await seedLike(userPost, 'user', userId);
    await publishReset(characterId, null);
    expect(await postCount(weiboPost)).toBe(1);
    expect(await commentCount(charComment)).toBe(0);
    expect(await commentCount(userComment)).toBe(0);
    expect(await commentCount(otherComment)).toBe(1);
    expect(await likeCount(weiboPost, 'character', characterId)).toBe(0);
    expect(await likeCount(weiboPost, 'user', userId)).toBe(0);
    expect(await likeCount(weiboPost, 'character', otherId)).toBe(1);
    expect(await commentCount(charCommentOnMine)).toBe(0);
    expect(await commentCount(myComment)).toBe(1);
    expect(await likeCount(userPost, 'character', characterId)).toBe(0);
    expect(await likeCount(userPost, 'user', userId)).toBe(1);
  });

  it('回复链闭包：被删评论的全部后代回复随删，与链无关的评论留', async () => {
    const characterId = newId();
    const otherId = newId();
    const userPost = await seedPost({
      authorKind: 'user',
      authorCharacterId: null,
      forwardedPublic: false,
    });
    const c1 = await seedComment({
      postId: userPost,
      authorKind: 'character',
      authorRefId: characterId,
    });
    const r1 = await seedComment({
      postId: userPost,
      authorKind: 'user',
      authorRefId: userId,
      replyToCommentId: c1,
      replyToKind: 'character',
      replyToRefId: characterId,
    });
    const r2 = await seedComment({
      postId: userPost,
      authorKind: 'character',
      authorRefId: otherId,
      replyToCommentId: r1,
      replyToKind: 'user',
      replyToRefId: userId,
    });
    const r3 = await seedComment({
      postId: userPost,
      authorKind: 'user',
      authorRefId: userId,
      replyToCommentId: r2,
      replyToKind: 'character',
      replyToRefId: otherId,
    });
    const c2 = await seedComment({
      postId: userPost,
      authorKind: 'user',
      authorRefId: userId,
    });
    const c3 = await seedComment({
      postId: userPost,
      authorKind: 'character',
      authorRefId: characterId,
      replyToCommentId: c2,
      replyToKind: 'user',
      replyToRefId: userId,
    });
    const c4 = await seedComment({
      postId: userPost,
      authorKind: 'character',
      authorRefId: otherId,
    });
    await publishReset(characterId, null);
    for (const id of [c1, r1, r2, r3, c3]) expect(await commentCount(id)).toBe(0);
    expect(await commentCount(c2)).toBe(1);
    expect(await commentCount(c4)).toBe(1);
  });

  it('收藏分流：被删动态的快照删，微博动态与他人动态的快照留；消息快照只清本次会话', async () => {
    const characterId = newId();
    const otherId = newId();
    const conversationId = newId();
    const privatePost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: false,
    });
    const weiboPost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: true,
    });
    const otherPost = await seedPost({
      authorKind: 'character',
      authorCharacterId: otherId,
      forwardedPublic: false,
    });
    await seedFavorite({
      sourceKind: 'moments_post',
      sourceId: privatePost,
      characterId,
      conversationId: null,
    });
    await seedFavorite({
      sourceKind: 'moments_post',
      sourceId: weiboPost,
      characterId,
      conversationId: null,
    });
    await seedFavorite({
      sourceKind: 'moments_post',
      sourceId: otherPost,
      characterId: otherId,
      conversationId: null,
    });
    const messageId = newId();
    await seedFavorite({
      sourceKind: 'message',
      sourceId: messageId,
      characterId,
      conversationId,
    });
    const otherMessageId = newId();
    await seedFavorite({
      sourceKind: 'message',
      sourceId: otherMessageId,
      characterId,
      conversationId: newId(),
    });
    await publishReset(characterId, conversationId);
    expect(await favoriteCount(privatePost)).toBe(0);
    expect(await favoriteCount(weiboPost)).toBe(1);
    expect(await favoriteCount(otherPost)).toBe(1);
    expect(await favoriteCount(messageId)).toBe(0);
    expect(await favoriteCount(otherMessageId)).toBe(1);
  });

  it('动态已先被删时收藏仍按分流删：library 分支不依赖 moments 订阅者的执行顺序', async () => {
    const characterId = newId();
    const privatePost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: false,
    });
    const weiboPost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: true,
    });
    await seedFavorite({
      sourceKind: 'moments_post',
      sourceId: privatePost,
      characterId,
      conversationId: null,
    });
    await seedFavorite({
      sourceKind: 'moments_post',
      sourceId: weiboPost,
      characterId,
      conversationId: null,
    });
    // 模拟 moments 订阅者已先执行：动态行已不在，收藏快照仍在。
    await db.query('DELETE FROM moments.posts WHERE id = $1', [privatePost]);
    await publishReset(characterId, null);
    expect(await favoriteCount(privatePost)).toBe(0);
    expect(await favoriteCount(weiboPost)).toBe(1);
  });

  it('同步信号：删动态发 post_changed(deleted=true)，互动删发 post_changed(deleted=false)，再发 badge_updated', async () => {
    const characterId = newId();
    const privatePost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: false,
    });
    const weiboPost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: true,
    });
    await seedComment({
      postId: weiboPost,
      authorKind: 'character',
      authorRefId: characterId,
    });
    const before = await cursorSeq();
    await publishReset(characterId, null);
    const updates = await syncUpdatesSince(before);
    const postChanged = updates.filter((u) => u.type === 'moments.post_changed');
    const deletedByPost = new Map(
      postChanged.map((u) => {
        const data = u.data as { postId: string; deleted: boolean };
        return [data.postId, data.deleted];
      }),
    );
    expect(deletedByPost.get(privatePost)).toBe(true);
    expect(deletedByPost.get(weiboPost)).toBe(false);
    expect(updates.filter((u) => u.type === 'moments.badge_updated')).toHaveLength(1);
  });

  it('处理幂等：同一对数据重复执行清理不再发同步信号', async () => {
    const characterId = newId();
    const service = app.get(MomentsService);
    const privatePost = await seedPost({
      authorKind: 'character',
      authorCharacterId: characterId,
      forwardedPublic: false,
    });
    await db.transaction((tx) => service.onContactReset(tx, userId, characterId));
    expect(await postCount(privatePost)).toBe(0);
    const before = await cursorSeq();
    await db.transaction((tx) => service.onContactReset(tx, userId, characterId));
    expect(await syncUpdatesSince(before)).toHaveLength(0);
  });
});
