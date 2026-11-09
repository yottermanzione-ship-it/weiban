/**
 * 2026-11-09 一次性迁移权益。只导出函数，不连接数据库、不自动执行。
 * 调用方必须对同一个 pg Client 先 BEGIN；本函数完成后 COMMIT，异常时 ROLLBACK。
 * 不接收密码/聊天；旧日期由导出器规范为带时区 ISO。rounding 必须明确传入，无默认钱规则。
 */
import { createHash, randomUUID } from 'node:crypto';
import preservationPolicy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };

export const MIGRATION_BENEFITS_CAMPAIGN = 'migration-20261109';
const DAY_MS = 86_400_000;
const MICROS_PER_POINT = 10_000;
const CONFIG_KEY = 'migration_benefits_20261109';

/** 固定保留策略统一使用带 user: 域前缀的小写 UUID 摘要。 */
export function isPreservedMigrationUser(userId, policy) {
  if (!Array.isArray(policy.userIdSha256) || !policy.userIdSha256.length)
    throw new Error('MIGRATION_PRESERVATION_POLICY_MISSING');
  const digest = createHash('sha256').update(`user:${userId.toLowerCase()}`).digest('hex');
  return policy.userIdSha256.includes(digest);
}

function isoDate(value, field) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    throw new Error(`MIGRATION_INVALID_${field}`);
  return new Date(value);
}

/** 只计算，不发放；proportional 在账本最小精度（万分之一积分）向下截断。 */
export function calculateMigrationCompensation({
  legacyTier,
  legacyExpiresAt,
  cutoverAt,
  rounding,
}) {
  if (!['ceil', 'proportional'].includes(rounding)) throw new Error('MIGRATION_DAY_RULE_REQUIRED');
  if (![null, 'free', 'pro', 'plus'].includes(legacyTier))
    throw new Error('MIGRATION_LEGACY_TIER_INVALID');
  const cutover = isoDate(cutoverAt, 'CUTOVER_AT');
  const expiresAt = legacyExpiresAt === null ? null : isoDate(legacyExpiresAt, 'EXPIRES_AT');
  const dailyPoints = legacyTier === 'pro' ? 100 : legacyTier === 'plus' ? 50 : 0;
  if (dailyPoints && !expiresAt) throw new Error('MIGRATION_MEMBER_EXPIRY_REQUIRED');
  const remainingMs = dailyPoints && expiresAt ? Math.max(0, expiresAt - cutover) : 0;
  const amount =
    rounding === 'ceil'
      ? BigInt(Math.ceil(remainingMs / DAY_MS)) * BigInt(dailyPoints * MICROS_PER_POINT)
      : (BigInt(remainingMs) * BigInt(dailyPoints * MICROS_PER_POINT)) / BigInt(DAY_MS);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MIGRATION_AMOUNT_TOO_LARGE');
  return {
    cutoverAt: cutover.toISOString(),
    expiresAt: remainingMs > 0 ? expiresAt.toISOString() : null,
    remainingMs,
    dailyPoints,
    amountMicros: Number(amount),
  };
}

