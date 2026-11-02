import { describe, expect, it, vi } from 'vitest';
import type {
  BillingCustomerConfigReadPort,
  BillingReadPort,
  ContactsReadPort,
  IdentityAccountStatusPort,
  IdentityMembershipReadPort,
} from '@weiban/contracts';
import { BriefService } from './brief.js';
import { BILLING_CUSTOMER_CONFIG_PORT, BILLING_READ_PORT } from '../../billing/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import {
  IDENTITY_ACCOUNT_STATUS_PORT,
  IDENTITY_MEMBERSHIP_READ_PORT,
} from '../../identity/index.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function buildBrief(
  opts: {
    membership?: unknown;
    spend?: unknown;
    contacts?: unknown;
    accountStatus?: unknown;
    banned?: unknown;
    settings?: unknown;
    recharge?: unknown;
  } = {},
) {
  const membership = {
    getMembership: vi.fn(
      async () => opts.membership ?? { tier: 'pro_plus', expiresAt: '2027-01-01T00:00:00.000Z' },
    ),
    isProPlus: vi.fn(async () => true),
  };
  const billing = {
    getSpendStatus: vi.fn(
      async () =>
        opts.spend ?? {
          availableMicros: 12_340_000,
          depleted: false,
          insufficient: false,
          backgroundRemainingTodayMicros: 0,
        },
    ),
  };
  const contacts = { listActiveContacts: vi.fn(async () => opts.contacts ?? [{}, {}, {}]) };
  const accounts = {
    getAccountStatus: vi.fn(async () => opts.accountStatus ?? 'active'),
    isBanned: vi.fn(async () => opts.banned ?? false),
  };
  const customerConfig = {
    getMembershipSettings: vi.fn(
      async () =>
        opts.settings ?? {
          plans: [
            {
              planId: 'month',
              name: '月卡',
              months: 1,
              priceFen: 2000,
              firstPriceFen: 1290,
              bonusPoints: 2000,
            },
            {
              planId: 'quarter',
              name: '季卡',
              months: 3,
              priceFen: 5800,
              firstPriceFen: 3990,
              bonusPoints: 6000,
            },
            {
              planId: 'year',
              name: '年卡',
              months: 12,
              priceFen: 19800,
              firstPriceFen: 15990,
              bonusPoints: 24000,
            },
          ],
          contactHint: '联系管理员开通',
          signupBonusPoints: 100,
        },
    ),
    getRechargeOptions: vi.fn(
      async () =>
        opts.recharge ?? {
          paymentEnabled: false,
          pointsPerYuan: 100,
          contactHint: '联系管理员充值',
          tiers: [
            {
              tierId: 't10',
              priceMicros: 10_000_000,
              points: 1000,
              bonusPercent: 0,
              bonusPoints: 0,
            },
            {
              tierId: 't30',
              priceMicros: 30_000_000,
              points: 3000,
              bonusPercent: 0,
              bonusPoints: 0,
            },
            {
              tierId: 't100',
              priceMicros: 100_000_000,
              points: 10000,
              bonusPercent: 0,
              bonusPoints: 0,
            },
          ],
        },
    ),
  };
  // 令牌只用于标注依赖来源，构造时直接传实例（与 Nest 注入等价）。
  void BILLING_CUSTOMER_CONFIG_PORT;
  void BILLING_READ_PORT;
  void CONTACTS_READ_PORT;
  void IDENTITY_ACCOUNT_STATUS_PORT;
  void IDENTITY_MEMBERSHIP_READ_PORT;
  const service = new BriefService(
    membership as unknown as IdentityMembershipReadPort,
    billing as unknown as BillingReadPort,
    contacts as unknown as ContactsReadPort,
    accounts as unknown as IdentityAccountStatusPort,
    customerConfig as unknown as BillingCustomerConfigReadPort,
  );
  return service;
}

describe('用户状态简报', () => {
  it('组装全部事实：档位、余额、联系人数、价格配置', async () => {
    const brief = await buildBrief().assemble(USER_ID);
    expect(brief.facts.membershipTier).toBe('PRO+');
    expect(brief.facts.membershipExpiresAt).toBe('2027-01-01T00:00:00.000Z');
    expect(brief.facts.pointsBalance).toBe('1234');
    expect(brief.facts.contactCount).toBe('3');
    expect(brief.facts.contactLimit).toBe('50');
    expect(brief.facts.membershipPlans).toContain('月卡 20 元');
    expect(brief.facts.membershipPlans).toContain('首次 12.9 元');
    expect(brief.facts.rechargeTiers).toContain('10 元、30 元、100 元');
    expect(brief.facts.signupBonus).toBe('100');
    expect(brief.promptLines.join('\n')).toContain('积分余额：1234 分');
    expect(brief.promptLines.join('\n')).toContain('账号状态：正常');
  });

  it('免费档位与无到期日', async () => {
    const brief = await buildBrief({
      membership: { tier: 'free', expiresAt: null },
    }).assemble(USER_ID);
    expect(brief.facts.membershipTier).toBe('免费');
    expect(brief.facts.membershipExpiresAt).toBeNull();
  });

  it('单项读取失败只让该项变未知，不拖垮简报', async () => {
    // 让余额读取抛错：其余事实照常。
    const failing = {
      getSpendStatus: vi.fn(async () => {
        throw new Error('billing down');
      }),
    };
    const broken = new BriefService(
      {
        getMembership: vi.fn(async () => ({ tier: 'free', expiresAt: null })),
        isProPlus: vi.fn(async () => false),
      } as unknown as IdentityMembershipReadPort,
      failing as unknown as BillingReadPort,
      { listActiveContacts: vi.fn(async () => []) } as unknown as ContactsReadPort,
      { getAccountStatus: vi.fn(async () => 'active') } as unknown as IdentityAccountStatusPort,
      {
        getMembershipSettings: vi.fn(async () => ({
          plans: [
            {
              planId: 'month',
              name: '月卡',
              months: 1,
              priceFen: 2000,
              firstPriceFen: 1290,
              bonusPoints: 2000,
            },
            {
              planId: 'quarter',
              name: '季卡',
              months: 3,
              priceFen: 5800,
              firstPriceFen: 3990,
              bonusPoints: 6000,
            },
            {
              planId: 'year',
              name: '年卡',
              months: 12,
              priceFen: 19800,
              firstPriceFen: 15990,
              bonusPoints: 24000,
            },
          ],
          contactHint: '',
          signupBonusPoints: 100,
        })),
        getRechargeOptions: vi.fn(async () => ({
          paymentEnabled: false,
          pointsPerYuan: 100,
          contactHint: '',
          tiers: [],
        })),
      } as unknown as BillingCustomerConfigReadPort,
    );
    const brief = await broken.assemble(USER_ID);
    expect(brief.facts.pointsBalance).toBeNull();
    expect(brief.facts.contactCount).toBe('0');
    expect(brief.facts.membershipTier).toBe('免费');
  });
});
