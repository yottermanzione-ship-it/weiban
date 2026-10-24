/*
 * 3.17 会员 v5（docs/refactor/16-membership-v5.md §3、§5、§6）：PRO+ 价格与权益对照页。
 * - 现阶段没有在线支付：显示价格，点「开通」提示联系管理员（由后台「会员与订单」替用户开通，开通即送积分）。
 * - 权益对照是星野式两列 Free / PRO+ 逐行打勾，需要积分的项标「需积分」。
 * - 总经理 10-19 明确：不放任何诱导开通的文案（不渲染「还差 N」「立即开通享…」之类），只如实列出两档区别。
 * - 记忆数字读批 B 的记忆分档参数（MemoryTierEndpoints.plans，后台「系统 › 记忆分档」可调）；读不到时按 16 号 §5.3 默认显示。
 * - 10-25（会员 v6）：角色制作免费次数不再「终身 + 每周」叠加——免费用户终身 N 次、PRO+ 每周 N 次，
 *   数字都读 RoleRequestEndpoints.getConfig（后台「制作申请 › 价格与开关」）；用完后按 pointsCost 积分/次。
 */
import { useState } from 'react';
import {
  MembershipEndpoints,
  MembershipOfferEndpoints,
  MemoryTierEndpoints,
  RoleRequestEndpoints,
  type MembershipPlan,
  type MemoryTierLimits,
} from '@weiban/contracts';
import { useRemote } from '../data/use-remote.js';
import { NavBar } from './shell-kit.js';
import { Dialog } from './toast.js';
import { formatPoints } from './points.js';

const yuan = (fen: number) => (fen % 100 === 0 ? String(fen / 100) : (fen / 100).toFixed(1));

