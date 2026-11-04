/** 隔离数据库回归辅助：复用首轮验收的真实服务装配；只使用随机合成凭据，不输出令牌。 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { InjectionToken } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApp } from '../../src/main.js';
import { AccountService } from '../../src/modules/identity/testing.js';
import { IdentityCommands } from '../../src/modules/identity/index.js';
import {
  DATABASE,
  JOB_QUEUE,
  TestClock,
  type Database,
  type JobQueue,
} from '../../src/platform/index.js';
import { resetTestDatabase } from './db.js';
import { captureLogger, testConfig, testKekRing } from './fixtures.js';

export async function makeIsolatedApp(
  overrides: Array<{ token: InjectionToken; value: unknown }> = [],
) {
  await resetTestDatabase();
  const clock = new TestClock('2026-11-04T08:00:00Z'),
    config = testConfig();
  let builder = Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        config,
        clock,
        logger: captureLogger().logger,
        kekRing: testKekRing().ring,
        background: false,
      }),
    ],
  });
  for (const item of overrides) builder = builder.overrideProvider(item.token).useValue(item.value);
  const fixture = await builder.compile(),
    app = fixture.createNestApplication({ logger: false });
  configureHttpApp(app, config);
  await app.init();
  await app.get<JobQueue>(JOB_QUEUE).start();
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(),
    db = app.get<Database>(DATABASE);
  const user = async (name: string) => {
    const password = randomBytes(24).toString('hex');
    const commands = app.get(IdentityCommands),
      id = await commands.createAdmin(name, password);
    await commands.setRole(name, 'user');
    const auth = await app.get(AccountService).login(
      {
        username: name,
        password,
        kind: 'app',
        device: {
          platform: 'web',
          name: 'QA synthetic',
          appVersion: 'qa',
          timeZone: 'Asia/Shanghai',
        },
      },
      '192.0.2.20',
    );
    return { id, token: auth.session.token };
  };
  const http = async (token: string, path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    return { status: response.status, data: raw ? JSON.parse(raw) : null };
  };
  return { app, db, clock, user, http, close: () => app.close() };
}
