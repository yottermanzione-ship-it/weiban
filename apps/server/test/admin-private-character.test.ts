import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AdminCharacterWrite, AuthResponse, CharacterCard } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CustomCharacterService,
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { DATABASE, type Database } from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('管理员预设角色接口不能操作用户私有草稿', () => {
  let app: INestApplication;
  let db: Database;
  let owner: string;
  let token: string;
  let adminId: string;
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
    })
      .overrideProvider(CHARACTER_EVALUATOR)
      .useValue({
        evaluate: async () => ({
          personaStabilityPassed: true,
          hardBoundaryCasesPassed: true,
          childFeaturesDetected: false,
        }),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
    const identity = app.get(IdentityCommands);
    owner = await identity.createAdmin('private_draft_owner', 'horse battery staple');
    await identity.setRole('private_draft_owner', 'user');
    adminId = await identity.createAdmin('preset_only_admin', 'horse battery staple');
    token = AuthResponse.parse(
      (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            username: 'preset_only_admin',
            password: 'horse battery staple',
            kind: 'admin',
            device: {
              platform: 'web',
              name: 'preset boundary',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(200)
      ).body,
    ).session.token;
  });
  afterAll(async () => {
    await app?.close();
  });
  for (const mode of ['update', 'publish', 'unpublish', 'versions', 'rollback'] as const) {
    it(`${mode}对真实私有角色返回404，草稿、状态及密钥不变`, async () => {
      const role = await app.get(CustomCharacterService).create(owner, {
        name: `私人草稿-${mode}`,
        description:
          '这是一位原创成年虚构角色，喜欢日常阅读与散步，说话自然简洁，尊重他人边界，不编造真实经历，也不声称自己是真人。',
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
      });
      const read = async () => ({
        role: (
          await db.query(
            'SELECT revision,status,draft_ciphertext FROM characters.characters WHERE id=$1',
            [role.characterId],
          )
        ).rows,
        keys: (
          await db.query('SELECT wrapped_dek FROM platform.user_data_keys WHERE owner=$1', [owner])
        ).rows,
      });
      const before = await read();
      const path = `/api/v1/admin/characters/${role.characterId}`;
      const http = request(app.getHttpServer());
      const operation =
        mode === 'update'
          ? http.patch(path).send({ name: '不应进入私有草稿' })
          : mode === 'versions'
            ? http.get(`${path}/persona-versions`)
            : mode === 'rollback'
              ? http.post(`${path}/persona-versions/1/rollback`)
              : http.post(`${path}/${mode}`);
      const response = await operation.set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(404);
      expect(await read()).toEqual(before);
      expect((await app.get(CustomCharacterService).get(owner, role.characterId)).name).toBe(
        role.name,
      );
    });
  }
  it('预设角色仍能真实编辑、发布、列版本、回滚和下架，回滚恢复旧内容', async () => {
    const sample = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
        'utf8',
      ).match(/```json\s*([\s\S]*?)```/)![1]!,
    );
    const body = AdminCharacterWrite.parse({
      name: '预设生命周期',
      tagline: '测试',
      intro: '原始版本',
      categoryId: 'original',
      birthday: null,
      fanName: null,
      avatar: {
        imageMediaId: null,
        display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
      },
      classification: {
        basis: 'original',
        realPersonKind: null,
        ageSetting: 'adult',
        childAppearance: false,
      },
      fallbackGreetings: ['你好，欢迎来聊聊天'],
      card: CharacterCard.parse(sample.card),
    });
    const http = () => request(app.getHttpServer());
    const created = await http()
      .post('/api/v1/admin/characters')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    const characterId = created.body.characterId as string;
    const path = `/api/v1/admin/characters/${characterId}`;
    await app.get(CharacterCheckWorker).runChecks({ characterId, adminId, revision: 1 });
    const first = await http()
      .post(`${path}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(first.body.personaVersion).toBe(1);
    const nextCard = structuredClone(CharacterCard.parse(body.card));
    nextCard.data.speech.catchphrases = ['新版本的口头禅'];
    await http()
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '新版本名字', intro: '新的介绍', card: nextCard })
      .expect(200);
    await app.get(CharacterCheckWorker).runChecks({ characterId, adminId, revision: 2 });
    const second = await http()
      .post(`${path}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(second.body.personaVersion).toBe(2);
    const versions = await http()
      .get(`${path}/persona-versions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(versions.body.items).toHaveLength(2);
    const rollback = await http()
      .post(`${path}/persona-versions/1/rollback`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(rollback.body.personaVersion).toBe(3);
    expect(rollback.body.name).toBe(body.name);
    expect(rollback.body.intro).toBe(body.intro);
    expect((await app.get(CharacterService).getForRuntime(adminId, characterId))?.card).toEqual(
      CharacterCard.parse(body.card),
    );
    const list = await http()
      .get('/api/v1/admin/characters')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      list.body.items.find((item: { characterId: string }) => item.characterId === characterId)
        .name,
    ).toBe(body.name);
    const history = await http()
      .get(`${path}/persona-versions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body.items).toHaveLength(3);
    const repeated = await Promise.all(
      Array.from({ length: 2 }, () =>
        http().post(`${path}/persona-versions/1/rollback`).set('Authorization', `Bearer ${token}`),
      ),
    );
    expect(repeated.map((r) => r.status)).toEqual([201, 201]);
    const finalHistory = await http()
      .get(`${path}/persona-versions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(finalHistory.body.items.map((v: { version: number }) => v.version)).toEqual([
      5, 4, 3, 2, 1,
    ]);
    expect((await app.get(CharacterService).getForRuntime(adminId, characterId))?.card).toEqual(
      CharacterCard.parse(body.card),
    );
    await http().post(`${path}/unpublish`).set('Authorization', `Bearer ${token}`).expect(200);
  });
});
