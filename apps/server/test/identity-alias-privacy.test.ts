/** Q028：改名审计不复制账号名；历史/已匿名化/迟到记录都能清理并核验。 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands, hashUserId } from '../src/modules/identity/index.js';
import { AccountService, SettingsService } from '../src/modules/identity/testing.js';
import {
  AUDIT_LOG,
  DATABASE,
  TestClock,
  newId,
  type AuditLog,
  type Database,
} from '../src/platform/index.js';
import { Migrator } from '../src/platform/db/migrator.js';
import {
  describeDb,
  resetTestDatabase,
  requireTestDatabaseUrl,
  MIGRATIONS_DIR,
} from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('账号改名审计隐私清理', () => {
  let app: INestApplication;
  let db: Database;
  let audit: AuditLog;
  let commands: IdentityCommands;
  const clock = new TestClock('2026-11-04T09:00:00Z');

  beforeAll(async () => {
    await resetTestDatabase();
    const fixture = await Test.createTestingModule({
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
    app = fixture.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
    audit = app.get(AUDIT_LOG);
    commands = app.get(IdentityCommands);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  async function insertLegacy(
    userId: string,
    mode: 'raw' | 'target-hash' | 'actor-hash',
    module = 'identity',
    action = 'alias.updated',
  ) {
    const id = newId(),
      hash = hashUserId(userId);
    await db.query(
      `INSERT INTO platform.audit_log(id,occurred_at,module,action,actor_type,actor_id,target_type,target_id,details)
      VALUES($1,$2,$3,$4,'user',$5,$6,$7,$8)`,
      [
        id,
        clock.now(),
        module,
        action,
        mode === 'raw' ? userId : null,
        mode === 'raw' ? 'user' : 'user_hash',
        mode === 'actor-hash' ? null : mode === 'raw' ? userId : hash,
        JSON.stringify({
          previous: 'synthetic_before',
          username: 'synthetic_after',
          preserved: 'audit-context',
          ...(mode === 'raw' ? {} : { actorHash: hash }),
        }),
      ],
    );
    return id;
  }
  async function details(id: string) {
    return (
      await db.query<{ details: Record<string, unknown> }>(
        'SELECT details FROM platform.audit_log WHERE id=$1',
        [id],
      )
    ).rows[0]!.details;
  }

  it('新改名只记字段名；原名、中间历史名和当前名仍可登录', async () => {
    const password = randomBytes(24).toString('hex');
    const id = await commands.createAdmin('privacy_original', password);
    const settings = app.get(SettingsService);
    await settings.updateAlias(id, 'privacy_middle');
    clock.advance(8 * 86_400_000);
    await settings.updateAlias(id, 'privacy_current');
    const rows = await db.query<{ details: Record<string, unknown> }>(
      "SELECT details FROM platform.audit_log WHERE action='alias.updated' AND target_id=$1",
      [id],
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) expect(row.details).toEqual({ changedFields: ['username'] });
    for (const username of ['privacy_original', 'PRIVACY_MIDDLE', 'privacy_current']) {
      const result = await app.get(AccountService).login(
        {
          username,
          password,
          kind: 'app',
          device: {
            platform: 'web',
            name: 'privacy test',
            appVersion: 'test',
            timeZone: 'Asia/Shanghai',
          },
        },
        '192.0.2.50',
      );
      expect(result.user.userId).toBe(id);
    }
  });

  it.each(['raw', 'target-hash', 'actor-hash'] as const)(
    '清理%s历史记录且保持事件与其他细节，重复清理无副作用',
    async (mode) => {
      const userId = newId(),
        hash = hashUserId(userId);
      const id = await insertLegacy(userId, mode);
      expect(await audit.countPlainUser(userId, hash)).toBe(1);
      expect(await audit.anonymizeUser(userId, hash)).toBe(1);
      expect(await details(id)).toEqual({ preserved: 'audit-context', actorHash: hash });
      expect(await audit.countPlainUser(userId, hash)).toBe(0);
      expect(await audit.anonymizeUser(userId, hash)).toBe(0);
    },
  );

  it('核验会拦住已去掉用户编号却仍含账号名的审计，清扫后才通过', async () => {
    const id = newId();
    await insertLegacy(id, 'actor-hash');
    const before = await commands.verifyPurgedReport(id);
    expect(before.ok).toBe(false);
    expect(before.checks.find((c) => c.name.startsWith('platform:audit_log'))?.count).toBe(1);
    await audit.anonymizeUser(id, hashUserId(id));
    expect((await commands.verifyPurgedReport(id)).ok).toBe(true);
  });

  it('迁移覆盖全部旧改名审计，不误删其他动作/模块；回退不恢复隐私明文', async () => {
    const migrator = new Migrator(requireTestDatabaseUrl(), MIGRATIONS_DIR);
    expect(await migrator.down(1)).toEqual(['0159_anonymize_alias_audits']);
    const aliases = await Promise.all(
      ['raw', 'target-hash', 'actor-hash'].map((mode) =>
        insertLegacy(newId(), mode as 'raw' | 'target-hash' | 'actor-hash'),
      ),
    );
    const otherAction = await insertLegacy(newId(), 'raw', 'identity', 'unrelated.updated');
    const otherModule = await insertLegacy(newId(), 'raw', 'characters', 'alias.updated');
    const unchanged = await Promise.all([details(otherAction), details(otherModule)]);
    expect(await migrator.up()).toEqual(['0159_anonymize_alias_audits']);
    for (const id of aliases) {
      const row = await details(id);
      expect(row).not.toHaveProperty('previous');
      expect(row).not.toHaveProperty('username');
      expect(row.preserved).toBe('audit-context');
    }
    expect(await Promise.all([details(otherAction), details(otherModule)])).toEqual(unchanged);
    await migrator.down(1);
    for (const id of aliases) expect(await details(id)).not.toHaveProperty('username');
    expect(await migrator.up()).toEqual(['0159_anonymize_alias_audits']);
  });
});
