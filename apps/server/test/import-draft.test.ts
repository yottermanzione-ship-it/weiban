import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AuthResponse, ImportResult, type ImportAnalyzerPort } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { BillingAdminService } from '../src/modules/billing/testing.js';
import { IMPORTER_ANALYZER } from '../src/modules/importer/index.js';
import { ImporterService } from '../src/modules/importer/testing.js';
import { JOB_QUEUE, newId, type JobQueue } from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const generated = ImportResult.parse({
  kind: 'new_character',
  draft: { cardSchemaVersion: 1, data: {} },
  suggestedClassification: {
    basis: 'real_person',
    realPersonKind: 'private_person',
    ageSetting: 'adult',
    childAppearance: false,
  },
  detectedRealNames: [],
});
// Controlled analysis tests field persistence, never supplier/model quality.
const analyzer: ImportAnalyzerPort = {
  estimate: async () => 0,
  recognizeScreenshots: async () => ({ ok: false, error: 'vision_unavailable' }),
  detectSpeakers: async () => ({ ok: false, error: 'format_unrecognized' }),
  analyze: async (input) => ({
    ok: true,
    value: {
      ...generated,
      detectedRealNames: input.lines
        .filter((line) => line.text.startsWith('批次'))
        .map((line) => line.text),
    },
  }),
};

