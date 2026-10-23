import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AdminCharacterWrite,
  AuthResponse,
  CardTemplate,
  CharacterCard,
  MediaObject,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { MEDIA_ASSET_READ_PORT, type MediaAssetReadPort } from '../src/modules/media/index.js';
import { CharacterImageService, type ImageUse } from '../src/modules/ai-runtime/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

describeDb('普通图撤回日常图库兜底：卡片/宠物模板与权限仍保留', () => {
  let app: INestApplication;
  let dir: string;
  let token: string;
  let userId: string;
  let images: CharacterImageService;
  let assets: MediaAssetReadPort;
  const roles: Record<string, string> = {};
  const templates: Record<string, CardTemplate> = {};
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    await resetTestDatabase();
    dir = await mkdtemp(join(tmpdir(), 'weiban-image-fallback-'));
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ MEDIA_DISK_ROOT: dir }),
          logger: captureLogger().logger,
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
    userId = await app.get(IdentityCommands).createAdmin('image_admin', 'correct horse battery');
    token = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({
            username: 'image_admin',
            password: 'correct horse battery',
            kind: 'admin',
            device: {
              platform: 'web',
              name: 'image fallback',
              appVersion: '0.1.0',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(200)
      ).body,
    ).session.token;
    const card = CharacterCard.parse(
      JSON.parse(
        readFileSync(
          resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
          'utf8',
        ).match(/```json\s*([\s\S]*?)```/)![1]!,
      ).card,
    );
    for (const kind of ['original', 'celebrity', 'historical'] as const) {
      const roleCard = structuredClone(card);
      if (kind !== 'original') {
        roleCard.data.knowledge.entries = [];
        roleCard.data.admin.sourceList = [
          {
            title: '测试专用来源',
            url: 'https://example.com/source',
            type: 'fixture',
            accessedAt: '2026-10-11',
          },
        ];
        roleCard.data.safetyStyle.deflectStyle = '不编造私人生活与未经证实的信息';
        roleCard.data.safetyStyle.refuseSelfieStyle = '不发送真人肖像，分享窗外景色';
        roleCard.data.examples.push({
          id: 'image-deflect',
          scene: 'deflectRumor',
          turns: [{ role: 'char', text: '我无法确认这件事，也不代本人表态。' }],
        });
      }
      const service = app.get(CharacterService);
      const created = await service.create(
        userId,
        AdminCharacterWrite.parse({
          name: `素材测试${kind}`,
          tagline: '发图验证',
          intro: '发图边界测试角色',
          categoryId: 'original',
          avatar: {
            imageMediaId: null,
            display: {
              supportColors: [],
              avatarText: null,
              avatarPattern: 'star',
              themeColor: null,
            },
          },
          birthday: null,
          fanName: null,
          classification: {
            basis: kind === 'original' ? 'original' : 'real_person',
            realPersonKind: kind === 'original' ? null : kind,
            ageSetting: 'adult',
            childAppearance: false,
          },
          fallbackGreetings: ['你好'],
          card: roleCard,
        }),
      );
      await app
        .get(CharacterCheckWorker)
        .runChecks({ characterId: created.characterId, adminId: userId, revision: 1 });
      await service.publish(userId, created.characterId);
      roles[kind] = created.characterId;
    }
    for (const [name, kind, portraitFree, classicalStyle, enabled] of [
      ['portrait', 'daily_photo', false, false, true],
      ['landscape', 'daily_photo', true, false, true],
      ['classical', 'daily_photo', true, true, true],
      ['classicalPortrait', 'daily_photo', false, true, true],
      ['disabled', 'daily_photo', true, true, false],
      ['moment', 'moment', true, true, true],
      ['pet', 'pet', true, true, true],
    ] as const) {
      const image = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#44AA88' },
      })
        .png()
        .toBuffer();
      const media = MediaObject.parse(
        (
          await http()
            .post('/api/v1/admin/media?purpose=card_template')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', image, { filename: `${name}.png`, contentType: 'image/png' })
            .expect(201)
        ).body,
      );
      templates[name] = CardTemplate.parse(
        (
          await http()
            .post('/api/v1/admin/card-templates')
            .set('Authorization', `Bearer ${token}`)
            .send({
              name,
              kinds: [kind],
              mediaId: media.mediaId,
              portraitFree,
              classicalStyle,
              enabled,
            })
            .expect(201)
        ).body,
      );
    }
    images = app.get(CharacterImageService);
    assets = app.get(MEDIA_ASSET_READ_PORT);
  }, 60000);
  afterAll(async () => {
    await app?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  const generate = (role: string, use: ImageUse, key: string, cardKind?: string) =>
    images.generate({
      userId,
      characterId: roles[role]!,
      use,
      scene: '窗外的树木',
      idempotencyKey: key,
      ...(cardKind ? { cardKind } : {}),
    });

  it('管理接口真实保存日常照片、古风和无肖像标记，普通用户不能管理素材', async () => {
    const response = await http()
      .get('/api/v1/admin/card-templates')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const rows = response.body.items as CardTemplate[];
    expect(rows.find((r) => r.templateId === templates.classical!.templateId)).toMatchObject({
      kinds: ['daily_photo'],
      classicalStyle: true,
      portraitFree: true,
    });
    await http().post('/api/v1/admin/card-templates').send({}).expect(401);
  });
  it('即使库中有合规日常照片，普通角色/真人的聊天和朋友圈也不再抽取', async () => {
    for (const role of ['original', 'celebrity']) {
      for (const use of ['chat', 'moments'] as const) {
        expect(await generate(role, use, `no-stock-${role}-${use}`)).toBeNull();
      }
    }
    expect(
      (await assets.listCardTemplates('daily_photo', true, true)).map((r) => r.mediaId),
    ).toEqual([templates.classical!.mediaId]);
  });
  it('历史人物也不拿古风素材冒充普通聊天/朋友圈照片', async () => {
    for (const use of ['chat', 'moments'] as const) {
      expect(await generate('historical', use, `historical-${use}`)).toBeNull();
    }
  });
  it('卡片与宠物仍按原用途，空类别不借用日常图', async () => {
    expect((await generate('historical', 'card', 'card', 'moment'))?.mediaId).toBe(
      templates.moment!.mediaId,
    );
    expect((await generate('historical', 'pet', 'pet'))?.mediaId).toBe(templates.pet!.mediaId);
    expect(await generate('original', 'card', 'missing', 'holiday')).toBeNull();
  });
  it('停用部分旧素材也不把其余日常图库作为普通图兜底', async () => {
    await http()
      .patch(`/api/v1/admin/card-templates/${templates.classical!.templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200);
    expect(await generate('historical', 'chat', 'no-classical')).toBeNull();
    expect((await assets.listCardTemplates('daily_photo', false, false)).length).toBeGreaterThan(0);
    expect(await generate('original', 'chat', 'original')).toBeNull();
  });
});
