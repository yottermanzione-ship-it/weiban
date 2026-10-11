import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AuthResponse } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { CharacterService } from '../src/modules/characters/testing.js';
import { MediaAiService } from '../src/modules/ai-runtime/testing.js';
import { MODEL_GATEWAY_MEDIA_PORT } from '../src/modules/model-access/index.js';
import { JOB_QUEUE, newId, type JobQueue } from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('自定义角色音色：真实库、角色快照及语音选择', () => {
  let app: INestApplication;
  let owner: string;
  let other: string;
  let token: string;
  let adminToken: string;
  let voiceA: string;
  let voiceB: string;
  let roleId: string;
  const speech = vi.fn(async () => ({ ok: true, value: { mediaId: newId(), durationMs: 1000 } }));
  const http = () => request(app.getHttpServer());
  const auth = (value: string) => `Bearer ${value}`;
  const form = {
    name: '声音测试角色',
    description:
      '这是一位喜欢观察日常生活的原创成年角色，性格温柔而耐心，喜欢晴天散步和阅读，说话自然简洁，尊重他人边界，不编造真实经历。',
    classification: {
      basis: 'original',
      realPersonKind: null,
      ageSetting: 'adult',
      childAppearance: false,
    },
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
    })
      .overrideProvider(MODEL_GATEWAY_MEDIA_PORT)
      .useValue({
        isServiceEnabled: async () => true,
        synthesizeSpeech: speech,
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await app.get<JobQueue>(JOB_QUEUE).start();
    const identity = app.get(IdentityCommands);
    owner = await identity.createAdmin('voice_owner', 'horse battery staple');
    other = await identity.createAdmin('voice_other', 'horse battery staple');
    await identity.setRole('voice_owner', 'user');
    await identity.createAdmin('voice_admin', 'horse battery staple');
    for (const name of ['voice_owner', 'voice_admin']) {
      const response = AuthResponse.parse(
        (
          await http()
            .post('/api/v1/auth/login')
            .send({
              username: name,
              password: 'horse battery staple',
              kind: name === 'voice_owner' ? 'app' : 'admin',
              device: {
                platform: 'web',
                name: 'test',
                appVersion: '0.1.0',
                timeZone: 'Asia/Shanghai',
              },
            })
            .expect(200)
        ).body,
      );
      if (name === 'voice_owner') token = response.session.token;
      else adminToken = response.session.token;
    }
    for (const name of ['声音甲', '声音乙']) {
      const voice = await http()
        .post('/api/v1/admin/voices')
        .set('Authorization', auth(adminToken))
        .send({
          name,
          tags: [],
          sampleMediaId: null,
          enabled: true,
          providerVoiceKey: 'controlled-test',
          modelKey: 'controlled-speech-test',
          careFallbackMediaId: null,
        })
        .expect(201);
      if (name === '声音甲') voiceA = voice.body.voiceId as string;
      else voiceB = voice.body.voiceId as string;
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  it('选择音色后保存、重读、运行时与试聊快照都保留，非拥有者无法读取私有角色', async () => {
    const role = await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(token))
      .send({ ...form, voiceId: voiceA })
      .expect(200);
    roleId = role.body.characterId as string;
    expect(role.body.voiceId).toBe(voiceA);
    const listed = await http()
      .get('/api/v1/characters/custom')
      .set('Authorization', auth(token))
      .expect(200);
    expect(
      listed.body.items.find((item: { characterId: string }) => item.characterId === roleId)
        .voiceId,
    ).toBe(voiceA);
    const characters = app.get(CharacterService);
    expect((await characters.getForRuntime(owner, roleId))?.card.data.social.voiceId).toBe(voiceA);
    expect(await characters.getForRuntime(other, roleId)).toBeNull();
    const trial = await http()
      .post('/api/v1/characters/custom/trial')
      .set('Authorization', auth(token))
      .send({ ...form, sourceCharacterId: roleId, voiceId: voiceA })
      .expect(200);
    expect(
      (await characters.getForRuntime(owner, trial.body.characterId))?.card.data.social.voiceId,
    ).toBe(voiceA);
    await http()
      .delete(`/api/v1/characters/custom/trial/${trial.body.conversationId}`)
      .set('Authorization', auth(token))
      .expect(200);
  });
  it('陪伴选择优先，默认角色音色实际传到语音合成端口', async () => {
    const ai = app.get(MediaAiService);
    expect(await ai.resolveVoice(roleId, voiceB, voiceA)).toBe(voiceB);
    const result = await ai.planExtras({
      ctx: { userId: owner, characterId: roleId, conversationId: newId(), defaultVoiceId: voiceA },
      triggerId: newId(),
      bubbles: ['你好，今天过得怎样？'],
      userText: '发条语音',
      history: [],
      voiceId: null,
    });
    expect(result?.[0]?.type).toBe('voice');
    expect(speech).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: voiceA, characterId: roleId, billingOwner: 'user' }),
    );
  });
  it('停用音色不能新选且不会被合成，保留旧选择时仍能编辑其他字段', async () => {
    await http()
      .patch(`/api/v1/admin/voices/${voiceA}`)
      .set('Authorization', auth(adminToken))
      .send({ enabled: false })
      .expect(200);
    const ai = app.get(MediaAiService);
    expect(await ai.resolveVoice(roleId, voiceA, voiceB)).toBe(voiceB);
    expect(await ai.resolveVoice(roleId, null, voiceA)).toBeNull();
    await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(token))
      .send({ ...form, voiceId: voiceA })
      .expect(400);
    await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', auth(token))
      .send({ ...form, voiceId: newId() })
      .expect(400);
    const kept = await http()
      .patch(`/api/v1/characters/custom/${roleId}`)
      .set('Authorization', auth(token))
      .send({ name: '新名字', voiceId: voiceA })
      .expect(200);
    expect(kept.body.voiceId).toBe(voiceA);
    const trial = await http()
      .post('/api/v1/characters/custom/trial')
      .set('Authorization', auth(token))
      .send({ ...form, sourceCharacterId: roleId, voiceId: voiceA })
      .expect(200);
    await http()
      .delete(`/api/v1/characters/custom/trial/${trial.body.conversationId}`)
      .set('Authorization', auth(token))
      .expect(200);
    const options = await http()
      .get('/api/v1/voices')
      .set('Authorization', auth(token))
      .expect(200);
    expect(options.body.items.map((item: { voiceId: string }) => item.voiceId)).toEqual([voiceB]);
  });
  it('清空音色从响应和运行时卡片同时去除；错误ID更新不破坏原值', async () => {
    await http()
      .patch(`/api/v1/characters/custom/${roleId}`)
      .set('Authorization', auth(token))
      .send({ voiceId: voiceB })
      .expect(200);
    await http()
      .patch(`/api/v1/characters/custom/${roleId}`)
      .set('Authorization', auth(token))
      .send({ voiceId: newId() })
      .expect(400);
    expect(
      (await app.get(CharacterService).getForRuntime(owner, roleId))?.card.data.social.voiceId,
    ).toBe(voiceB);
    const cleared = await http()
      .patch(`/api/v1/characters/custom/${roleId}`)
      .set('Authorization', auth(token))
      .send({ voiceId: null })
      .expect(200);
    expect(cleared.body.voiceId).toBeNull();
    expect(
      (await app.get(CharacterService).getForRuntime(owner, roleId))?.card.data.social.voiceId,
    ).toBeUndefined();
  });
});
