/**
 * 只读用户状态简报（Q3 清单：基础 + 扩围 5 项，只读不操作）。
 *
 * 能实时读到的（有端口）：会员档位与到期日、积分余额、联系人上限与当前数、账号状态。
 * 读不到的（无端口，不得编）：积分变动明细（只报余额、指到积分明细页）、活动/邀请进度
 * （问到时按未知口径）。每项读取独立 try/catch：单项失败只让该项变“未知”，不拖垮整条回复。
 *
 * 数值来源：会员/充值配置一律读数据库现行配置（BillingCustomerConfigReadPort，
 * 与后台同一来源）；模型价格绝不在此出现——模型价格只读现行生效价目表，
 * 且客服回答里不逐条报模型价（草稿第 4 条）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { MICROS_PER_POINT } from '@weiban/contracts';
import { P26_CONTACT_LIMIT } from '../../../platform/config/product-params.js';
import type {
  BillingCustomerConfigReadPort,
  BillingReadPort,
  ContactsReadPort,
  IdentityAccountStatusPort,
  IdentityMembershipReadPort,
  MembershipSettings,
  RechargeOptions,
} from '@weiban/contracts';
import { BILLING_CUSTOMER_CONFIG_PORT, BILLING_READ_PORT } from '../../billing/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import {
  IDENTITY_ACCOUNT_STATUS_PORT,
  IDENTITY_MEMBERSHIP_READ_PORT,
} from '../../identity/index.js';

export interface UserStatusBrief {
  /** 模板占位符事实：缺值时对应确定性条目降级走模型路径。 */
  facts: {
    pointsBalance: string | null;
    contactCount: string | null;
    contactLimit: string;
    membershipTier: string | null;
    membershipExpiresAt: string | null;
    membershipPlans: string | null;
    rechargeTiers: string | null;
    signupBonus: string | null;
  };
  /** 注入提示词的简报行（只含查到的事实）。 */
  promptLines: string[];
}

const yuan = (fen: number): string => {
  const value = fen / 100;
  // 去尾零：1290 分 → 12.9（草稿口径写法），2000 分 → 20。
  return `${Number(value.toFixed(2))}`;
};

function renderMembershipPlans(settings: MembershipSettings): string {
  const names: Record<string, string> = { month: '月卡', quarter: '季卡', year: '年卡' };
  return settings.plans
    .map(
      (plan) =>
        `${names[plan.planId] ?? plan.planId} ${yuan(plan.priceFen)} 元 / ${plan.months} 个月，首次 ${yuan(plan.firstPriceFen)} 元，开通赠 ${plan.bonusPoints} 积分`,
    )
    .join('；');
}

function renderRechargeTiers(options: RechargeOptions): string {
  const tiers = options.tiers.map((tier) => `${yuan(tier.priceMicros / 10_000)} 元`).join('、');
  return `${tiers}，不赠送`;
}

@Injectable()
export class BriefService {
  constructor(
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT)
    private readonly membership: IdentityMembershipReadPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT)
    private readonly accounts: IdentityAccountStatusPort,
    @Inject(BILLING_CUSTOMER_CONFIG_PORT)
    private readonly customerConfig: BillingCustomerConfigReadPort,
  ) {}

  async assemble(userId: string): Promise<UserStatusBrief> {
    const [membership, spend, contactList, accountStatus, banned, settings, recharge] =
      await Promise.all([
        this.tryGet(() => this.membership.getMembership(userId)),
        this.tryGet(() => this.billing.getSpendStatus(userId)),
        this.tryGet(() => this.contacts.listActiveContacts(userId)),
        this.tryGet(() => this.accounts.getAccountStatus(userId)),
        this.tryGet(() =>
          typeof this.accounts.isBanned === 'function'
            ? this.accounts.isBanned(userId)
            : Promise.resolve(null),
        ),
        this.tryGet(() => this.customerConfig.getMembershipSettings()),
        this.tryGet(() => this.customerConfig.getRechargeOptions()),
      ]);

    const tier = membership?.tier === 'pro_plus' ? 'PRO+' : membership ? '免费' : null;
    const expiresAt = membership?.expiresAt ?? null;
    const pointsBalance =
      spend !== null
        ? String(Math.max(0, Math.floor(spend.availableMicros / MICROS_PER_POINT)))
        : null;
    const contactCount = contactList !== null ? String(contactList.length) : null;
    const membershipPlans = settings !== null ? renderMembershipPlans(settings) : null;
    const rechargeTiers = recharge !== null ? renderRechargeTiers(recharge) : null;
    const signupBonus = settings !== null ? String(settings.signupBonusPoints) : null;

    const promptLines: string[] = [];
    if (tier)
      promptLines.push(`会员档位：${tier}${expiresAt ? `，到期日 ${expiresAt}` : '，无到期日'}`);
    if (pointsBalance !== null)
      promptLines.push(`积分余额：${pointsBalance} 分（1 元 = 100 积分）`);
    if (contactCount !== null)
      promptLines.push(`通讯录：已加 ${contactCount} 个角色，上限 ${P26_CONTACT_LIMIT} 个`);
    if (accountStatus)
      promptLines.push(
        `账号状态：${accountStatus === 'active' ? '正常' : '注销中'}${banned ? '（已封禁）' : ''}`,
      );
    if (membershipPlans) promptLines.push(`会员价格（现行配置）：${membershipPlans}`);
    if (rechargeTiers) promptLines.push(`充值档位（现行配置）：${rechargeTiers}`);
    if (signupBonus !== null) promptLines.push(`注册赠送：${signupBonus} 积分`);

    return {
      facts: {
        pointsBalance,
        contactCount,
        contactLimit: String(P26_CONTACT_LIMIT),
        membershipTier: tier,
        membershipExpiresAt: expiresAt,
        membershipPlans,
        rechargeTiers,
        signupBonus,
      },
      promptLines,
    };
  }

  private async tryGet<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }
}
