import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ClientRuntimeEvent, ClientLogBatch, ClientLogAdminEndpoints } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { ClientLogsService } from '../src/modules/client-logs/testing.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  DATABASE,
  USER_DATA_REGISTRY,
  newId,
  TestClock,
  type Database,
  type UserDataRegistry,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('L 客户端运行记录（真实 PostgreSQL）', () => {
  let app: INestApplication;
  let logs: ClientLogsService;
  let db: Database;
  let user: string;
  const clock = new TestClock('2026-10-22T10:00:00Z');
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
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    logs = app.get(ClientLogsService);
    db = app.get(DATABASE);
    user = await app
      .get(IdentityCommands)
      .createAdmin('diagnostics_admin', 'correct horse battery');
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });
  function batch(count = 1, version = '1.0.0', line = 1) {
    const sessionId = newId();
    const e = ClientRuntimeEvent.parse({
      clientEventId: newId(),
      sessionId,
      occurredAt: clock.now().toISOString(),
      kind: 'api_failure',
      appKind: 'web',
      version,
      build: '123',
      page: '/chat/:id',
      code: 'server_error',
      count,
      frames: [{ file: 'app.js', line, column: 1 }],
      environment: {
        os: 'android',
        browser: 'chrome',
        major: 120,
        screen: 'small',
        language: 'zh',
        network: 'wifi',
      },
      api: {
        route: '/api/v1/conversations/:id/messages',
        method: 'POST',
        status: 500,
        durationMs: 10,
      },
    });
    return ClientLogBatch.parse({ sessionId, appKind: 'web', version, build: '123', events: [e] });
  }

  it('并发重放只增加累计差值，保留 API 版本路径并通过完整后台响应契约', async () => {
    const body = batch();
    await Promise.all([
      logs.report(user, '', body),
      logs.report(user, '', body),
      logs.report(user, '', body),
    ]);
    body.events[0]!.count = 3;
    await logs.report(user, '', body);
    const page = ClientLogAdminEndpoints.list.response.parse(await logs.list({ limit: 1 }));
    expect(page.items[0]?.totalCount).toBe(3);
    expect(page.items[0]?.affectedUsers).toBe(1);
    const detail = ClientLogAdminEndpoints.get.response.parse(
      await logs.detail(page.items[0]!.fingerprint),
    );
    expect(detail.samples).toHaveLength(1);
    expect(detail.samples[0]?.event.api?.route).toBe('/api/v1/conversations/:id/messages');
    expect(detail.samples[0]?.event.count).toBe(3);
  });

  it('同时间分页稳定且不重复，新版本重开已解决问题，旧离线版本不倒退版本号', async () => {
    await logs.report(user, '', batch(1, '1.0.0', 2));
    const first = await logs.list({ limit: 1 });
    expect(first.nextCursor).toBeTruthy();
    const next = await logs.list({ limit: 1, cursor: first.nextCursor });
    expect(next.items[0]!.fingerprint).not.toBe(first.items[0]!.fingerprint);
    const fp = first.items[0]!.fingerprint;
    await logs.update(user, fp, { status: 'resolved', note: 'fixed' });
    const detail = await logs.detail(fp);
    const line = detail.samples[0]!.event.frames[0]!.line;
    await logs.report(user, '', batch(1, '2.0.0', line));
    expect((await logs.detail(fp)).issue).toMatchObject({ status: 'open', lastVersion: '2.0.0' });
    await logs.report(user, '', batch(1, '1.0.0', line));
    expect((await logs.detail(fp)).issue.lastVersion).toBe('2.0.0');
  });

  it('本人限额含新会话计数，超限静默丢弃；反馈快照受账户删除登记清理', async () => {
    const limitedUser = await app
      .get(IdentityCommands)
      .createAdmin('diagnostics_limit', 'correct horse battery');
    const body = batch(299, '3.0.0', 3);
    expect(await logs.report(limitedUser, '', body)).toEqual({ accepted: true });
    expect(await logs.report(limitedUser, '', batch(1, '3.0.0', 4))).toEqual({ accepted: true });
    expect((await logs.user(limitedUser)).items).toHaveLength(1);
    const ticket = newId();
    await db.transaction((tx) => logs.attach(tx, limitedUser, ticket, body.events));
    expect((await logs.ticket(ticket)).items).toHaveLength(1);
    const owner = app
      .get<UserDataRegistry>(USER_DATA_REGISTRY)
      .list()
      .find((x) => x.module === 'client_logs')!;
    expect(await owner.countUserData(limitedUser)).toBeGreaterThan(0);
    await owner.purgeUser(limitedUser);
    expect(await owner.countUserData(limitedUser)).toBe(0);
    expect((await logs.ticket(ticket)).items).toEqual([]);
  });
});
