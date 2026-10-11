import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AuthResponse, MediaObject } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { CHARACTER_READ_PORT } from '../src/modules/characters/index.js';
import { LIBRARY_MOMENTS_READ } from '../src/modules/library/index.js';
import { LibraryService } from '../src/modules/library/testing.js';
import { MediaService, MEDIA_STORAGE, type ObjectStorage } from '../src/modules/media/testing.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  newId,
  type Database,
  type EnvelopeCrypto,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('收藏头像快照：真实数据库、复制加密与回滚清理', () => {
  let app: INestApplication;
  let dir: string;
  let db: Database;
  let owner: string;
  let token: string;
  let avatar: MediaObject;
  const characterId = newId();
  const profiles = vi.fn(async () => [{ name: '收藏时的角色名', avatar: { image: avatar } }]);
  const http = () => request(app.getHttpServer());
  const post = vi.fn(async (_user: string, id: string) => ({
    id,
    author: { kind: 'character', refId: characterId },
    text: 'FAVORITE_SNAPSHOT_CANARY',
    images: [],
    link: null,
    createdAt: '2026-10-12T00:00:00Z',
  }));
  const input = (postId = newId()) => ({ items: [{ kind: 'moments_post', postId }] });
  const copies = async () =>
    (
      await db.query(
        "SELECT id FROM media.objects WHERE owner_id=$1 AND purpose='contact_avatar'",
        [owner],
      )
    ).rows;
  beforeAll(async () => {
    await resetTestDatabase();
    dir = await mkdtemp(join(tmpdir(), 'weiban-library-'));
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web', MEDIA_DISK_ROOT: dir }),
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    })
      .overrideProvider(CHARACTER_READ_PORT)
      .useValue({ getProfiles: profiles })
      .overrideProvider(LIBRARY_MOMENTS_READ)
      .useValue({ getPost: post })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
    const identity = app.get(IdentityCommands);
    owner = await identity.createAdmin('snapshot_owner', 'horse battery staple');
    await identity.setRole('snapshot_owner', 'user');
    token = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({
            username: 'snapshot_owner',
            password: 'horse battery staple',
            kind: 'app',
            device: {
              platform: 'web',
              name: 'snapshot',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(200)
      ).body,
    ).session.token;
    const image = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#ff0088' },
    })
      .png()
      .toBuffer();
    avatar = MediaObject.parse(
      (
        await http()
          .post('/api/v1/media?purpose=custom_character_avatar')
          .set('Authorization', `Bearer ${token}`)
          .attach('file', image, { filename: 'avatar.png', contentType: 'image/png' })
          .expect(201)
      ).body,
    );
  });
  afterAll(async () => {
    await app?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('收藏正文加密失败时，数据库回滚并删除已复制头像，保留原头像', async () => {
    const crypto = app.get<EnvelopeCrypto>(ENVELOPE_CRYPTO);
    const seal = crypto.seal.bind(crypto);
    const spy = vi.spyOn(crypto, 'seal').mockImplementation(async (...args) => {
      if (args[1].startsWith('library:favorite:'))
        throw new Error('controlled favorite encryption failure');
      return seal(...args);
    });
    try {
      await expect(app.get(LibraryService).addFavorites(owner, input())).rejects.toThrow(
        'controlled favorite encryption failure',
      );
    } finally {
      spy.mockRestore();
    }
    expect(
      (await db.query('SELECT id FROM library.favorites WHERE user_id=$1', [owner])).rows,
    ).toHaveLength(0);
    expect(await copies()).toHaveLength(0);
    await http()
      .get(`/api/v1/media/${avatar.mediaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('8路相同来源收藏只保留一个快照，删除收藏后收回复制品而不删除原头像', async () => {
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    profiles.mockImplementation(async () => {
      arrived++;
      if (arrived === 8) release();
      await gate;
      return [{ name: '收藏时的角色名', avatar: { image: avatar } }];
    });
    const body = input();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => app.get(LibraryService).addFavorites(owner, body)),
    );
    profiles.mockImplementation(async () => [
      { name: '收藏时的角色名', avatar: { image: avatar } },
    ]);
    const ids = results.map((r) => r.items[0]!.favoriteId);
    expect(new Set(ids).size).toBe(1);
    expect(await copies()).toHaveLength(1);
    const favorite = results[0]!.items[0]!;
    expect(favorite.characterNameSnapshot).toBe('收藏时的角色名');
    expect(favorite.characterAvatarMediaIdSnapshot).not.toBe(avatar.mediaId);
    const ciphertext = await db.query<{ content_ciphertext: Buffer }>(
      'SELECT content_ciphertext FROM library.favorites WHERE id=$1',
      [favorite.favoriteId],
    );
    expect(ciphertext.rows[0]!.content_ciphertext.toString('utf8')).not.toContain(
      'FAVORITE_SNAPSHOT_CANARY',
    );
    const media = MediaObject.parse(
      (
        await http()
          .get(`/api/v1/media/${favorite.characterAvatarMediaIdSnapshot}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    const url = new URL(media.url);
    const response = await http()
      .get(url.pathname + url.search)
      .expect(200);
    expect(response.body.length).toBeGreaterThan(0);
    await http()
      .delete(`/api/v1/library/favorites/${favorite.favoriteId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(await copies()).toHaveLength(0);
    await http()
      .get(`/api/v1/media/${avatar.mediaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('头像复制不可用时仍保存文字快照，不登记不存在的媒体', async () => {
    const spy = vi
      .spyOn(app.get(MediaService), 'copyObject')
      .mockRejectedValueOnce(new Error('controlled copy unavailable'));
    try {
      const result = await app.get(LibraryService).addFavorites(owner, input());
      expect(result.items[0]!.characterAvatarMediaIdSnapshot).toBeNull();
      expect(result.items[0]!.characterNameSnapshot).toBe('收藏时的角色名');
      expect(await copies()).toHaveLength(0);
      await app.get(LibraryService).removeFavorite(owner, result.items[0]!.favoriteId);
    } finally {
      spy.mockRestore();
    }
  });

  it('注销后迟到的收藏不重新生成用户密钥或头像副本', async () => {
    const identity = app.get(IdentityCommands);
    const lateOwner = await identity.createAdmin('snapshot_late', 'horse battery staple');
    await identity.setRole('snapshot_late', 'user');
    const response = await http()
      .post('/api/v1/auth/login')
      .send({
        username: 'snapshot_late',
        password: 'horse battery staple',
        kind: 'app',
        device: {
          platform: 'web',
          name: 'late snapshot',
          appVersion: '0.1.0',
          timeZone: 'Asia/Shanghai',
        },
      })
      .expect(200);
    const lateToken = AuthResponse.parse(response.body).session.token;
    await app
      .get<EnvelopeCrypto>(ENVELOPE_CRYPTO)
      .seal(lateOwner, 'existing-test-data', 'before deletion');
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    profiles.mockImplementationOnce(async () => {
      entered();
      await gate;
      return [{ name: '收藏时的角色名', avatar: { image: avatar } }];
    });
    const operation = app
      .get(LibraryService)
      .addFavorites(lateOwner, input())
      .then(
        () => null,
        (error: unknown) => error,
      );
    try {
      await ready;
      await http()
        .delete('/api/v1/me')
        .set('Authorization', `Bearer ${lateToken}`)
        .send({ password: 'horse battery staple', confirm: 'DELETE' })
        .expect(202);
      expect(
        (await db.query('SELECT owner FROM platform.user_data_keys WHERE owner=$1', [lateOwner]))
          .rows,
      ).toHaveLength(0);
    } finally {
      release();
      await operation;
    }
    expect(await operation).toMatchObject({ code: 'unauthenticated' });
    expect(
      (await db.query('SELECT id FROM library.favorites WHERE user_id=$1', [lateOwner])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('SELECT id FROM media.objects WHERE owner_id=$1', [lateOwner])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('SELECT owner FROM platform.user_data_keys WHERE owner=$1', [lateOwner]))
        .rows,
    ).toHaveLength(0);
  });

  it('头像写入中的账号状态锁使注销等待，提交后销毁密钥且清理媒体', async () => {
    const identity = app.get(IdentityCommands);
    const raceOwner = await identity.createAdmin('snapshot_writing', 'horse battery staple');
    await identity.setRole('snapshot_writing', 'user');
    const response = await http()
      .post('/api/v1/auth/login')
      .send({
        username: 'snapshot_writing',
        password: 'horse battery staple',
        kind: 'app',
        device: {
          platform: 'web',
          name: 'writing snapshot',
          appVersion: '0.1.0',
          timeZone: 'Asia/Shanghai',
        },
      })
      .expect(200);
    const raceToken = AuthResponse.parse(response.body).session.token;
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage = app.get<ObjectStorage>(MEDIA_STORAGE);
    const put = storage.put.bind(storage);
    const spy = vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return put(...args);
    });
    const media = app.get(MediaService);
    const copy = media
      .copyObject({ mediaId: avatar.mediaId, ownerUserId: raceOwner, purpose: 'contact_avatar' })
      .catch((error: unknown) => error);
    await ready;
    const deletion = http()
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${raceToken}`)
      .send({ password: 'horse battery staple', confirm: 'DELETE' })
      .then((value) => value);
    try {
      await vi.waitFor(
        async () => {
          const blocked = await db.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%update%identity%users%'",
          );
          expect(blocked.rows.length).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      );
    } finally {
      release();
      await copy;
      await deletion;
      spy.mockRestore();
    }
    MediaObject.parse(await copy);
    expect((await deletion).status).toBe(202);
    expect(
      (await db.query('SELECT owner FROM platform.user_data_keys WHERE owner=$1', [raceOwner]))
        .rows,
    ).toHaveLength(0);
    await media.purgeUser(raceOwner);
    expect(
      (await db.query('SELECT id FROM media.objects WHERE owner_id=$1', [raceOwner])).rows,
    ).toHaveLength(0);
  });

  it('新用户媒体文件写入后失败，回滚新建DEK并收回实际文件', async () => {
    const failedOwner = await app
      .get(IdentityCommands)
      .createAdmin('snapshot_storage_failure', 'horse battery staple');
    const storage = app.get<ObjectStorage>(MEDIA_STORAGE);
    const put = storage.put.bind(storage);
    let writtenKey = '';
    const spy = vi.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
      writtenKey = args[0];
      await put(...args);
      throw new Error('controlled failure after actual disk write');
    });
    try {
      await expect(
        app.get(MediaService).copyObject({
          mediaId: avatar.mediaId,
          ownerUserId: failedOwner,
          purpose: 'contact_avatar',
        }),
      ).rejects.toMatchObject({ code: 'service_unavailable' });
    } finally {
      spy.mockRestore();
    }
    expect(writtenKey).not.toBe('');
    await expect(storage.get(writtenKey)).rejects.toThrow();
    expect(
      (await db.query('SELECT id FROM media.objects WHERE owner_id=$1', [failedOwner])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('SELECT owner FROM platform.user_data_keys WHERE owner=$1', [failedOwner]))
        .rows,
    ).toHaveLength(0);
  });

  it('原头像物理删除且角色资料不可读后，收藏仍显示自己的名字和头像快照', async () => {
    const image = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#0088ff' },
    })
      .png()
      .toBuffer();
    const source = MediaObject.parse(
      (
        await http()
          .post('/api/v1/media?purpose=custom_character_avatar')
          .set('Authorization', `Bearer ${token}`)
          .attach('file', image, { filename: 'removed-source.png', contentType: 'image/png' })
          .expect(201)
      ).body,
    );
    profiles.mockImplementationOnce(async () => [
      { name: '删除前的角色名', avatar: { image: source } },
    ]);
    const favorite = (await app.get(LibraryService).addFavorites(owner, input())).items[0]!;
    await app.get(MediaService).deleteObject(source.mediaId);
    profiles.mockResolvedValue([]);
    try {
      await http()
        .get(`/api/v1/media/${source.mediaId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      const response = await http()
        .get('/api/v1/library/favorites')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        response.body.items.find(
          (item: { favoriteId: string }) => item.favoriteId === favorite.favoriteId,
        ),
      ).toMatchObject({
        characterNameSnapshot: '删除前的角色名',
        characterAvatarMediaIdSnapshot: favorite.characterAvatarMediaIdSnapshot,
      });
      const media = MediaObject.parse(
        (
          await http()
            .get(`/api/v1/media/${favorite.characterAvatarMediaIdSnapshot}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        ).body,
      );
      const url = new URL(media.url);
      await http()
        .get(url.pathname + url.search)
        .expect(200);
      await app.get(LibraryService).removeFavorite(owner, favorite.favoriteId);
      expect(await copies()).toHaveLength(0);
    } finally {
      profiles.mockImplementation(async () => [
        { name: '收藏时的角色名', avatar: { image: avatar } },
      ]);
    }
  });
});
