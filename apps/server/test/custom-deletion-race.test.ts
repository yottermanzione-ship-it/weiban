import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AuthResponse, type CharacterPlazaPort } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { CharacterService, CustomCharacterService } from '../src/modules/characters/testing.js';
import { CHARACTER_PLAZA_PORT } from '../src/modules/characters/index.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  newId,
  type Database,
  type EnvelopeCrypto,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('自定义角色注销竞态：迟到创建、试聊和编辑', () => {
  let app: INestApplication;
  let db: Database;
  const body = {
    name: '注销并发角色',
    description:
      '一位原创的成年虚构角色，喜欢阅读和观察日常生活，说话自然简洁，尊重他人边界，愿意认真倾听，不编造真实经历，也不声称自己是真人。',
    classification: {
      basis: 'original',
      realPersonKind: null,
      ageSetting: 'adult',
      childAppearance: false,
    } as const,
  };
  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web' }),
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
  });
  afterAll(async () => {
    await app?.close();
  });

  for (const mode of ['create', 'trial', 'update'] as const) {
    it(`${mode}在注销之后恢复时拒绝，不生成新DEK或新角色版本`, async () => {
      const username = `deletion_${mode}`;
      const identity = app.get(IdentityCommands);
      const userId = await identity.createAdmin(username, 'horse battery staple');
      await identity.setRole(username, 'user');
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          username,
          password: 'horse battery staple',
          kind: 'app',
          device: {
            platform: 'web',
            name: 'deletion race',
            appVersion: '0.1.0',
            timeZone: 'Asia/Shanghai',
          },
        })
        .expect(200);
      const token = AuthResponse.parse(login.body).session.token;
      const custom = app.get(CustomCharacterService);
      const current = mode === 'update' ? await custom.create(userId, body) : null;
      let entered!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const characters = app.get(CharacterService);
      const avatar = characters.customAvatar.bind(characters);
      const spy = vi.spyOn(characters, 'customAvatar').mockImplementationOnce(async (...args) => {
        const result = await avatar(...args);
        entered();
        await gate;
        return result;
      });
      const operation = (
        mode === 'update'
          ? custom.update(userId, current!.characterId, {
              name: '注销后不应保存',
              avatarMediaId: null,
            })
          : custom.create(userId, body, mode === 'trial' ? {} : undefined)
      ).then(
        () => null,
        (error: unknown) => error,
      );
      try {
        await ready;
        await request(app.getHttpServer())
          .delete('/api/v1/me')
          .set('Authorization', `Bearer ${token}`)
          .send({ password: 'horse battery staple', confirm: 'DELETE' })
          .expect(202);
        expect(
          (await db.query('SELECT owner FROM platform.user_data_keys WHERE owner=$1', [userId]))
            .rows,
        ).toHaveLength(0);
      } finally {
        release();
        await operation;
        spy.mockRestore();
      }
      expect(await operation).toMatchObject({ code: 'unauthenticated' });
      expect(
        (await db.query('SELECT owner FROM platform.user_data_keys WHERE owner=$1', [userId])).rows,
      ).toHaveLength(0);
      const rows = await db.query<{ revision: number; name: string }>(
        'SELECT revision,name FROM characters.characters WHERE owner_id=$1',
        [userId],
      );
      if (current) expect(rows.rows).toEqual([{ revision: 1, name: body.name }]);
      else expect(rows.rows).toHaveLength(0);
    });
  }

  it('已取得广场快照的迟到添加在注销后拒绝，不重建密钥或复制品', async () => {
    const identity = app.get(IdentityCommands);
    const userId = await identity.createAdmin('deletion_plaza_copy', 'horse battery staple');
    await identity.setRole('deletion_plaza_copy', 'user');
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: 'deletion_plaza_copy',
        password: 'horse battery staple',
        kind: 'app',
        device: {
          platform: 'web',
          name: 'plaza race',
          appVersion: '0.1.0',
          timeZone: 'Asia/Shanghai',
        },
      })
      .expect(200);
    const token = AuthResponse.parse(login.body).session.token;
    const current = await app.get(CustomCharacterService).create(userId, body);
    const plaza = app.get<CharacterPlazaPort>(CHARACTER_PLAZA_PORT);
    const snapshot = await plaza.buildPublishSnapshot(userId, current.characterId);
    if (!snapshot.ok) throw new Error('测试源角色快照无法创建');
    await request(app.getHttpServer())
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'horse battery staple', confirm: 'DELETE' })
      .expect(202);
    expect(
      (await db.query('SELECT owner FROM platform.user_data_keys WHERE owner=$1', [userId])).rows,
    ).toHaveLength(0);
    await expect(
      plaza.createFromSnapshot({
        userId,
        snapshot: snapshot.value,
        origin: { workId: newId(), version: 1, authorName: '角色作者' },
        idempotencyKey: newId(),
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(
      (await db.query('SELECT owner FROM platform.user_data_keys WHERE owner=$1', [userId])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('SELECT id FROM characters.characters WHERE owner_id=$1', [userId])).rows,
    ).toHaveLength(1);
  });

  it('广场正常复制和更新可用，读取旧草稿后注销的迟到更新不重建密钥', async () => {
    const userId = await app
      .get(IdentityCommands)
      .createAdmin('deletion_plaza_update', 'horse battery staple');
    await app.get(IdentityCommands).setRole('deletion_plaza_update', 'user');
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: 'deletion_plaza_update',
        password: 'horse battery staple',
        kind: 'app',
        device: {
          platform: 'web',
          name: 'plaza update',
          appVersion: '0.1.0',
          timeZone: 'Asia/Shanghai',
        },
      })
      .expect(200);
    const token = AuthResponse.parse(login.body).session.token;
    const source = await app.get(CustomCharacterService).create(userId, body);
    const plaza = app.get<CharacterPlazaPort>(CHARACTER_PLAZA_PORT);
    const snapshot = await plaza.buildPublishSnapshot(userId, source.characterId);
    if (!snapshot.ok) throw new Error('测试源角色快照无法创建');
    const copied = await plaza.createFromSnapshot({
      userId,
      snapshot: snapshot.value,
      origin: { workId: newId(), version: 1, authorName: '角色作者' },
      idempotencyKey: newId(),
    });
    if (!copied.ok) throw new Error('正常广场复制失败');
    const characterId = copied.value.characterId;
    expect(
      await plaza.updateFromSnapshot({
        userId,
        characterId,
        snapshot: { ...snapshot.value, name: '正常更新' },
        version: 2,
      }),
    ).toMatchObject({ ok: true });
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const crypto = app.get<EnvelopeCrypto>(ENVELOPE_CRYPTO);
    const open = crypto.open.bind(crypto);
    const spy = vi.spyOn(crypto, 'open').mockImplementation(async (...args) => {
      const plain = await open(...args);
      if (args[1] === `character:${characterId}:draft:2`) {
        entered();
        await gate;
      }
      return plain;
    });
    const operation = plaza
      .updateFromSnapshot({
        userId,
        characterId,
        snapshot: { ...snapshot.value, name: '注销后不应更新' },
        version: 3,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    try {
      await ready;
      await request(app.getHttpServer())
        .delete('/api/v1/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'horse battery staple', confirm: 'DELETE' })
        .expect(202);
    } finally {
      release();
      await operation;
      spy.mockRestore();
    }
    expect(await operation).toMatchObject({ code: 'unauthenticated' });
    expect(
      (await db.query('SELECT owner FROM platform.user_data_keys WHERE owner=$1', [userId])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('SELECT revision,name FROM characters.characters WHERE id=$1', [characterId]))
        .rows,
    ).toEqual([{ revision: 2, name: '正常更新' }]);
  });
});
