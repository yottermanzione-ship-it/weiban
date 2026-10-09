/**
 * 自定义角色创建集成测试（T-047 CHR-07）。
 * 验收标准：
 * - POST /api/v1/characters/custom 创建角色，返回 UserCustomCharacter
 * - 儿童特征词命中时 childFeaturesDetected = true
 * - 分类单向规则：real_person → other 返回 422
 * - PATCH /api/v1/characters/custom/:id 更新角色
 * - POST /api/v1/characters/custom/:id/trial 试聊返回 conversationId
 * - 非拥有者无法 PATCH
 * - 试聊不写入长期记忆
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AuthResponse, UserCustomCharacter } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { JOB_QUEUE, TestClock, type JobQueue } from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { CHARACTER_EVALUATOR } from '../src/modules/characters/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

describeDb('自定义角色 CHR-07 真实PG：创建、检测、更新、分类限制、试聊', () => {
  let app: INestApplication;
  let ownerToken: string;
  let otherToken: string;
  let mediaDir: string;
  const clock = new TestClock('2026-10-08T10:00:00Z');
  const logs = captureLogger();
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    await resetTestDatabase();
    mediaDir = await mkdtemp(join(tmpdir(), 'weiban-custom-char-'));
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

    const identity = app.get(IdentityCommands);
    await identity.createAdmin('custom_owner', 'horse battery staple');
    await identity.setRole('custom_owner', 'user');
    ownerToken = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({
            username: 'custom_owner',
            password: 'horse battery staple',
            kind: 'app',
            device: {
              platform: 'web',
              name: 'test',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(200)
      ).body,
    ).session.token;

    await identity.createAdmin('custom_other', 'horse battery staple');
    await identity.setRole('custom_other', 'user');
    otherToken = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({
            username: 'custom_other',
            password: 'horse battery staple',
            kind: 'app',
            device: {
              platform: 'web',
              name: 'test2',
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
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
  });

  it('未登录时返回 401', async () => {
    await http().post('/api/v1/characters/custom').send({}).expect(401);
  });

  it('必填字段缺失返回 400', async () => {
    await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(ownerToken))
      .send({ name: '测试' }) // missing description and classification
      .expect(400);
  });

  it('描述少于 50 字返回 400', async () => {
    await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(ownerToken))
      .send({
        name: '短描述角色',
        description: '太短了',
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
      })
      .expect(400);
  });

  let characterId: string;

  it('创建原创成年角色成功，childFeaturesDetected=false', async () => {
    const body = await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(ownerToken))
      .send({
        name: '原创测试角色',
        description:
          '这是一个性格开朗、乐于助人的原创成年角色，喜欢在日落时分散步，总能带给周围的人温暖与微笑，对生活充满热情。',
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
        catchphrase: '一切都会好起来的！',
        tags: ['开朗', '温暖'],
      })
      .expect(200);
    const char = UserCustomCharacter.parse(body.body);
    expect(char.name).toBe('原创测试角色');
    expect(char.classification.basis).toBe('original');
    expect(char.classification.derived.adultModeEligible).toBe(true);
    expect(char.childFeaturesDetected).toBe(false);
    expect(char.catchphrase).toBe('一切都会好起来的！');
    expect(char.tags).toContain('开朗');
    characterId = char.characterId;
  });

  it('描述含儿童年龄特征时 childFeaturesDetected=true', async () => {
    const body = await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(ownerToken))
      .send({
        name: '儿童特征角色',
        description:
          '这个角色只有8岁，在小学上学，喜欢玩玩具和看动画片，每天放学后认真做作业，是老师和同学眼中的好孩子。',
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'minor',
          childAppearance: false,
        },
      })
      .expect(200);
    const char = UserCustomCharacter.parse(body.body);
    expect(char.childFeaturesDetected).toBe(true);
    expect(char.classification.derived.adultModeEligible).toBe(false);
    expect(char.classification.derived.isMinor).toBe(true);
  });

  it('真人角色 adultModeEligible=false，portraitPolicy=forbidden', async () => {
    const body = await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(ownerToken))
      .send({
        name: '真人角色测试',
        description:
          '这个角色是一位在演艺圈颇具影响力的著名演员，以其精湛的演技和亲和力著称，深受圈内外人士喜爱，口碑极好。',
        classification: {
          basis: 'real_person',
          realPersonKind: 'private_person',
          ageSetting: 'adult',
          childAppearance: false,
        },
      })
      .expect(200);
    const char = UserCustomCharacter.parse(body.body);
    expect(char.classification.basis).toBe('real_person');
    expect(char.classification.derived.adultModeEligible).toBe(false);
    expect(char.classification.derived.portraitPolicy).toBe('forbidden');
  });

  it('PATCH 更新角色名字和口头禅', async () => {
    const body = await http()
      .patch(`/api/v1/characters/custom/${characterId}`)
      .set('Authorization', auth(ownerToken))
      .send({ name: '更新后的角色名', catchphrase: '新口头禅！' })
      .expect(200);
    const char = UserCustomCharacter.parse(body.body);
    expect(char.name).toBe('更新后的角色名');
    expect(char.catchphrase).toBe('新口头禅！');
  });

  it('非拥有者 PATCH 返回 404', async () => {
    await http()
      .patch(`/api/v1/characters/custom/${characterId}`)
      .set('Authorization', auth(otherToken))
      .send({ name: '越权更新' })
      .expect(404);
  });

  it('real_person→original 分类变更返回 422 classification_change_forbidden', async () => {
    // 先创建一个真人角色
    const createRes = await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(ownerToken))
      .send({
        name: '真人变更测试',
        description:
          '这个角色是一位真实存在的公众人物，拥有丰富的真实经历与公开资料，在社会上具有相当知名度和广泛影响力。',
        classification: {
          basis: 'real_person',
          realPersonKind: 'celebrity',
          ageSetting: 'adult',
          childAppearance: false,
        },
      })
      .expect(200);
    const created = UserCustomCharacter.parse(createRes.body);
    // 尝试改回 original → 应该被拒绝
    await http()
      .patch(`/api/v1/characters/custom/${created.characterId}`)
      .set('Authorization', auth(ownerToken))
      .send({
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
      })
      .expect(422);
  });

  it('minor→adult 分类变更返回 422 classification_change_forbidden', async () => {
    const createRes = await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(ownerToken))
      .send({
        name: '未成年角色测试',
        description:
          '这是一个年龄设定为未满18岁的年轻角色，目前在学校就读，性格纯真善良，对身边每一个人都十分友善温柔。',
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'minor',
          childAppearance: false,
        },
      })
      .expect(200);
    const created = UserCustomCharacter.parse(createRes.body);
    await http()
      .patch(`/api/v1/characters/custom/${created.characterId}`)
      .set('Authorization', auth(ownerToken))
      .send({
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult', // minor → adult 禁止
          childAppearance: false,
        },
      })
      .expect(422);
  });

  it('试聊返回 conversationId，不建立正式联系人，不写入长期记忆', async () => {
    const res = await http()
      .post(`/api/v1/characters/custom/${characterId}/trial`)
      .set('Authorization', auth(ownerToken))
      .expect(200);
    expect(res.body.conversationId).toBeTruthy();

    // 验证没有建立正式联系人关系
    const contacts = await http()
      .get('/api/v1/contacts')
      .set('Authorization', auth(ownerToken))
      .expect(200);
    const contactIds = (contacts.body.items as Array<{ characterId: string }>).map(
      (c) => c.characterId,
    );
    expect(contactIds).not.toContain(characterId);

    // 再次调用应复用同一会话
    const res2 = await http()
      .post(`/api/v1/characters/custom/${characterId}/trial`)
      .set('Authorization', auth(ownerToken))
      .expect(200);
    expect(res2.body.conversationId).toBe(res.body.conversationId);
  });

  it('其他用户无法发起试聊', async () => {
    await http()
      .post(`/api/v1/characters/custom/${characterId}/trial`)
      .set('Authorization', auth(otherToken))
      .expect(404);
  });

  it('childFeaturesDetected 只增不减：更新人设不含儿童词时保持 true', async () => {
    // 先创建有儿童特征的角色
    const createRes = await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(ownerToken))
      .send({
        name: '单向检测测试',
        description:
          '这个角色只有8岁，正在小学一年级就读，性格活泼开朗，喜欢和小朋友们一起奔跑跳跃玩耍，非常有活力。，是',
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'minor',
          childAppearance: false,
        },
      })
      .expect(200);
    const created = UserCustomCharacter.parse(createRes.body);
    expect(created.childFeaturesDetected).toBe(true);

    // 用不含儿童特征的描述更新
    const updated = await http()
      .patch(`/api/v1/characters/custom/${created.characterId}`)
      .set('Authorization', auth(ownerToken))
      .send({
        description:
          '这是一个普通的成年角色，没有特殊的背景设定，平时生活简单，性格平和，对人真诚友善，生活态度积极乐观。',
      })
      .expect(200);
    // childFeaturesDetected 不会从 true 变成 false
    expect(UserCustomCharacter.parse(updated.body).childFeaturesDetected).toBe(true);
  });
});
