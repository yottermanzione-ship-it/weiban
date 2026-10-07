import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AuthResponse, MediaObject } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { DATABASE, TestClock, newId, type Database } from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  MediaService,
  MEDIA_STORAGE,
  S3Storage,
  type ObjectStorage,
} from '../src/modules/media/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

describeDb('media 最小版：权限、图片真实性、加密文件、签名下载与注销', () => {
  let app: INestApplication;
  let dir: string;
  let db: Database;
  let userId: string;
  let userToken: string;
  let otherToken: string;
  let adminToken: string;
  let privateImage: MediaObject;
  let publicImage: MediaObject;
  let image: Buffer;
  const clock = new TestClock('2026-10-05T12:00:00.000Z');
  const logs = captureLogger();
  beforeAll(async () => {
    await resetTestDatabase();
    dir = await mkdtemp(join(tmpdir(), 'weiban-media-'));
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ MEDIA_DISK_ROOT: dir }),
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
    const commands = app.get(IdentityCommands);
    const device = {
      platform: 'web',
      name: 'media test',
      appVersion: '0.1.0',
      timeZone: 'Asia/Shanghai',
    };
    async function login(username: string, admin = false) {
      const id = await commands.createAdmin(username, 'correct horse battery');
      if (!admin) await commands.setRole(username, 'user');
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          username,
          password: 'correct horse battery',
          device,
          kind: admin ? 'admin' : 'app',
        })
        .expect(200);
      return { id, token: AuthResponse.parse(response.body).session.token };
    }
    const user = await login('media_user');
    userId = user.id;
    userToken = user.token;
    otherToken = (await login('media_other')).token;
    adminToken = (await login('media_admin', true)).token;
    image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#FF00AA' } })
      .png()
      .toBuffer();
  });
  afterAll(async () => {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  });
  const http = () => request(app.getHttpServer());
  it('资料头像只能绑定本人user_avatar，拒绝跨用户、错误用途和不存在的ID', async () => {
    const uploaded = MediaObject.parse(
      (
        await http()
          .post('/api/v1/media?purpose=user_avatar')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('file', image, { filename: 'avatar.png', contentType: 'image/png' })
          .expect(201)
      ).body,
    );
    await http()
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ avatarMediaId: uploaded.mediaId })
      .expect(200);
    await http()
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ avatarMediaId: uploaded.mediaId })
      .expect(404);
    await http()
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ avatarMediaId: newId() })
      .expect(404);
    const wrong = MediaObject.parse(
      (
        await http()
          .post('/api/v1/media?purpose=contact_avatar')
          .set('Authorization', `Bearer ${userToken}`)
          .attach('file', image, { filename: 'avatar.png', contentType: 'image/png' })
          .expect(201)
      ).body,
    );
    await http()
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ avatarMediaId: wrong.mediaId })
      .expect(422);
    await http()
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ avatarMediaId: null })
      .expect(200);
    await app.get(MediaService).purgeUser(userId);
  });
  it('未登录拒绝上传；普通用户不能上传预设角色头像；伪造MIME、SVG和空文件拒绝', async () => {
    await http()
      .post('/api/v1/media?purpose=user_avatar')
      .attach('file', image, { filename: 'a.png', contentType: 'image/png' })
      .expect(401);
    await http()
      .post('/api/v1/admin/media?purpose=character_avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', image, 'a.png')
      .expect(403);
    await http()
      .post('/api/v1/media?purpose=character_avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', image, 'a.png')
      .expect(400);
    for (const body of [
      Buffer.from('fake image'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      Buffer.alloc(0),
    ])
      await http()
        .post('/api/v1/media?purpose=user_avatar')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('file', body, { filename: 'a.png', contentType: 'image/png' })
        .expect(400);
    await http()
      .post('/api/v1/media?purpose=user_avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', image, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(400);
    await http()
      .post('/api/v1/media?purpose=user_avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(413);
  });
  it('图片重编码并加密存储，文件名不参与路径；用户私有媒体不向他人泄露', async () => {
    const uploaded = await http()
      .post('/api/v1/media?purpose=contact_avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', image, { filename: '../../CANARY-image.png', contentType: 'image/png' })
      .expect(201);
    privateImage = MediaObject.parse(uploaded.body);
    expect(privateImage).toMatchObject({
      mimeType: 'image/webp',
      width: 8,
      height: 8,
      purpose: 'contact_avatar',
    });
    const row = (
      await db.query<{ storage_key: string; owner_id: string }>(
        'SELECT storage_key,owner_id FROM media.objects WHERE id=$1',
        [privateImage.mediaId],
      )
    ).rows[0]!;
    expect(row.owner_id).toBe(userId);
    expect(row.storage_key).toBe(`${privateImage.mediaId}.sealed`);
    const encrypted = await readFile(join(dir, row.storage_key));
    expect(encrypted.subarray(0, 4).toString()).not.toBe('RIFF');
    expect(encrypted.includes(image)).toBe(false);
    await http()
      .get(`/api/v1/media/${privateImage.mediaId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await http()
      .get(`/api/v1/media/${privateImage.mediaId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const link = new URL(privateImage.url);
    const response = await http()
      .get(link.pathname + link.search)
      .expect(200);
    expect(response.headers['content-type']).toContain('image/webp');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect((await sharp(response.body as Buffer).metadata()).width).toBe(8);
    const tampered = new URL(privateImage.url);
    tampered.searchParams.set('token', 'invalid-signature');
    await http()
      .get(tampered.pathname + tampered.search)
      .expect(403);
    const moved = new URL(privateImage.url);
    moved.pathname = `/api/v1/media/${newId()}/content`;
    await http()
      .get(moved.pathname + moved.search)
      .expect(403);
    expect(logs.capture.text).not.toContain(link.searchParams.get('token'));
  });
  it('管理员头像全员可读，管理上传写审计；签名过期后拒绝并可刷新', async () => {
    const res = await http()
      .post('/api/v1/admin/media?purpose=character_avatar')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', image, 'avatar.png')
      .expect(201);
    publicImage = MediaObject.parse(res.body);
    await http()
      .get(`/api/v1/media/${publicImage.mediaId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    const audit = await db.query(
      "SELECT * FROM platform.audit_log WHERE module='media' AND action='avatar.uploaded'",
    );
    expect(audit.rows).toHaveLength(1);
    clock.advance(300001);
    const old = new URL(privateImage.url);
    await http()
      .get(old.pathname + old.search)
      .expect(403);
    privateImage = MediaObject.parse(
      (
        await http()
          .get(`/api/v1/media/${privateImage.mediaId}`)
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200)
      ).body,
    );
  });
  it('存储失败不留下可访问记录；注销删除文件与元数据，重复删除安全；公共头像保留', async () => {
    const store = app.get<ObjectStorage>(MEDIA_STORAGE);
    const spy = vi.spyOn(store, 'put').mockRejectedValueOnce(new Error('storage down'));
    await http()
      .post('/api/v1/media?purpose=user_avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', image, 'a.png')
      .expect(503);
    spy.mockRestore();
    const service = app.get(MediaService);
    expect(await service.countUserData(userId)).toBe(1);
    const deletion = vi.spyOn(store, 'delete').mockRejectedValueOnce(new Error('storage down'));
    await expect(service.purgeUser(userId)).rejects.toThrow('storage down');
    expect(await service.countUserData(userId)).toBe(1);
    deletion.mockRestore();
    expect(await service.purgeUser(userId)).toBe(1);
    expect(await service.purgeUser(userId)).toBe(0);
    await expect(readFile(join(dir, `${privateImage.mediaId}.sealed`))).rejects.toThrow();
    const old = new URL(privateImage.url);
    await http()
      .get(old.pathname + old.search)
      .expect(404);
    expect(await service.countUserData(userId)).toBe(0);
    expect((await service.getMedia(userId, publicImage.mediaId)).purpose).toBe('character_avatar');
  });
  it('S3兼容实现使用签名请求；可以存取删除加密对象，存储键拒绝路径穿越', async () => {
    const values = new Map<string, Buffer>();
    const server = createServer(async (req, res) => {
      expect(req.headers.authorization).toMatch(/^AWS4-HMAC-SHA256/);
      const path = req.url?.split('?')[0] ?? '';
      if (req.method === 'PUT') {
        const chunks = [];
        for await (const part of req) chunks.push(Buffer.from(part));
        values.set(path, Buffer.concat(chunks));
        res.writeHead(200).end();
      } else if (req.method === 'GET') {
        const body = values.get(path)!;
        res.writeHead(200, { 'Content-Length': body.length }).end(body);
      } else {
        values.delete(path);
        res.writeHead(204).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const client = new S3Client({
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      region: 'test',
      forcePathStyle: true,
      credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
    });
    try {
      const store = new S3Storage(client, 'test-bucket');
      const object = `${newId()}.sealed`;
      const body = Buffer.from('already-encrypted-object');
      await store.put(object, body);
      expect(await store.get(object)).toEqual(body);
      await store.delete(object);
      expect(values.size).toBe(0);
      await expect(store.put('../escape.sealed', body)).rejects.toThrow('存储键');
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
