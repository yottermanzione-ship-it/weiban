import { useRef, useState, type FormEvent } from 'react';
import { BillingAdminEndpoints, AdminAccountSummary } from '@weiban/contracts';
import { formatMoney, yuanToMicros } from '@weiban/client-core';
import { api } from '../data/client.js';
import type { z } from 'zod';
type Account = z.infer<typeof AdminAccountSummary>;
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';
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
    setPending(true);
    try {
      const direction = String(form.get('direction')) as 'grant' | 'deduct';
      const body = {
        direction,
        amountMicros: yuanToMicros(String(form.get('amount'))),
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
      setMessage('余额已更新');
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
      <h2>{account.username} · 余额操作</h2>
      <form className="form-grid" onSubmit={(e) => void adjust(e)}>
        <label>
          操作
          <select name="direction">
            <option value="grant">加余额</option>
            <option value="deduct">扣余额</option>
          </select>
        </label>
        <label>
          金额（元）
          <input name="amount" required inputMode="decimal" />
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
            <th>金额</th>
            <th>余额</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {ledger.data?.items.map((row) => (
            <tr key={row.entryId}>
              <td>
                {new Date(row.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
              </td>
              <td>{formatMoney(row.amountMicros)}</td>
              <td>{formatMoney(row.balanceAfterMicros)}</td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
export function AccountsPage() {
  const accounts = useRemote(BillingAdminEndpoints.listAccounts);
  const [selected, setSelected] = useState<string | null>(null);
  const current = accounts.data?.items.find((a) => a.userId === selected);
  return (
    <>
      <h1>用户与余额</h1>
      <Feedback error={accounts.error} />
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>余额</th>
            <th>冻结中</th>
            <th>近30天花费</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.data?.items.map((a) => (
            <tr key={a.userId}>
              <td>{a.username || '已注销账号'}</td>
              <td>{formatMoney(a.balanceMicros)}</td>
              <td>{formatMoney(a.heldMicros)}</td>
              <td>{formatMoney(a.spentLast30DaysMicros)}</td>
              <td>
                <button onClick={() => setSelected(a.userId)}>余额与流水</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {current && (
        <AccountDetails key={current.userId} account={current} refresh={accounts.refresh} />
      )}
    </>
  );
}
