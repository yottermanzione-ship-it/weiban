/**
 * HTTP 层：健康检查、统一错误格式、鉴权守卫、契约校验管道，以及「金丝雀密钥走完流程后日志里搜不到」。
 */
import 'reflect-metadata';
import { Body, Controller, Get, Inject, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiError } from '@weiban/contracts';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import {
  AppError,
  ContractPipe,
  CurrentPrincipal,
  LOGGER,
  RequireAuth,
  SESSION_VERIFIER,
  TestClock,
  type AuthPrincipal,
  type Logger,
  type SessionVerifier,
} from '../src/platform/index.js';
import { NestPinoLogger } from '../src/platform/logging/nest-logger.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { canaryKey, captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const CANARY = canaryKey();
const GOOD_TOKEN = 'good-session-token';
const ADMIN_TOKEN = 'admin-session-token';
const USER_ID = '0199f0a0-0000-7000-8000-000000000001';

class FakeSessionVerifier implements SessionVerifier {
  async verify(token: string): Promise<AuthPrincipal | null> {
    if (token === GOOD_TOKEN) {
      return { userId: USER_ID, sessionId: 's1', role: 'user', adminSession: false };
    }
    if (token === ADMIN_TOKEN) {
      return { userId: USER_ID, sessionId: 's2', role: 'admin', adminSession: true };
    }
    return null;
  }
}

const EchoBody = z.object({ name: z.string().min(1), count: z.number().int() });

@Controller('api/v1/kernel-test')
class ProbeController {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  @Get('public')
  @RequireAuth('none')
  publicRoute() {
    return { ok: true };
  }

  @Get('me')
  me(@CurrentPrincipal() principal: AuthPrincipal) {
    return { userId: principal.userId };
  }

  @Get('admin')
  @RequireAuth('admin')
  admin() {
    return { ok: true };
  }

  @Post('echo')
  @RequireAuth('none')
  echo(@Body(new ContractPipe(EchoBody)) body: z.infer<typeof EchoBody>) {
    return body;
  }

  @Get('business-error')
  @RequireAuth('none')
  businessError() {
    throw new AppError('contact_limit_reached', '通讯录已满');
  }

  /** 故意在各种地方带上金丝雀密钥：字段、消息文本、异常信息。 */
  @Post('leaky')
  @RequireAuth('user')
  leaky(@Body() body: Record<string, unknown>) {
    this.logger.info({ apiKey: body.apiKey, upstream: { secret: body.apiKey } }, '登记上游');
    this.logger.warn(`上游返回错误：invalid key ${String(body.apiKey)}`);
    this.logger.info({ note: `header was Bearer ${String(body.apiKey)}` }, 'debug');
    throw new Error(`upstream rejected ${String(body.apiKey)}`);
  }
}

describeDb('HTTP 平台内核（真实 PostgreSQL）', () => {
  let app: INestApplication;
  const { logger, capture } = captureLogger();
  const responses: string[] = [];

  beforeAll(async () => {
    await resetTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          clock: new TestClock('2026-10-05T08:00:00.000Z'),
          logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
      controllers: [ProbeController],
    })
      // AppModule 里 identity 已提供真实的 SESSION_VERIFIER；这里换成假的，只测平台守卫本身
      .overrideProvider(SESSION_VERIFIER)
      .useClass(FakeSessionVerifier)
      .compile();
    app = moduleRef.createNestApplication({ logger: new NestPinoLogger(logger) });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  function http() {
    return request(app.getHttpServer());
  }

  it('GET /health：数据库正常时 200，报告数据库连接状态', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      role: 'all',
      time: '2026-10-05T08:00:00.000Z',
      checks: { database: { ok: true }, crypto: { configured: true } },
    });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('不需要登录的接口直接访问；没标注的接口默认要求登录', async () => {
    await http().get('/api/v1/kernel-test/public').expect(200);
    const res = await http().get('/api/v1/kernel-test/me').expect(401);
    expect(ApiError.parse(res.body).error.code).toBe('unauthenticated');
  });

  it('有效令牌通过，无效令牌 401，普通用户访问管理接口 403', async () => {
    const ok = await http()
      .get('/api/v1/kernel-test/me')
      .set('Authorization', `Bearer ${GOOD_TOKEN}`)
      .expect(200);
    expect(ok.body).toEqual({ userId: USER_ID });
    await http().get('/api/v1/kernel-test/me').set('Authorization', 'Bearer nope').expect(401);
    const forbidden = await http()
      .get('/api/v1/kernel-test/admin')
      .set('Authorization', `Bearer ${GOOD_TOKEN}`)
      .expect(403);
    expect(forbidden.body.error.code).toBe('forbidden');
    await http()
      .get('/api/v1/kernel-test/admin')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);
  });

  it('业务错误按契约格式返回，requestId 与响应头一致', async () => {
    const res = await http()
      .get('/api/v1/kernel-test/business-error')
      .set('X-Request-Id', 'req-abcdef12')
      .expect(422);
    const body = ApiError.parse(res.body);
    expect(body.error).toEqual({
      code: 'contact_limit_reached',
      message: '通讯录已满',
      requestId: 'req-abcdef12',
    });
  });

  it('契约校验失败返回 400，只列字段路径，不回显字段值', async () => {
    const res = await http()
      .post('/api/v1/kernel-test/echo')
      .send({ name: '', count: CANARY })
      .expect(400);
    responses.push(JSON.stringify(res.body));
    const body = ApiError.parse(res.body);
    expect(body.error.code).toBe('bad_request');
    const issues = (body.error.details?.issues ?? []) as Array<{ path: string }>;
    expect(issues.map((i) => i.path).sort()).toEqual(['count', 'name']);
    await http().post('/api/v1/kernel-test/echo').send({ name: 'a', count: 1 }).expect(201);
  });

  it('路由不存在和请求体不是合法 JSON 也是统一错误格式', async () => {
    const missing = await http().get('/api/v1/no-such-route').expect(404);
    expect(ApiError.parse(missing.body).error.code).toBe('not_found');
    const badJson = await http()
      .post('/api/v1/kernel-test/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(400);
    expect(ApiError.parse(badJson.body).error.code).toBe('bad_request');
  });

  it('日志脱敏：金丝雀密钥走完「登记 → 报错 → 500」流程后，日志与响应里都搜不到', async () => {
    const res = await http()
      .post('/api/v1/kernel-test/leaky')
      .set('Authorization', `Bearer ${GOOD_TOKEN}`)
      .send({ apiKey: CANARY })
      .expect(500);
    responses.push(JSON.stringify(res.body));
    expect(res.body.error).toMatchObject({ code: 'internal_error', message: '服务器内部错误' });

    // 带着金丝雀令牌访问（令牌无效）
    await http().get('/api/v1/kernel-test/me').set('Authorization', `Bearer ${CANARY}`).expect(401);

    const logText = capture.text;
    expect(logText).toContain('登记上游'); // 确认日志确实写了
    expect(logText).toContain('upstream rejected'); // 500 的异常被记录了
    expect(logText).toContain(USER_ID); // 日志带上了 userId
    expect(logText.includes(CANARY)).toBe(false);
    expect(logText.includes(GOOD_TOKEN)).toBe(false);
    for (const body of responses) expect(body.includes(CANARY)).toBe(false);
    // 每条日志都是一行 JSON，带 requestId
    const httpLines = capture.records().filter((r) => r.msg === '登记上游');
    expect(httpLines[0]?.requestId).toBeTruthy();
  });
});