function dateText(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 记忆分档默认值（16 号 §5.3），接口读不到时用。 */
const DEFAULT_FREE: MemoryTierLimits = {
  residentLimit: 3,
  libraryLimit: 30,
  summaryDays: 7,
  retrieveLimit: 3,
  recallDays: 7,
};
const DEFAULT_PRO: MemoryTierLimits = {
  residentLimit: 16,
  libraryLimit: null,
  summaryDays: null,
  retrieveLimit: 8,
  recallDays: null,
};
const days = (n: number | null, all: string) => (n === null ? all : `最近 ${n} 天`);

type Cell = string | boolean;
interface Row {
  label: string;
  free: Cell;
  pro: Cell;
  /** 这项使用时按积分扣费。 */
  points?: boolean;
}

function CellView({ value }: { value: Cell }) {
  if (value === true)
    return (
      <span className="benefit-yes" aria-label="有">
        ✓
      </span>
    );
  if (value === false)
    return (
      <span className="benefit-no" aria-label="无">
        —
      </span>
    );
  return (
    <span className="benefit-text">
      {value.split(' / ').map((line) => (
        <span key={line} className="benefit-line">
          {line}
        </span>
      ))}
    </span>
  );
}

export function MembershipPage() {
  const offer = useRemote(MembershipOfferEndpoints.getOffer);
  const membership = useRemote(MembershipEndpoints.get);
  const roleConfig = useRemote(RoleRequestEndpoints.getConfig);
  const tiers = useRemote(MemoryTierEndpoints.plans);
  const mf = tiers.data?.free ?? DEFAULT_FREE;
  const mp = tiers.data?.proPlus ?? DEFAULT_PRO;
  const trialDays = tiers.data?.newUserTrialDays ?? 7;
  const [picked, setPicked] = useState<MembershipPlan | null>(null);
  const data = offer.data;
  const member = data?.membership ?? membership.data;
  const pro = member?.tier === 'pro_plus';
  const rc = roleConfig.data;
  const life = rc?.lifetimeFreeCount ?? 3;
  const weekly = rc?.proPlusWeeklyFreeCount ?? 3;
  const fee = rc?.pointsCost ?? 200;

  const rows: Row[] = [
    { label: '角色聊天', free: true, pro: true, points: true },
    { label: '群聊', free: false, pro: true, points: true },
    { label: '语音通话', free: true, pro: true, points: true },
    { label: '切换模型', free: true, pro: true, points: true },
    {
      label: '常驻记忆',
      free: `${mf.residentLimit} 条`,
      pro: `${mp.residentLimit} 条`,
    },
    {
      label: '记忆库容量 /角色',
      free: mf.libraryLimit === null ? '不限' : `${mf.libraryLimit} 条`,
      pro: mp.libraryLimit === null ? '不限' : `${mp.libraryLimit} 条`,
    },
    {
      label: '聊天摘要',
      free: days(mf.summaryDays, '全部'),
      // 「年度回忆」后端只留了上下文口子、暂无数据来源（memory-window annual 传空）。
      pro: days(mp.summaryDays, '长期、年度回忆'),
    },
    {
      label: '按话题回忆往事',
      free: `${mf.retrieveLimit} 条`,
      pro: `${mp.retrieveLimit} 条`,
    },
    { label: '角色生态', free: false, pro: true, points: true },
    { label: '接入 QQ / 微信', free: false, pro: true, points: true },
    { label: '好感度加成', free: false, pro: true },
    // 3.25（G1-7）：从未充值且非会员的账号，好感度最高到「亲密好友」；充值或开通会员后解除。
    { label: '好感度最高阶段', free: '亲密好友', pro: '伴侣' },
    {
      // 10-25（会员 v6）：免费列就是终身 N 次；PRO+ 只看本周 N 次，不再叠加终身次数。
      label: '角色制作',
      free: `${life} 次`,
      pro: `每周 ${weekly} 次`,
    },
  ];

  return (
    <main className="membership-page">
      <NavBar title="PRO+ 会员" fallback="/me" />
      <section className="membership-status">
        <strong>{pro ? 'PRO+ 会员' : '免费用户'}</strong>
        <p>
          {pro && member?.expiresAt
            ? `有效期至 ${dateText(member.expiresAt)}`
            : '所有 AI 回复按积分计费，开通即送积分'}
        </p>
      </section>

      <p className="recharge-section">PRO+ 价格</p>
      <div className="recharge-tiers">
        {data?.plans.map((plan) => {
          const first = data.firstPurchaseAvailable && plan.firstPriceFen < plan.priceFen;
          return (
            <button
              key={plan.planId}
              type="button"
              className="recharge-tier"
              onClick={() => setPicked(plan)}
            >
              <span className="recharge-points">
                <b>{plan.name}</b>
                <small>送 {formatPoints(plan.bonusPoints)} 积分</small>
              </span>
              <span className="membership-price">
                <span className="recharge-price">
                  ¥{yuan(first ? plan.firstPriceFen : plan.priceFen)}
                </span>
                {first && <s className="hint">¥{yuan(plan.priceFen)}</s>}
                {first && <small className="hint">首次价，每人限一次</small>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="hint page-note">
        会员可叠加续期；赠送积分开通即到账，会员到期后也能继续用，扣费时先用赠送积分。
      </p>

      <p className="recharge-section">权益对照</p>
      <div className="benefit-table" role="table" aria-label="免费与 PRO+ 权益对照">
        <div className="benefit-row benefit-head" role="row">
          <span role="columnheader">权益</span>
          <span role="columnheader">免费</span>
          <span role="columnheader">PRO+</span>
        </div>
        {rows.map((row) => (
          <div className="benefit-row" role="row" key={row.label}>
            <span role="cell" className="benefit-label">
              {row.label}
              {row.points && <em className="benefit-points">需积分</em>}
            </span>
            <span role="cell">
              <CellView value={row.free} />
            </span>
            <span role="cell">
              <CellView value={row.pro} />
            </span>
          </div>
        ))}
      </div>
      <p className="hint page-note">
        免费用户的 {life} 次是终身次数，用完后每次 {fee} 积分（后台可调）；PRO+
        的每周次数按北京时间周一 0 点重置，不累积到下周。
      </p>
      <p className="hint page-note">
        所有 AI 回复按积分计费，开通即送积分。扣费按实际用量（1 元 = 100
        积分），会员与免费用户单价相同。
        {trialDays > 0 ? `新用户注册后前 ${trialDays} 天按 PRO+ 的记忆范围体验。` : ''}
      </p>

      {(offer.error || roleConfig.error) && (
        <p role="alert" className="notice-bar">
          {offer.error ?? roleConfig.error}
        </p>
      )}
      {picked && data && (
        <Dialog
          title={`开通 PRO+ ${picked.name}`}
          actions={[{ label: '知道了', primary: true, onClick: () => setPicked(null) }]}
        >
          <p>{data.contactHint || '暂未开放在线支付，请联系管理员开通'}</p>
          <p className="hint">管理员开通后，赠送积分会自动到账。</p>
        </Dialog>
      )}
    </main>
  );
}