async function event(client, type, producer, payload, at) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO platform.outbox
      (id,event_type,producer,event,occurred_at,created_at,next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$5,$5)`,
    [
      id,
      type,
      producer,
      JSON.stringify({ eventId: id, type, version: 1, producer, occurredAt: at, payload }),
      at,
    ],
  );
}

/** 同 Ledger.postEntry 的赠送分账/事件规则；账户已锁，流水只新增。 */
async function grant(client, account, { amountMicros, idempotencyKey, purpose, reason }, at) {
  if (amountMicros <= 0) return account;
  const previous = await client.query(
    'SELECT account_id,amount_micros FROM billing.ledger_entries WHERE idempotency_key=$1',
    [idempotencyKey],
  );
  if (previous.rows.length) {
    if (
      previous.rows[0].account_id !== account.id ||
      Number(previous.rows[0].amount_micros) !== amountMicros
    )
      throw new Error('MIGRATION_LEDGER_REPLAY_MISMATCH');
    return account;
  }
  const before = Number(account.balance_micros);
  const balance = before + amountMicros;
  if (!Number.isSafeInteger(balance)) throw new Error('MIGRATION_BALANCE_TOO_LARGE');
  const bonusBefore = Number(account.bonus_balance_micros);
  const bonus = Math.max(0, Math.min(bonusBefore + amountMicros, balance));
  const available = balance - Number(account.held_micros);
  const trigger =
    available > 0
      ? before - Number(account.held_micros) <= 0
        ? 'crossed_zero'
        : account.insufficient_since
          ? 'topped_up_after_rejection'
          : null
      : null;
  await client.query(
    `INSERT INTO billing.ledger_entries
      (id,account_id,created_at,type,amount_micros,balance_after_micros,idempotency_key,
       purpose,absorbed,safety_overdraft,reason,bonus_delta_micros)
     VALUES ($1,$2,$3,'admin_grant',$4,$5,$6,$7,false,false,$8,$9)`,
    [
      randomUUID(),
      account.id,
      at,
      amountMicros,
      balance,
      idempotencyKey,
      purpose,
      reason,
      bonus - bonusBefore,
    ],
  );
  const { rows } = await client.query(
    `UPDATE billing.accounts SET balance_micros=$2,bonus_balance_micros=$3,
       insufficient_since=CASE WHEN $4 THEN NULL ELSE insufficient_since END,
       ecology_insufficient_since=NULL,ecology_notice_pending=false,updated_at=$5,version=version+1
     WHERE id=$1 RETURNING *`,
    [account.id, balance, bonus, !!trigger, at],
  );
  await event(
    client,
    'billing.balance_changed',
    'billing',
    {
      userId: account.user_id,
      balanceMicros: balance,
      availableMicros: available,
      entryType: 'admin_grant',
    },
    at,
  );
  if (trigger)
    await event(
      client,
      'billing.balance_restored',
      'billing',
      {
        userId: account.user_id,
        availableMicros: available,
        trigger,
      },
      at,
    );
  return rows[0];
}

/**
 * input: {userId, legacyTier:'free'|'pro'|'plus'|null, legacyExpiresAt:string|null,
 *         cutoverAt:string, rounding:'ceil'}.
 * 所有本轮用户调用一次；已完成者用欢迎流水作为事务完成标记，不重复赠送/恢复后来取消的会员。
 */
export async function applyMigrationBenefits(client, input) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId))
    throw new Error('MIGRATION_USER_ID_INVALID');
  const userId = input.userId.toLowerCase();
  const policy = preservationPolicy;
  if (isPreservedMigrationUser(userId, policy))
    return {
      status: 'excluded',
      membershipExtended: false,
      compensationMicros: 0,
      welcomeMicros: 0,
    };
  // 总经理 2026-11-09 最终确认：不足一天按一天；比较计算函数不决定实际发放口径。
  if (input.rounding !== 'ceil') throw new Error('MIGRATION_DAY_RULE_MUST_BE_CEIL');
  const compensation = calculateMigrationCompensation(input);
  // SAVEPOINT 在没有 BEGIN 的客户端上会直接失败，防止误用自动提交产生半笔权益。
  await client.query('SAVEPOINT migration_benefits_20261109');
  const config = {
    campaign: MIGRATION_BENEFITS_CAMPAIGN,
    cutoverAt: compensation.cutoverAt,
    rounding: input.rounding,
  };
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO billing.settings(key,value,updated_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
    [CONFIG_KEY, JSON.stringify(config), now],
  );
  const setting = (
    await client.query('SELECT value FROM billing.settings WHERE key=$1', [CONFIG_KEY])
  ).rows[0]?.value;
  if (
    setting?.campaign !== config.campaign ||
    setting?.cutoverAt !== config.cutoverAt ||
    setting?.rounding !== config.rounding
  )
    throw new Error('MIGRATION_CAMPAIGN_CHANGED');
  // 与后台/扫码会员相同：会员咨询锁 → 用户行 → 会员行 → 钱包行。
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('billing:membership-order:' || $1,0))",
    [userId],
  );
  const user = (
    await client.query('SELECT status FROM identity.users WHERE id=$1 FOR UPDATE', [userId])
  ).rows[0];
  if (!user || user.status !== 'active') {
    await client.query('RELEASE SAVEPOINT migration_benefits_20261109');
    return {
      status: 'inactive',
      membershipExtended: false,
      compensationMicros: 0,
      welcomeMicros: 0,
    };
  }
  const welcomeKey = `${MIGRATION_BENEFITS_CAMPAIGN}:welcome:${userId}`;
  if (
    (
      await client.query('SELECT 1 FROM billing.ledger_entries WHERE idempotency_key=$1', [
        welcomeKey,
      ])
    ).rows.length
  ) {
    await client.query('RELEASE SAVEPOINT migration_benefits_20261109');
    return {
      status: 'already_applied',
      membershipExtended: false,
      compensationMicros: 0,
      welcomeMicros: 0,
    };
  }
  let membershipExtended = false;
  if (compensation.expiresAt) {
    const old = (
      await client.query(
        'SELECT pro_plus_until FROM identity.memberships WHERE user_id=$1 FOR UPDATE',
        [userId],
      )
    ).rows[0];
    if (!old?.pro_plus_until || new Date(old.pro_plus_until) < new Date(compensation.expiresAt)) {
      await client.query(
        `INSERT INTO identity.memberships(user_id,pro_plus_until,updated_at) VALUES($1,$2,$3)
         ON CONFLICT(user_id) DO UPDATE SET pro_plus_until=GREATEST(identity.memberships.pro_plus_until,EXCLUDED.pro_plus_until),updated_at=EXCLUDED.updated_at`,
        [userId, compensation.expiresAt, now],
      );
      await client.query(
        `INSERT INTO identity.membership_changes(id,user_id,previous_until,new_until,reason,created_at)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          userId,
          old?.pro_plus_until ?? null,
          compensation.expiresAt,
          '旧会员迁移为 PRO+，保留剩余期限',
          now,
        ],
      );
      await event(
        client,
        'identity.profile_updated',
        'identity',
        { userId, changedFields: ['membership'] },
        now,
      );
      membershipExtended = true;
    }
  }
  await client.query(
    `INSERT INTO billing.accounts(id,kind,user_id,balance_micros,held_micros,bonus_balance_micros,
       low_balance_threshold_micros,background_daily_limit_micros,time_zone,created_at,updated_at,version)
     VALUES($1,'user',$2,0,0,0,5000000,3000000,'Asia/Shanghai',$3,$3,1) ON CONFLICT DO NOTHING`,
    [randomUUID(), userId, now],
  );
  let account = (
    await client.query(
      "SELECT * FROM billing.accounts WHERE user_id=$1 AND kind='user' FOR UPDATE",
      [userId],
    )
  ).rows[0];
  if (!account) throw new Error('MIGRATION_ACCOUNT_MISSING');
  account = await grant(
    client,
    account,
    {
      amountMicros: compensation.amountMicros,
      idempotencyKey: `${MIGRATION_BENEFITS_CAMPAIGN}:member:${userId}`,
      purpose: 'migration_member_compensation',
      reason: `旧${input.legacyTier === 'pro' ? 'PRO' : 'Plus'}会员剩余期限迁移补偿`,
    },
    now,
  );
  await grant(
    client,
    account,
    {
      amountMicros: 100 * MICROS_PER_POINT,
      idempotencyKey: welcomeKey,
      purpose: 'migration_welcome_bonus',
      reason: '本次迁移赠送100积分（每人一次）',
    },
    now,
  );
  await client.query(
    `INSERT INTO platform.audit_log(id,occurred_at,module,action,actor_type,target_type,target_id,details)
     VALUES($1,$2,'billing','migration.benefits_granted','system','user',$3,$4)`,
    [
      randomUUID(),
      now,
      userId,
      JSON.stringify({
        ...config,
        legacyTier: input.legacyTier,
        legacyExpiresAt: input.legacyExpiresAt,
        remainingMs: compensation.remainingMs,
        compensationMicros: compensation.amountMicros,
        welcomeMicros: 100 * MICROS_PER_POINT,
        membershipExtended,
      }),
    ],
  );
  await client.query('RELEASE SAVEPOINT migration_benefits_20261109');
  return {
    status: 'applied',
    membershipExtended,
    compensationMicros: compensation.amountMicros,
    welcomeMicros: 100 * MICROS_PER_POINT,
  };
}