describeDb('导入编辑草稿：真实 HTTP、PG 与媒体归属', () => {
  let app: INestApplication;
  let importer: ImporterService;
  let owner: string;
  let token: string;
  let otherToken: string;
  let mediaDir: string;
  const http = () => request(app.getHttpServer());
  const auth = (value: string) => `Bearer ${value}`;
  beforeAll(async () => {
    await resetTestDatabase();
    mediaDir = await mkdtemp(join(tmpdir(), 'weiban-import-draft-'));
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web', MEDIA_DISK_ROOT: mediaDir }),
          kekRing: testKekRing().ring,
          logger: captureLogger().logger,
          background: false,
        }),
      ],
    })
      .overrideProvider(IMPORTER_ANALYZER)
      .useValue(analyzer)
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await app.get<JobQueue>(JOB_QUEUE).start();
    importer = app.get(ImporterService);
    const identity = app.get(IdentityCommands);
    const admin = await identity.createAdmin('import_admin', 'horse battery staple');
    for (const name of ['import_owner', 'import_other']) {
      const userId = await identity.createAdmin(name, 'horse battery staple');
      await identity.setRole(name, 'user');
      await app.get(BillingAdminService).adjust(admin, userId, {
        direction: 'grant',
        amountMicros: 100_000,
        reason: '导入测试',
        idempotencyKey: newId(),
      });
      const login = AuthResponse.parse(
        (
          await http()
            .post('/api/v1/auth/login')
            .send({
              username: name,
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
      );
      if (name === 'import_owner') {
        owner = userId;
        token = login.session.token;
      } else otherToken = login.session.token;
    }
  });
  afterAll(async () => {
    await app?.close();
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
  });
  async function complete(mergeIntoJobId?: string, batch = '你好') {
    const job = await importer.createJob(owner, {
      clientRequestId: newId(),
      kind: 'new_character',
      sourceKind: 'text',
      text: `甲：${batch}\n乙：今天过得怎样`,
      mergeIntoJobId,
    });
    await importer.detect(job.jobId);
    await importer.selectSpeaker(owner, job.jobId, '甲');
    await importer.start(owner, job.jobId, { keepRaw: false });
    await importer.analyze(job.jobId);
    expect((await importer.getJob(owner, job.jobId)).status).toBe('completed');
    return job.jobId;
  }
  async function upload(userToken: string, purpose: string) {
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    return (
      await http()
        .post(`/api/v1/media?purpose=${purpose}`)
        .set('Authorization', auth(userToken))
        .attach('file', image, 'avatar.png')
        .expect(201)
    ).body.mediaId as string;
  }
  const fields = {
    name: '保存的名字',
    description: '',
    catchphrases: [],
    speechStyle: '',
    exampleDialogue: '',
    tags: [],
  };
  it('保存→重读→并发合并保留生日头像和分类；主动清空不会被下一批填回', async () => {
    const jobId = await complete();
    const avatarMediaId = await upload(token, 'custom_character_avatar');
    const result = {
      ...generated,
      editorFields: { ...fields, birthday: '2000-05-16', avatarMediaId },
      suggestedClassification: {
        basis: 'real_person',
        realPersonKind: 'historical',
        ageSetting: 'minor',
        childAppearance: true,
      },
    };
    await http()
      .put(`/api/v1/imports/${jobId}/result`)
      .set('Authorization', auth(token))
      .send(result)
      .expect(200);
    const read = await http()
      .get(`/api/v1/imports/${jobId}/result`)
      .set('Authorization', auth(token))
      .expect(200);
    expect(read.body).toEqual(result);
    await Promise.all([complete(jobId, '批次一'), complete(jobId, '批次二')]);
    const merged = await importer.getResult(owner, jobId);
    expect(merged).toMatchObject({
      editorFields: result.editorFields,
      suggestedClassification: result.suggestedClassification,
    });
    expect(merged.kind === 'new_character' && merged.detectedRealNames.sort()).toEqual([
      '批次一',
      '批次二',
    ]);
    const cleared = { ...result, editorFields: { ...fields, birthday: null, avatarMediaId: null } };
    await http()
      .put(`/api/v1/imports/${jobId}/result`)
      .set('Authorization', auth(token))
      .send(cleared)
      .expect(200);
    await complete(jobId);
    expect(await importer.getResult(owner, jobId)).toMatchObject({
      editorFields: cleared.editorFields,
      suggestedClassification: cleared.suggestedClassification,
    });
  });
  it('拒绝他人私有头像、错误用途、无效日期及非拥有者写入，原草稿保持不变', async () => {
    const jobId = await complete();
    for (const avatarMediaId of [
      await upload(otherToken, 'custom_character_avatar'),
      await upload(token, 'user_avatar'),
    ]) {
      await http()
        .put(`/api/v1/imports/${jobId}/result`)
        .set('Authorization', auth(token))
        .send({ ...generated, editorFields: { ...fields, avatarMediaId } })
        .expect(404);
    }
    await http()
      .put(`/api/v1/imports/${jobId}/result`)
      .set('Authorization', auth(token))
      .send({ ...generated, editorFields: { ...fields, birthday: '2000-02-30' } })
      .expect(400);
    await http()
      .put(`/api/v1/imports/${jobId}/result`)
      .set('Authorization', auth(otherToken))
      .send(generated)
      .expect(404);
    expect(await importer.getResult(owner, jobId)).toEqual(generated);
  });
  it('继续导入只能指向自己的同类已完成草稿', async () => {
    const jobId = await complete();
    const body = {
      clientRequestId: newId(),
      kind: 'new_character',
      sourceKind: 'text',
      text: '甲：你好\n乙：你好',
      mergeIntoJobId: jobId,
    };
    await http()
      .post('/api/v1/imports')
      .set('Authorization', auth(otherToken))
      .send(body)
      .expect(404);
    await http()
      .post('/api/v1/imports')
      .set('Authorization', auth(token))
      .send({ ...body, kind: 'supplement', targetCharacterId: newId() })
      .expect(422);
    const collecting = await importer.createJob(owner, {
      clientRequestId: newId(),
      kind: 'new_character',
      sourceKind: 'file',
    });
    await http()
      .post('/api/v1/imports')
      .set('Authorization', auth(token))
      .send({ ...body, mergeIntoJobId: collecting.jobId })
      .expect(422);
    await importer.cancel(owner, jobId);
    await http().post('/api/v1/imports').set('Authorization', auth(token)).send(body).expect(404);
  });
});
