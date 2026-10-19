/*
 * 3.17 会员 v5（docs/refactor/16-membership-v5.md §3、§5、§6）：PRO+ 价格与权益对照页。
 * - 现阶段没有在线支付：显示价格，点「开通」提示联系管理员（由后台「会员与订单」替用户开通，开通即送积分）。
 * - 权益对照是星野式两列 Free / PRO+ 逐行打勾，需要积分的项标「需积分」。
 * - 总经理 10-19 明确：不放任何诱导开通的文案（不渲染「还差 N」「立即开通享…」之类），只如实列出两档区别。
 * - 记忆数字与 16 号 §5.3 一致（批 B 把它们做成后台可调后，这里如需跟随应改为读接口）。
 */
import { useState } from 'react';
import {
  MembershipEndpoints,
  MembershipOfferEndpoints,
  RoleRequestEndpoints,
  type MembershipPlan,
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
  const [picked, setPicked] = useState<MembershipPlan | null>(null);
  const data = offer.data;
  const member = data?.membership ?? membership.data;
  const pro = member?.tier === 'pro_plus';
  const rc = roleConfig.data;
  const life = rc?.lifetimeFreeCount ?? 3;
  const weekly = rc?.proPlusWeeklyFreeCount ?? 2;
  const fee = rc?.pointsCost ?? 200;
  const bonus = (data?.plans ?? [])
    .map((p) => `${p.name} ${formatPoints(p.bonusPoints)}`)
    .join(' / ');

  const rows: Row[] = [
    { label: '和角色聊天（可选任意模型）', free: true, pro: true, points: true },
    { label: '群聊、语音消息、电话', free: true, pro: true, points: true },
    { label: '切换模型、私密模式', free: true, pro: true, points: true },
    { label: '开通即送积分（永久有效）', free: false, pro: bonus || true },
    { label: '常驻记忆（每次都记得的重要事）', free: '3 条', pro: '16 条' },
    { label: '记忆库容量（每个角色）', free: '30 条', pro: '不限' },
    { label: '聊天摘要', free: '最近 7 天', pro: '全部 + 年度回忆' },
    { label: '每次按话题回想', free: '3 条', pro: '8 条' },
    { label: '翻聊天记录（提到旧事时）', free: '最近 7 天', pro: '全部' },
    { label: '长上下文模式（可选）', free: false, pro: true, points: true },
    { label: '角色生态（含私人朋友圈）', free: false, pro: true, points: true },
    { label: '接入 QQ / 微信', free: false, pro: true, points: true },
    { label: '好感度加成', free: false, pro: true },
    {
      label: `申请官方制作角色（免费次数用完后 ${fee} 积分/次）`,
      free: `终身 ${life} 次`,
      pro: `终身 ${life} 次 + 每周 ${weekly} 次`,
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
        所有 AI 回复按积分计费，开通即送积分。扣费按实际用量（1 元 = 100
        积分），会员与免费用户单价相同。新用户注册后前 7 天按 PRO+ 的记忆范围体验。
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
