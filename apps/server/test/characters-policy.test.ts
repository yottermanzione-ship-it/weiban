import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import {
  AdminCharacter,
  AdminCharacterWrite,
  AuthResponse,
  CharacterCard,
  type PolicyPort,
  type CharacterReadPort,
  type GenerateTextInput,
  type ModelGatewayPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { DATABASE, TestClock, newId, type Database } from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { CHARACTER_READ_PORT } from '../src/modules/characters/index.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
  CHARACTER_CONTACT_ACCESS,
  GatewayCharacterEvaluator,
  childFeaturesIn,
} from '../src/modules/characters/testing.js';
import {
  POLICY_PORT,
  deriveClassification,
  classificationCanChange,
} from '../src/modules/policy/index.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';
const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };
const card = CharacterCard.parse(sample.card);
const input = (name = '测试角色') =>
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
  });

describeDb('T-030 角色库与真实policy', () => {
  let app: INestApplication;
  let db: Database;
  let adminId: string;
  let userId: string;
  let adminToken: string;
  let userToken: string;
  let service: CharacterService;
  let policy: PolicyPort;
  let grade = {
    childFeaturesDetected: false,
    personaStabilityPassed: true,
    hardBoundaryCasesPassed: true,
  };
  const added = new Set<string>();
  const clock = new TestClock('2026-10-05T12:00:00.000Z');
  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          clock,
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    })
      .overrideProvider(CHARACTER_EVALUATOR)
      .useValue({ evaluate: async () => grade })
      .overrideProvider(CHARACTER_CONTACT_ACCESS)
      .useValue({
        hasContact: async (user: string, character: string) => added.has(`${user}:${character}`),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
    service = app.get(CharacterService);
    policy = app.get(POLICY_PORT);
    const commands = app.get(IdentityCommands);
    adminId = await commands.createAdmin('character_admin', 'correct horse battery');
    userId = await commands.createAdmin('character_user', 'correct horse battery');
    await commands.setRole('character_user', 'user');
    const device = {
      platform: 'web',
      name: 'character test',
      appVersion: '0.1.0',
      timeZone: 'Asia/Shanghai',
    };
    async function login(username: string, kind: string) {
      return AuthResponse.parse(
        (
          await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ username, password: 'correct horse battery', device, kind })
            .expect(200)
        ).body,
      ).session.token;
    }
    adminToken = await login('character_admin', 'admin');
    userToken = await login('character_user', 'app');
  });
  afterAll(async () => {
    await app?.close();
  });
  const http = () => request(app.getHttpServer());
  async function reviewed(body = input()) {
    const row = await service.create(adminId, body);
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: row.characterId, adminId, revision: 1 });
    return service.publish(adminId, row.characterId);
  }
  it('草稿可保存但不可上架；用户与未登录不能操作管理角色；输入不能伪造检查通过', async () => {
    await http().post('/api/v1/admin/characters').send(input()).expect(401);
    await http()
      .post('/api/v1/admin/characters')
      .set('Authorization', `Bearer ${userToken}`)
      .send(input())
      .expect(403);
    const draft = input('未完成草稿');
    draft.card = { cardSchemaVersion: 1, data: {} };
    const created = AdminCharacter.parse(
      (
        await http()
          .post('/api/v1/admin/characters')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            ...draft,
            publishChecks: { personaStabilityPassed: true, hardBoundaryCasesPassed: true },
          })
          .expect(201)
      ).body,
    );
    expect(created.publishChecks.personaStabilityPassed).toBe(false);
    await http()
      .post(`/api/v1/admin/characters/${created.characterId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422);
    await http()
      .get(`/api/v1/characters/${created.characterId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(404);
  });
  it('完整卡仍须通过受控评测；检查失败不能发布；记录与公开接口没有原文密钥或管理备注', async () => {
    grade = {
      childFeaturesDetected: false,
      personaStabilityPassed: false,
      hardBoundaryCasesPassed: false,
    };
    const failed = await service.create(adminId, input('未通过评测'));
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: failed.characterId, adminId, revision: 1 });
    await expect(service.publish(adminId, failed.characterId)).rejects.toMatchObject({
      status: 422,
    });
    grade = {
      childFeaturesDetected: false,
      personaStabilityPassed: true,
      hardBoundaryCasesPassed: true,
    };
    const body = input('可用角色');
    body.card.data.admin = {
      ...body.card.data.admin,
      creatorNotes: 'CANARY-ADMIN-NOTES-MUST-NOT-LEAK',
    };
    const live = await reviewed(body);
    const res = await http()
      .get(`/api/v1/characters/${live.characterId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain('CANARY-ADMIN-NOTES');
    expect(res.body.card).toBeUndefined();
    const data = await db.query('SELECT * FROM characters.characters');
    expect(JSON.stringify(data.rows)).not.toContain('CANARY-ADMIN-NOTES');
  });
  it('分类公式只看事实：儿童、真人、历史人物及自定义单向限制；不信任卡片自由声明', async () => {
    const normal = await reviewed(input('边界成年'));
    expect(
      await policy.checkAdultGeneration({
        userId,
        characterId: normal.characterId,
        conversationId: newId(),
      }),
    ).toEqual({ allowed: true });
    const kidBody = input('儿童');
    kidBody.classification.ageSetting = 'minor';
    const kid = await reviewed(kidBody);
    expect(
      await policy.checkAdultGeneration({
        userId,
        characterId: kid.characterId,
        conversationId: newId(),
      }),
    ).toMatchObject({ allowed: false, reason: 'adult_mode_not_eligible' });
    expect(
      await policy.checkRelationshipType({
        userId,
        characterId: kid.characterId,
        relationshipType: 'lover',
      }),
    ).toMatchObject({ allowed: false, reason: 'romance_not_allowed' });
    expect(
      await policy.checkModelForCharacter({
        userId,
        characterId: kid.characterId,
        modelHasAdultContent: true,
      }),
    ).toMatchObject({ allowed: false });
    expect(
      await policy.listAllowedScenarioModes({
        userId,
        characterId: kid.characterId,
        candidates: [
          { modeId: 'daily', containsRomance: false, containsAdultContent: false },
          { modeId: 'love', containsRomance: true, containsAdultContent: false },
          { modeId: 'adult', containsRomance: false, containsAdultContent: true },
        ],
      }),
    ).toEqual([{ modeId: 'daily', containsRomance: false, containsAdultContent: false }]);
    const historical = deriveClassification(
      {
        basis: 'real_person',
        realPersonKind: 'historical',
        ageSetting: 'adult',
        childAppearance: false,
      },
      'preset',
      false,
    );
    expect(historical.derived.portraitPolicy).toBe('classical_art_only');
    expect(historical.derived.adultModeEligible).toBe(false);
    expect(deriveClassification(historical, 'custom', false).derived.portraitPolicy).toBe(
      'forbidden',
    );
    expect(
      classificationCanChange(
        historical,
        { ...historical, basis: 'original', realPersonKind: null },
        'custom',
      ),
    ).toBe(false);
    expect(
      classificationCanChange({ ...historical, ageSetting: 'minor' }, historical, 'custom'),
    ).toBe(false);
    expect(childFeaturesIn('这个角色十二岁，在读小学')).toBe(true);
    expect(childFeaturesIn('二十七岁，平时工作')).toBe(false);
    expect(
      await policy.checkAdultGeneration({ userId, characterId: newId(), conversationId: newId() }),
    ).toMatchObject({ allowed: false });
    expect(
      (
        await db.query(
          "SELECT * FROM platform.audit_log WHERE module='policy' AND action='operation.denied'",
        )
      ).rows.length,
    ).toBeGreaterThan(0);
  });
  it('并发发布/重复不产生重复版本；编辑人设不覆盖活跃版本；分类变化立即收紧', async () => {
    const live = await reviewed(input('版本角色'));
    const repeat = await Promise.all([
      service.publish(adminId, live.characterId),
      service.publish(adminId, live.characterId),
    ]);
    expect(repeat.map((r) => r.personaVersion)).toEqual([1, 1]);
    const before = await app
      .get<CharacterReadPort>(CHARACTER_READ_PORT)
      .getForRuntime(userId, live.characterId);
    await service.update(adminId, live.characterId, { card: { cardSchemaVersion: 1, data: {} } });
    const after = await app
      .get<CharacterReadPort>(CHARACTER_READ_PORT)
      .getForRuntime(userId, live.characterId);
    expect(after?.card).toEqual(before?.card);
    expect(
      await policy.checkAdultGeneration({
        userId,
        characterId: live.characterId,
        conversationId: newId(),
      }),
    ).toMatchObject({ allowed: false });
    await expect(service.publish(adminId, live.characterId)).rejects.toMatchObject({ status: 422 });
    const latest = await service.update(adminId, live.characterId, { card });
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: live.characterId, adminId, revision: 2 }); // 旧任务不覆盖revision3
    expect(
      (await service.adminList(adminId, { q: '版本角色' }))[0]?.publishChecks
        .personaStabilityPassed,
    ).toBe(false);
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: live.characterId, adminId, revision: 3 });
    expect((await service.publish(adminId, latest.characterId)).personaVersion).toBe(2);
    expect(
      (
        await db.query('SELECT * FROM characters.persona_versions WHERE character_id=$1', [
          live.characterId,
        ])
      ).rows,
    ).toHaveLength(2);
  });
  it('广场搜索分页、分类与added正确；下架只允许已添加用户继续读', async () => {
    const a = await reviewed(input('分页A'));
    await reviewed(input('分页B'));
    added.add(`${userId}:${a.characterId}`);
    const first = await service.search(userId, { q: '分页', limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const next = await service.search(userId, { q: '分页', limit: 1, cursor: first.nextCursor! });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.characterId).not.toBe(first.items[0]?.characterId);
    await expect(service.search(userId, { cursor: 'malformed', limit: 10 })).rejects.toMatchObject({
      code: 'bad_request',
    });
    await service.unpublish(adminId, a.characterId);
    expect((await service.getProfile(userId, a.characterId)).added).toBe(true);
    await expect(service.getProfile(adminId, a.characterId)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await service.search(userId, { q: '分页A', limit: 10 })).items).toHaveLength(0);
    expect(await service.countUserData(adminId)).toBe(0);
  });
  it('模型检测出的儿童特征同样禁止爱心头像；重新编辑必须重新评测', async () => {
    const body = input('模型儿童特征');
    body.avatar.display.avatarPattern = 'heart';
    const draft = await service.create(adminId, body);
    grade = {
      childFeaturesDetected: true,
      personaStabilityPassed: true,
      hardBoundaryCasesPassed: true,
    };
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: draft.characterId, adminId, revision: 1 });
    await expect(service.publish(adminId, draft.characterId)).rejects.toMatchObject({
      status: 422,
    });
    grade = {
      childFeaturesDetected: false,
      personaStabilityPassed: true,
      hardBoundaryCasesPassed: true,
    };
  });
  it('实际评测经平台网关，管理备注不进提示词；损坏的模型评分不能当作通过', async () => {
    const calls: GenerateTextInput[] = [];
    let invalid = false;
    const gateway: ModelGatewayPort = {
      getModelStatus: async () => {
        throw new Error('unused');
      },
      generateText: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          value: {
            text:
              payload.purpose === 'admin_eval'
                ? JSON.stringify(
                    invalid
                      ? { personaStabilityPassed: true }
                      : {
                          childFeaturesDetected: false,
                          personaStabilityPassed: true,
                          hardBoundaryCasesPassed: true,
                        },
                  )
                : '你好，测试回复',
            modelKey: 'evaluation-test',
            usageRecordId: newId(),
            chargedMicros: 0,
            latencyMs: 0,
            usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, estimated: false },
          },
        };
      },
    };
    const body = input();
    body.card.data.admin = { ...body.card.data.admin, creatorNotes: 'ADMIN-SECRET-PROMPT-CANARY' };
    const evaluator = new GatewayCharacterEvaluator(gateway);
    await expect(evaluator.evaluate(adminId, body)).resolves.toMatchObject({
      hardBoundaryCasesPassed: true,
    });
    expect(calls).toHaveLength(7);
    expect(calls.every((c) => c.billingOwner === 'platform' && c.userId === adminId)).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('ADMIN-SECRET-PROMPT-CANARY');
    invalid = true;
    await expect(evaluator.evaluate(adminId, body)).rejects.toThrow();
  });
  it('数据库再次拦截自定义分类放宽、归属修改，并保留曾为私人真人的标记', async () => {
    const preset = await service.create(adminId, input('触发器测试'));
    const id = newId();
    await db.query(
      `INSERT INTO characters.characters
      (id,owner_id,kind,status,name,search_text,basis,real_person_kind,age_setting,
       child_appearance,child_features_detected,draft_ciphertext,checks,created_at,updated_at)
      SELECT $1,$2,'custom',status,name,search_text,'real_person','private_person','minor',
       true,child_features_detected,draft_ciphertext,checks,created_at,updated_at
      FROM characters.characters WHERE id=$3`,
      [id, userId, preset.characterId],
    );
    for (const sql of [
      "UPDATE characters.characters SET basis='original',real_person_kind=NULL WHERE id=$1",
      "UPDATE characters.characters SET age_setting='adult' WHERE id=$1",
      'UPDATE characters.characters SET child_appearance=false WHERE id=$1',
      "UPDATE characters.characters SET kind='preset',owner_id=NULL WHERE id=$1",
    ])
      await expect(db.query(sql, [id])).rejects.toMatchObject({ code: '23514' });
    await db.query(
      "UPDATE characters.characters SET real_person_kind='celebrity',ever_private_person=false WHERE id=$1",
      [id],
    );
    expect(
      (await db.query('SELECT ever_private_person FROM characters.characters WHERE id=$1', [id]))
        .rows[0]?.ever_private_person,
    ).toBe(true);
  });
});
