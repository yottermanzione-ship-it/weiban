import { MembershipEditor } from './membership.js';
/**
 * 用户与积分（06-old-ui-spec 第 6、9 节；契约 3.3）：账号积分概况、按积分加 / 扣、流水、充值档位配置。
 * 涉及用户的金额同时写积分和折合元（1 元 = 100 积分）。
 */
import { useRef, useState, type FormEvent } from 'react';
import { BillingAdminEndpoints, AdminAccountSummary } from '@weiban/contracts';
import { api } from '../data/client.js';
import type { z } from 'zod';
type Account = z.infer<typeof AdminAccountSummary>;
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

const pts = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
const yuan = (micros: number) => `¥${(micros / 1_000_000).toFixed(2)}`;

function AccountDetails({ account, refresh }: { account: Account; refresh: () => void }) {
  const ledger = useRemote(BillingAdminEndpoints.listAccountLedger, {
    params: { userId: account.userId },
    query: { limit: 50 },
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const operation = useRef<{ signature: string; key: string } | null>(null);
  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    const points = Number(form.get('points'));
    if (!Number.isFinite(points) || points <= 0) {
      setError('请输入大于 0 的积分');
      return;
    }
    setPending(true);
    try {
      const direction = String(form.get('direction')) as 'grant' | 'deduct';
      const body = {
        direction,
        points: Math.round(points * 10_000) / 10_000,
        reason: String(form.get('reason')),
      };
      const signature = JSON.stringify(body);
      if (operation.current?.signature !== signature)
        operation.current = { signature, key: crypto.randomUUID() };
      await api.call(BillingAdminEndpoints.adjustBalance, {
        params: { userId: account.userId },
        body: { ...body, idempotencyKey: operation.current.key },
      });
      operation.current = null;
      setMessage('积分已更新');
      ledger.refresh();
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel stack">
      <MembershipEditor key={account.userId} userId={account.userId} />
      <h2>{account.username || '已注销账号'} · 积分操作</h2>
      <form className="form-grid" onSubmit={(e) => void adjust(e)}>
        <label>
          操作
          <select name="direction">
            <option value="grant">加积分</option>
            <option value="deduct">扣积分</option>
          </select>
        </label>
        <label>
          积分（1 元 = 100 积分）
          <input name="points" required inputMode="decimal" placeholder="例：1000" />
        </label>
        <label>
          原因
          <input name="reason" minLength={2} maxLength={200} required />
        </label>
        <button className="primary" disabled={pending}>
          确认提交
        </button>
      </form>
      <Feedback message={message} error={error || ledger.error} />
      <table>
        <thead>
          <tr>
            <th>时间（北京时间）</th>
            <th>积分</th>
            <th>剩余</th>
            <th>上游成本</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {ledger.data?.items.map((row) => (
            <tr key={row.entryId}>
              <td>
                {new Date(row.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
              </td>
              <td className={(row.points ?? 0) > 0 ? 'income' : ''}>
                {(row.points ?? 0) > 0 ? '+' : ''}
                {pts(row.points)} <span className="hint">≈ {yuan(row.amountMicros)}</span>
              </td>
              <td>{pts(row.balanceAfterPoints)}</td>
              <td>{row.costMicros == null ? '—' : yuan(row.costMicros)}</td>
              <td>{row.note ?? row.modelKey ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** 充值档位与联系管理员说明（用户端充值页显示；第一版不开真实支付）。 */
function RechargeConfig() {
  const options = useRemote(BillingAdminEndpoints.getRechargeOptions);
  const [rows, setRows] = useState<Array<{ tierId: string; yuan: string; bonus: string }> | null>(
    null,
  );
  const [hint, setHint] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = options.data;
  const list =
    rows ??
    data?.tiers.map((t) => ({
      tierId: t.tierId,
      yuan: String(t.priceMicros / 1_000_000),
      bonus: String(t.bonusPercent),
    })) ??
    [];
  const contact = hint ?? data?.contactHint ?? '';
  const update = (index: number, patch: Partial<(typeof list)[number]>) =>
    setRows(list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  async function save() {
    setPending(true);
    setError('');
    try {
      await api.call(BillingAdminEndpoints.updateRechargeOptions, {
        body: {
          tiers: list.map((r) => ({
            tierId: r.tierId.trim(),
            priceMicros: Math.round(Number(r.yuan) * 1_000_000),
            bonusPercent: Number(r.bonus || 0),
          })),
          contactHint: contact,
        },
      });
      setRows(null);
      setHint(null);
      options.refresh();
      setMessage('已保存');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel stack">
      <h2>充值档位</h2>
      <p className="hint">
        用户端「充值」页按这里的档位显示（价格 ÷ 1 元 = 100 积分 +
        赠送）。第一版不开真实支付，按钮为「联系管理员充值」，弹窗显示下方说明。
      </p>
      <table>
        <thead>
          <tr>
            <th>档位编号</th>
            <th>价格（元）</th>
            <th>到账积分</th>
            <th>赠送比例（%）</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((r, index) => (
            <tr key={index}>
              <td>
                <input
                  value={r.tierId}
                  maxLength={32}
                  onChange={(e) => update(index, { tierId: e.target.value })}
                />
              </td>
              <td>
                <input
                  value={r.yuan}
                  inputMode="decimal"
                  onChange={(e) => update(index, { yuan: e.target.value })}
                />
              </td>
              <td>
                {pts(Number(r.yuan) * 100)}
                {Number(r.bonus) > 0 && (
                  <span className="hint">
                    {' '}
                    + 送 {pts(Math.floor((Number(r.yuan) * 100 * Number(r.bonus)) / 100))}
                  </span>
                )}
              </td>
              <td>
                <input
                  value={r.bonus}
                  inputMode="decimal"
                  onChange={(e) => update(index, { bonus: e.target.value })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="danger"
                  onClick={() => setRows(list.filter((_, i) => i !== index))}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inline">
        <button
          type="button"
          disabled={list.length >= 12}
          onClick={() =>
            setRows([...list, { tierId: `t${list.length + 1}`, yuan: '10', bonus: '0' }])
          }
        >
          + 添加档位
        </button>
      </div>
      <label>
        联系管理员说明
        <input
          value={contact}
          maxLength={200}
          onChange={(e) => setHint(e.target.value)}
          placeholder="例：加微信 xxx，备注微伴号"
        />
      </label>
      <div className="inline">
        <button
          type="button"
          className="primary"
          disabled={pending || !data}
          onClick={() => void save()}
        >
          保存充值配置
        </button>
      </div>
      <Feedback message={message} error={error || options.error} />
    </section>
  );
}

export function AccountsPage() {
  const accounts = useRemote(BillingAdminEndpoints.listAccounts);
  const [selected, setSelected] = useState<string | null>(null);
  const current = accounts.data?.items.find((a) => a.userId === selected);
  return (
    <>
      <h1>用户与积分</h1>
      <Feedback error={accounts.error} />
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>积分</th>
            <th>处理中</th>
            <th>近 30 天消耗</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.data?.items.map((a) => (
            <tr key={a.userId} className={a.userId === selected ? 'selected' : ''}>
              <td>{a.username || '已注销账号'}</td>
              <td>
                {pts(a.balancePoints)} <span className="hint">≈ {yuan(a.balanceMicros)}</span>
              </td>
              <td>{pts(a.heldMicros / 10_000)}</td>
              <td>
                {pts(a.spentLast30DaysPoints)}{' '}
                <span className="hint">≈ {yuan(a.spentLast30DaysMicros)}</span>
              </td>
              <td>
                <button onClick={() => setSelected(a.userId)}>加扣积分与流水</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {current && (
        <AccountDetails key={current.userId} account={current} refresh={accounts.refresh} />
      )}
      <RechargeConfig />
    </>
  );
}
