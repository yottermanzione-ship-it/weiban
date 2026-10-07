import { useRef, useState, type FormEvent } from 'react';
import { IdentityAdminEndpoints } from '@weiban/contracts';
import { formatMoney, yuanToMicros } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';
export function InvitesPage() {
  const list = useRemote(IdentityAdminEndpoints.listInvites);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const operation = useRef<{ signature: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const days = String(form.get('days') ?? '');
      const body = {
        expiresInDays: days ? Number(days) : null,
        bonusMicros: yuanToMicros(String(form.get('bonus') || '0')),
      };
      const signature = JSON.stringify(body);
      if (operation.current?.signature !== signature)
        operation.current = { signature, key: crypto.randomUUID() };
      const invite = await api.call(IdentityAdminEndpoints.createInvite, {
        body,
        idempotencyKey: operation.current.key,
      });
      setMessage(`已生成邀请码：${invite.code}`);
      operation.current = null;
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <h1>邀请码</h1>
      <form className="panel form-grid" onSubmit={(e) => void submit(e)}>
        <label>
          有效天数
          <input name="days" type="number" min={1} max={365} placeholder="留空表示不过期" />
        </label>
        <label>
          注册赠送余额（元）
          <input name="bonus" inputMode="decimal" defaultValue="0" required />
        </label>
        <button className="primary" disabled={pending}>
          生成邀请码
        </button>
      </form>
      <Feedback message={message} error={error || list.error} />
      <table>
        <thead>
          <tr>
            <th>邀请码</th>
            <th>赠送余额</th>
            <th>状态</th>
            <th>到期时间（北京时间）</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.code}>
              <td>{item.code}</td>
              <td>{formatMoney(item.bonusMicros ?? 0)}</td>
              <td>{item.usedAt ? '已使用' : '未使用'}</td>
              <td>
                {item.expiresAt
                  ? new Date(item.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                  : '不过期'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
