/**
 * 管理员 API key：结案接口用 key 鉴权（迁移 0172）。
 * 真实 HTTP + 真实 PostgreSQL：合法 key 调通 complete；作废 / 过期 / 随机串 401；
 * key 调 complete 以外的管理员接口 403（scope fail-closed）；普通用户 token 调 complete
 * 仍 403；管理员会话调 complete 仍通过（回归）。
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthResponse } from '@weiban/contracts';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import { AdminApiKeyService, IdentityCommands } from '../src/modules/identity/index.js';
import {
  DATABASE,
  SCOPE_ROLE_REQUESTS_COMPLETE,
  TestClock,
  type Database,
} from '../src/platform/index.js';
import { NestPinoLogger } from '../src/platform/logging/nest-logger.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const device = { platform: 'web', name: 'apikey-test', appVersion: '1', timeZone: 'Asia/Shanghai' };
const secret = () => randomBytes(24).toString('base64url');
const CHECKS =
  '{"revision":1,"requiredFieldsComplete":false,"personaStabilityPassed":false,"hardBoundaryCasesPassed":false,"hasFallbackGreeting":false,"checked":false}';

describeDb('管理员 API key：结案接口鉴权', () => {
  let app: INestApplication;
  let url: string;
  let db: Database;
  let commands: IdentityCommands;
  let keys: AdminApiKeyService;
  let operator: { id: string; username: string; password: string };
  let applicant: { id: string; username: string; password: string };
  let userToken: string;
  let adminToken: string;
  let keyId: string;
  let apiKey: string;
  let characterId: string;
  let requestId: string;
  let secondRequestId: string;
  let ip = 0;
  const clock = new TestClock('2026-11-10T01:00:00.000Z');
  const { logger } = captureLogger();
  const secrets = new Set<string>();

  const auth = (username: string, password: string, kind: 'admin' | 'app' = 'app') =>
    request(url)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', `10.9.1.${++ip}`)
      .send({ username, password, kind, device });

  async function account(role: 'admin' | 'user' = 'user') {
    const username = `apikey_${randomBytes(5).toString('hex')}`;
    const password = secret();
    secrets.add(password);
    const id = await commands.createAdmin(username, password);
    if (role === 'user') await commands.setRole(username, 'user');
    return { id, username, password };
  }

  function complete(id: string, bearer: string | null, character: string) {
    const req = request(url).post(`/api/v1/admin/role-requests/${id}/complete`);
    if (bearer) req.set('Authorization', `Bearer ${bearer}`);
    return req.send({ characterId: character, message: '已做好' });
  }

  beforeAll(async () => {
    await resetTestDatabase();
    const config = testConfig({ HTTP_TRUST_PROXY: 'true' });
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          clock,
          logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: new NestPinoLogger(logger) });
    configureHttpApp(app, config);
    await app.init();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    db = app.get(DATABASE);
    commands = app.get(IdentityCommands);
    keys = app.get(AdminApiKeyService);

    operator = await account('admin');
    applicant = await account('user');
    adminToken = AuthResponse.parse(
      (await auth(operator.username, operator.password, 'admin').expect(200)).body,
    ).session.token;
    userToken = AuthResponse.parse(
      (await auth(applicant.username, applicant.password).expect(200)).body,
    ).session.token;
    secrets.add(adminToken);
    secrets.add(userToken);

    // 一把合法 key（scope role-requests:complete），创建者为 operator。
    const created = await keys.create(
      'muse-closing-test',
      SCOPE_ROLE_REQUESTS_COMPLETE,
      operator.id,
    );
    keyId = created.id;
    apiKey = created.key;
    secrets.add(apiKey);

    // 一个已上架的旧卡预设角色 + 两单待处理的申请。
    characterId = randomUUID();
    await db.query(
      `INSERT INTO characters.characters
        (id, kind, status, name, search_text, basis, age_setting, child_appearance,
         child_features_detected, checks, legacy_card, created_at, updated_at)
       VALUES ($1,'preset','published','Key 测试角色','key 测试角色','fictional','adult',false,false,
         $2::jsonb, '{"display_name":"Key 测试角色"}'::jsonb, $3, $3)`,
      [characterId, CHECKS, clock.now()],
    );
    requestId = randomUUID();
    secondRequestId = randomUUID();
    for (const id of [requestId, secondRequestId]) {
      await db.query(
        `INSERT INTO plaza.role_requests (id, user_id, client_request_id, role_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Key 测试', 'pending', $4, $4)`,
        [id, applicant.id, randomUUID(), clock.now()],
      );
    }
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('合法 key 调 complete 通过（200），申请变 completed，last_used_at 被更新', async () => {
    await complete(requestId, apiKey, characterId).expect(200);
    const rows = await db.query(
      'SELECT status, character_id FROM plaza.role_requests WHERE id=$1',
      [requestId],
    );
    expect(rows.rows[0]).toMatchObject({ status: 'completed', character_id: characterId });
    const keyRows = await db.query('SELECT last_used_at FROM identity.admin_api_keys WHERE id=$1', [
      keyId,
    ]);
    expect(keyRows.rows[0]?.last_used_at).not.toBeNull();
  });

  it('已作废的 key 调 complete 返回 401', async () => {
    const created = await keys.create('revoke-test', SCOPE_ROLE_REQUESTS_COMPLETE, operator.id);
    secrets.add(created.key);
    expect(await keys.revoke(created.id)).toBe(true);
    await complete(secondRequestId, created.key, characterId).expect(401);
  });

  it('已过期的 key 调 complete 返回 401', async () => {
    const created = await keys.create('expired-test', SCOPE_ROLE_REQUESTS_COMPLETE, operator.id);
    secrets.add(created.key);
    // 过期时间设在测试时钟之前。
    await db.query('UPDATE identity.admin_api_keys SET expires_at=$2 WHERE id=$1', [
      created.id,
      new Date('2026-11-10T00:00:00.000Z'),
    ]);
    await complete(secondRequestId, created.key, characterId).expect(401);
  });

  it('随机串调 complete 返回 401', async () => {
    await complete(
      secondRequestId,
      `wbak_${randomBytes(24).toString('base64url')}`,
      characterId,
    ).expect(401);
  });

  it('合法 key 调 complete 以外的管理员接口返回 403（scope fail-closed）', async () => {
    await request(url)
      .get(`/api/v1/admin/role-requests/${secondRequestId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(403);
  });

  it('普通用户 token 调 complete 仍返回 403（回归）', async () => {
    await complete(secondRequestId, userToken, characterId).expect(403);
  });

  it('管理员会话调 complete 仍通过（回归）', async () => {
    await complete(secondRequestId, adminToken, characterId).expect(200);
    const rows = await db.query('SELECT status FROM plaza.role_requests WHERE id=$1', [
      secondRequestId,
    ]);
    expect(rows.rows[0]?.status).toBe('completed');
  });
});
