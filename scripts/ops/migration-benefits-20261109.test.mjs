import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import {
  applyMigrationBenefits,
  calculateMigrationCompensation,
  isPreservedMigrationUser,
} from './migration-benefits-20261109.mjs';

test('固定保护摘要使用user:前缀并归一化UUID大小写，不读取或连接数据库', () => {
  // 完全合成 UUID；摘要按固定策略格式预先计算，不使用真实账户。
  const policy = {
    userIdSha256: ['9bd16b62c8b81df12d4bc2920e3dafaa66a1b59d0dd91e604e508b7de1f590f0'],
  };
  assert.equal(isPreservedMigrationUser('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', policy), true);
  assert.equal(isPreservedMigrationUser('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', policy), true);
  assert.equal(isPreservedMigrationUser('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', policy), false);
  assert.throws(
    () =>
      isPreservedMigrationUser('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
        userIdSha256: [],
      }),
    /PRESERVATION_POLICY_MISSING/,
  );
});

const base = {
  legacyTier: 'pro',
  legacyExpiresAt: '2026-11-11T12:00:00.000Z',
  cutoverAt: '2026-11-09T00:00:00.000Z',
  rounding: 'proportional',
};
test('PRO与Plus按各自日积分，明确选择精确时长或进位一天，过期不补', () => {
  assert.equal(calculateMigrationCompensation(base).amountMicros, 250 * 10000);
  assert.equal(
    calculateMigrationCompensation({ ...base, legacyTier: 'plus' }).amountMicros,
    125 * 10000,
  );
  assert.equal(
    calculateMigrationCompensation({ ...base, rounding: 'ceil' }).amountMicros,
    300 * 10000,
  );
  assert.equal(
    calculateMigrationCompensation({ ...base, legacyExpiresAt: base.cutoverAt }).amountMicros,
    0,
  );
  assert.equal(
    calculateMigrationCompensation({ ...base, legacyTier: 'free', legacyExpiresAt: null })
      .amountMicros,
    0,
  );
});
test('未决天数口径、无时区或无效日期、缺失会员到期不能默默发钱', () => {
  assert.throws(
    () => calculateMigrationCompensation({ ...base, rounding: undefined }),
    /DAY_RULE_REQUIRED/,
  );
  assert.throws(
    () => calculateMigrationCompensation({ ...base, cutoverAt: '2026-11-09 00:00:00' }),
    /INVALID_CUTOVER/,
  );
  assert.throws(
    () => calculateMigrationCompensation({ ...base, legacyExpiresAt: '2026-02-30T00:00:00Z' }),
    /INVALID_EXPIRES/,
  );
  assert.throws(
    () => calculateMigrationCompensation({ ...base, legacyExpiresAt: null }),
    /EXPIRY_REQUIRED/,
  );
});

test('实际发放只接受经理确认的ceil，错误口径在任何SQL之前拒绝', async () => {
  const client = { query: () => assert.fail('错误口径不应接触数据库') };
  await assert.rejects(
    applyMigrationBenefits(client, { ...base, userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    /DAY_RULE_MUST_BE_CEIL/,
  );
});

// 只用本任务专属容器/库；不建库、不清库，合成记录全部ROLLBACK。共享weiban_test即使回滚也拒绝。
const testUrl = process.env.TEST_DATABASE_URL;
test(
  '真实账本：余额加算、保留密码/较长会员、重跑不重复、失败整笔回滚',
  { skip: !testUrl },
  async () => {
    const target = new URL(testUrl);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '56389' ||
      target.pathname !== '/weiban_test_codex_fast_1109' ||
      process.env.WEIBAN_FAST_MIGRATION_TEST !== '20261109'
    )
      throw new Error('Dedicated fast-1109 database, loopback port and task marker required');
    const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
    const { Client } = require('pg');
    const client = new Client({ connectionString: testUrl });
    await client.connect();
    const userId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO identity.users(id,username,password_hash,role,status,created_at,updated_at)
       VALUES($1,$2,'synthetic-preserved-hash','user','active',now(),now())`,
        [userId, `benefits_${userId}`],
      );
      await client.query(
        `INSERT INTO identity.memberships(user_id,pro_plus_until,updated_at) VALUES($1,'2027-01-01T00:00:00Z',now())`,
        [userId],
      );
      const accountId = randomUUID();
      await client.query(
        `INSERT INTO billing.accounts(id,kind,user_id,balance_micros,held_micros,bonus_balance_micros,
         low_balance_threshold_micros,background_daily_limit_micros,time_zone,created_at,updated_at,version)
       VALUES($1,'user',$2,500000,0,0,5000000,3000000,'Asia/Shanghai',now(),now(),1)`,
        [accountId, userId],
      );
      await client.query(
        `INSERT INTO billing.ledger_entries(id,account_id,created_at,type,amount_micros,balance_after_micros,
         idempotency_key,absorbed,safety_overdraft) VALUES($1,$2,now(),'admin_grant',500000,500000,$3,false,false)`,
        [randomUUID(), accountId, `synthetic:${userId}`],
      );
      const input = { ...base, userId, rounding: 'ceil' };
      await client.query('SAVEPOINT before_benefits');
      assert.equal((await applyMigrationBenefits(client, input)).status, 'applied');
      await client.query('ROLLBACK TO SAVEPOINT before_benefits');
      assert.equal(
        Number(
          (
            await client.query('SELECT count(*) FROM billing.ledger_entries WHERE account_id=$1', [
              accountId,
            ])
          ).rows[0].count,
        ),
        1,
      );
      const first = await applyMigrationBenefits(client, input);
      assert.equal(first.membershipExtended, false);
      assert.equal(first.compensationMicros, 3000000);
      assert.equal((await applyMigrationBenefits(client, input)).status, 'already_applied');
      const row = (
        await client.query(
          `SELECT a.balance_micros,a.bonus_balance_micros,u.password_hash,m.pro_plus_until,
         (SELECT sum(amount_micros) FROM billing.ledger_entries WHERE account_id=a.id) AS ledger_sum,
         (SELECT count(*) FROM billing.ledger_entries WHERE account_id=a.id) AS ledger_count
       FROM billing.accounts a JOIN identity.users u ON u.id=a.user_id JOIN identity.memberships m ON m.user_id=u.id
       WHERE u.id=$1`,
          [userId],
        )
      ).rows[0];
      assert.equal(Number(row.balance_micros), 4500000);
      assert.equal(Number(row.bonus_balance_micros), 4000000);
      assert.equal(Number(row.ledger_sum), Number(row.balance_micros));
      assert.equal(Number(row.ledger_count), 3);
      assert.equal(row.password_hash, 'synthetic-preserved-hash');
      assert.equal(row.pro_plus_until.toISOString(), '2027-01-01T00:00:00.000Z');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  },
);
