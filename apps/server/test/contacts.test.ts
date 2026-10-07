import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AdminCharacterWrite,
  AuthResponse,
  CharacterCard,
  Contact,
  type ContactsReadPort,
  type ChatReadPort,
  type ChatParticipantPort,
  type ChatUserPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  JOB_QUEUE,
  EVENT_DISPATCHER,
  TestClock,
  newId,
  type Database,
  type JobQueue,
  type EventDispatcher,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { MediaService } from '../src/modules/media/testing.js';
import {
  CHAT_READ_PORT,
  CHAT_USER_PORT,
  CHAT_PARTICIPANT_PORT,
} from '../src/modules/chat/index.js';
import { CONTACTS_READ_PORT } from '../src/modules/contacts/index.js';
import {
  ContactsCommands,
  ContactsLifecycle,
  ContactsTestQueries,
  ACCEPT_CONTACT_JOB,
} from '../src/modules/contacts/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';
const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };
const card = CharacterCard.parse(sample.card);

describeDb('contacts 真实PG：持久申请、本人数据与恢复生命周期', () => {
  let app: INestApplication;
  let db: Database;
  let commands: ContactsCommands;
  let read: ContactsReadPort;
  let chat: ChatReadPort;
  let users: ChatUserPort;
  let query: ContactsTestQueries;
  let ownerId: string;
  let otherId: string;
  let adminId: string;
  let mediaDir: string;
  let token: string;
  let roleId: string;
  let cid: string;
  const clock = new TestClock('2026-10-06T23:50:00Z');
  const logs = captureLogger();
  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;
  beforeAll(async () => {
    await resetTestDatabase();
    mediaDir = await mkdtemp(join(tmpdir(), 'weiban-contacts-media-'));
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
    })
      .overrideProvider(CHARACTER_EVALUATOR)
      .useValue({
        evaluate: async () => ({
          childFeaturesDetected: false,
          personaStabilityPassed: true,
          hardBoundaryCasesPassed: true,
        }),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await app.get<JobQueue>(JOB_QUEUE).start();
    db = app.get(DATABASE);
    commands = app.get(ContactsCommands);
    read = app.get(CONTACTS_READ_PORT);
    chat = app.get(CHAT_READ_PORT);
    users = app.get(CHAT_USER_PORT);
    query = new ContactsTestQueries(db);
    const identity = app.get(IdentityCommands);
    adminId = await identity.createAdmin('contacts_admin', 'correct horse battery');
    ownerId = await identity.createAdmin('contacts_user', 'correct horse battery', 'Asia/Shanghai');
    otherId = await identity.createAdmin('contacts_other', 'correct horse battery');
    await identity.setRole('contacts_user', 'user');
    token = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({
            username: 'contacts_user',
            password: 'correct horse battery',
            kind: 'app',
            device: {
              platform: 'web',
              name: 'contacts',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(200)
      ).body,
    ).session.token;
    roleId = await published('main role');
  });
  afterAll(async () => {
    await app?.close();
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
  });
  async function published(name: string) {
    const service = app.get(CharacterService);
    const row = await service.create(
      adminId,
      AdminCharacterWrite.parse({
        name,
        tagline: '测试',
        intro: '原创成年角色',
        categoryId: 'original',
        avatar: {
          imageMediaId: null,
          display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
        },
        birthday: '2000-01-02',
        fanName: null,
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
        fallbackGreetings: ['你好，欢迎来聊聊天'],
        card,
      }),
    );
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: row.characterId, adminId, revision: 1 });
    return (await service.publish(adminId, row.characterId)).characterId;
  }
  async function accept(characterId: string, userId = ownerId) {
    const row = await query.row(userId, characterId);
    if (!row) throw new Error('missing contact');
    clock.advance(Math.max(0, row.accept_after.getTime() - clock.nowMs()));
    await commands.accept({ userId, characterId, requestId: row.request_id });
    return read.getActiveContact(userId, characterId);
  }
  it('申请先pending且加密打招呼，P30任务只存ID；当地日期正确，不能提前或重复通过', async () => {
    await http().get('/api/v1/contacts').expect(401);
    const before = clock.nowMs();
    const pending = Contact.parse(
      (
        await http()
          .post('/api/v1/contacts')
          .set('Authorization', auth())
          .send({ characterId: roleId, greeting: 'GREETING_PRIVATE_CANARY' })
          .expect(200)
      ).body,
    );
    expect(pending).toMatchObject({
      status: 'pending',
      conversationId: null,
      knownSince: '2026-10-07',
    });
    const stored = (await query.row(ownerId, roleId))!;
    expect(stored.accept_after.getTime() - before).toBeGreaterThanOrEqual(3000);
    expect(stored.accept_after.getTime() - before).toBeLessThanOrEqual(30000);
    expect(stored.relationship_type).toBe('朋友');
    expect(stored.greeting_ciphertext?.toString()).not.toContain('GREETING_PRIVATE_CANARY');
    const jobs = await app.get<JobQueue>(JOB_QUEUE).boss.findJobs(ACCEPT_CONTACT_JOB);
    expect(
      jobs.some((job) => (job.data as { requestId?: string }).requestId === stored.request_id),
    ).toBe(true);
    expect(JSON.stringify(jobs.map((job) => job.data))).not.toContain('GREETING_PRIVATE_CANARY');
    await commands.accept({ userId: ownerId, characterId: roleId, requestId: stored.request_id });
    expect(await read.getActiveContact(ownerId, roleId)).toBeNull();
    const active = await accept(roleId);
    cid = active!.conversationId!;
    expect(active?.status).toBe('active');
    expect(await read.getPendingGreeting(ownerId, roleId)).toBe('GREETING_PRIVATE_CANARY');
    expect(await read.getPendingGreeting(otherId, roleId)).toBeNull();
    expect((await chat.getConversation(cid))?.lastSeq).toBe(1);
    await commands.accept({ userId: ownerId, characterId: roleId, requestId: stored.request_id });
    expect((await chat.getConversation(cid))?.lastSeq).toBe(1);
    await http()
      .post('/api/v1/contacts')
      .set('Authorization', auth())
      .send({ characterId: roleId })
      .expect(409);
    expect(logs.capture.text).not.toContain('GREETING_PRIVATE_CANARY');
  });
  it('真实联系人装配角色added与下架可见性，其他账号看不到本人关系', async () => {
    const service = app.get(CharacterService);
    expect((await service.getProfile(ownerId, roleId)).added).toBe(true);
    expect((await service.getProfile(otherId, roleId)).added).toBe(false);
    await service.unpublish(adminId, roleId);
    expect((await service.getProfile(ownerId, roleId)).added).toBe(true);
    await expect(service.getProfile(otherId, roleId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(commands.add(otherId, { characterId: roleId })).rejects.toMatchObject({
      code: 'character_not_available',
    });
    await service.publish(adminId, roleId);
  });
  it('修改备注/称呼幂等且本人隔离，媒体不越权也不能用错误用途', async () => {
    const result = Contact.parse(
      (
        await http()
          .patch(`/api/v1/contacts/${roleId}`)
          .set('Authorization', auth())
          .send({ remark: '我的备注', addressAs: '同学' })
          .expect(200)
      ).body,
    );
    expect(result).toMatchObject({ remark: '我的备注', addressAs: '同学' });
    expect(await read.getActiveContact(otherId, roleId)).toBeNull();
    await expect(commands.update(otherId, roleId, { remark: 'wrong user' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      commands.update(ownerId, roleId, { customAvatarMediaId: newId() }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const image = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#0aa35a' },
    })
      .png()
      .toBuffer();
    const media = app.get(MediaService);
    const wrongPurpose = await media.upload(ownerId, 'user_avatar', {
      buffer: image,
      mimetype: 'image/png',
    });
    await expect(
      commands.update(ownerId, roleId, { customAvatarMediaId: wrongPurpose.mediaId }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    const otherImage = await media.upload(otherId, 'contact_avatar', {
      buffer: image,
      mimetype: 'image/png',
    });
    await expect(
      commands.update(ownerId, roleId, { customAvatarMediaId: otherImage.mediaId }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const ownImage = await media.upload(ownerId, 'contact_avatar', {
      buffer: image,
      mimetype: 'image/png',
    });
    expect(
      (await commands.update(ownerId, roleId, { customAvatarMediaId: ownImage.mediaId }))
        .customAvatarMediaId,
    ).toBe(ownImage.mediaId);
    expect(
      (await commands.update(ownerId, roleId, { customAvatarMediaId: null })).customAvatarMediaId,
    ).toBeNull();
    await http()
      .patch(`/api/v1/contacts/${roleId}`)
      .set('Authorization', auth())
      .send({ remark: 'too long'.repeat(10) })
      .expect(400);
  });
  it('第一条真实角色消息提交并投递后清除加密打招呼，后续不重复读取', async () => {
    const participant = app.get<ChatParticipantPort>(CHAT_PARTICIPANT_PORT);
    const role = (await chat.getParticipants(cid)).find((p) => p.kind === 'character')!;
    expect(
      (
        await participant.postMessage({
          conversationId: cid,
          senderParticipantId: role.participantId,
          content: { type: 'text', text: 'first role greeting' },
          idempotencyKey: `greeting:${cid}`,
        })
      ).ok,
    ).toBe(true);
    expect(await read.getPendingGreeting(ownerId, roleId)).toBe('GREETING_PRIVATE_CANARY');
    await app.get<EventDispatcher>(EVENT_DISPATCHER).dispatchOnce(200);
    expect(await read.getPendingGreeting(ownerId, roleId)).toBeNull();
    expect((await query.row(ownerId, roleId))?.greeting_ciphertext).toBeNull();
  });
  it('软删除立即停止收发，恢复保留会话/认识日期/备注；旧清理任务不能清除恢复关系', async () => {
    const sent = await users.sendMessage(ownerId, cid, {
      clientMsgId: newId(),
      content: { type: 'text', text: 'restore history' },
    });
    const before = (await read.getActiveContact(ownerId, roleId))!;
    await commands.remove(ownerId, roleId, 'soft');
    const removed = (await query.row(ownerId, roleId))!;
    expect(await read.getActiveContact(ownerId, roleId)).toBeNull();
    await expect(
      users.sendMessage(ownerId, cid, {
        clientMsgId: newId(),
        content: { type: 'text', text: 'late' },
      }),
    ).rejects.toMatchObject({ code: 'not_conversation_member' });
    await expect(commands.add(ownerId, { characterId: roleId })).rejects.toMatchObject({
      code: 'restore_choice_required',
    });
    await commands.add(ownerId, { characterId: roleId, restoreMode: 'restore' });
    const restored = (await accept(roleId))!;
    expect(restored).toMatchObject({
      conversationId: cid,
      knownSince: before.knownSince,
      remark: '我的备注',
    });
    expect((await chat.getConversation(cid))?.lastSeq).toBe(sent.message.seq + 1);
    clock.advance(30 * 86400000);
    await commands.purgeExpired({
      userId: ownerId,
      characterId: roleId,
      requestId: removed.request_id,
    });
    expect(await read.getActiveContact(ownerId, roleId)).not.toBeNull();
  });
  it('重新认识清除旧聊天与备注；30天过期不要求恢复选项，永久删除再添加是新关系', async () => {
    await commands.remove(ownerId, roleId, 'soft');
    await commands.add(ownerId, { characterId: roleId, restoreMode: 'fresh' });
    const fresh = (await accept(roleId))!;
    expect(fresh.conversationId).not.toBe(cid);
    expect(fresh.remark).toBeNull();
    expect(await chat.getConversation(cid)).toBeNull();
    cid = fresh.conversationId!;
    await commands.remove(ownerId, roleId, 'soft');
    clock.advance(30 * 86400000);
    await commands.add(ownerId, { characterId: roleId });
    const expired = (await accept(roleId))!;
    expect(expired.conversationId).not.toBe(cid);
    expect(await chat.getConversation(cid)).toBeNull();
    cid = expired.conversationId!;
    await commands.remove(ownerId, roleId, 'purge');
    expect(await query.row(ownerId, roleId)).toBeUndefined();
    expect(await chat.getConversation(cid)).toBeNull();
    await commands.add(ownerId, { characterId: roleId });
    cid = (await accept(roleId))!.conversationId!;
  });
  it('申请后下架取消pending，迟到或重复接受不能创建会话', async () => {
    const id = await published('removed before accept');
    await commands.add(ownerId, { characterId: id });
    const row = (await query.row(ownerId, id))!;
    await app.get(CharacterService).unpublish(adminId, id);
    await accept(id);
    expect(await query.row(ownerId, id)).toBeUndefined();
    await commands.accept({ userId: ownerId, characterId: id, requestId: row.request_id });
    expect(await chat.findDirectConversation(ownerId, id)).toBeNull();
  });
  it('并发申请计入pending上限，不超过50；删除释放名额', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) ids.push(await published(`limit ${i}`));
    const results = await Promise.allSettled(
      ids.map((characterId) => commands.add(otherId, { characterId })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(50);
    const failed = results.find((r) => r.status === 'rejected');
    expect(failed).toMatchObject({ status: 'rejected', reason: { code: 'contact_limit_reached' } });
    const listed = await commands.list(otherId);
    expect(listed.items).toHaveLength(50);
    await commands.remove(otherId, listed.items[0]!.characterId, 'purge');
    const failedId = ids[results.findIndex((r) => r.status === 'rejected')]!;
    expect((await commands.add(otherId, { characterId: failedId })).status).toBe('pending');
  });
  it('注销拒绝迟到接受/读取/添加，删除清单不误删其他用户', async () => {
    const id = await published('late account deletion');
    await commands.add(ownerId, { characterId: id });
    const row = (await query.row(ownerId, id))!;
    const dispatcher = app.get<EventDispatcher>(EVENT_DISPATCHER);
    await dispatcher.dispatchOnce();
    token = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({
            username: 'contacts_user',
            password: 'correct horse battery',
            kind: 'app',
            device: {
              platform: 'web',
              name: 'contacts refreshed',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(200)
      ).body,
    ).session.token;
    await http()
      .delete('/api/v1/me')
      .set('Authorization', auth())
      .send({ password: 'correct horse battery', confirm: 'DELETE' })
      .expect(202);
    clock.advance(30000);
    await commands.accept({ userId: ownerId, characterId: id, requestId: row.request_id });
    expect(await read.getActiveContact(ownerId, roleId)).toBeNull();
    expect(await read.getPendingGreeting(ownerId, roleId)).toBeNull();
    await expect(commands.add(ownerId, { characterId: id })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const lifecycle = app.get(ContactsLifecycle);
    expect(await lifecycle.purgeUser(ownerId)).toBeGreaterThan(0);
    expect(await lifecycle.countUserData(ownerId)).toBe(0);
    expect(await lifecycle.purgeUser(ownerId)).toBe(0);
    expect(await lifecycle.countUserData(otherId)).toBe(50);
    await commands.accept({ userId: ownerId, characterId: id, requestId: row.request_id });
    expect(await lifecycle.countUserData(ownerId)).toBe(0);
  });
});
