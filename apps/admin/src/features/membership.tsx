import { useState } from 'react';
import { MembershipAdminEndpoints as E } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, errorText } from '../data/hooks.js';
export function MembershipEditor({ userId }: { userId: string }) {
  const r = useRemote(E.get, { params: { userId } });
  const [expiry, setExpiry] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function save(revoke = false) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (
        !revoke &&
        (!expiry ||
          !Number.isFinite(new Date(expiry).getTime()) ||
          new Date(expiry).getTime() <= Date.now())
      ) {
        setError('请选择未来到期时间');
        return;
      }
      await api.call(E.set, {
        params: { userId },
        body: { expiresAt: revoke ? null : new Date(expiry).toISOString() },
      });
      r.refresh();
      setMessage(revoke ? '已撤销PRO+' : '已授予PRO+');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel stack">
      <h3>会员档位基础</h3>
      <p>
        {r.data?.tier === 'pro_plus' ? 'PRO+' : 'Free'} · 到期：
        {r.data?.expiresAt ? new Date(r.data.expiresAt).toLocaleString() : '无'}
      </p>
      <p className="hint">仅管理员授予真实档位与申请制作次数依据；不代表支付、赠分或其他权益。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          PRO+到期时间
          <input
            type="datetime-local"
            required
            value={expiry}
            disabled={busy}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </label>
        <button disabled={busy || !expiry}>授予／更新</button>
        <button
          type="button"
          disabled={busy || r.data?.tier !== 'pro_plus'}
          onClick={() => {
            if (window.confirm('确认撤销PRO+？不会改变积分。')) void save(true);
          }}
        >
          撤销
        </button>
      </form>
      {(error || r.error) && <p role="alert">{error || r.error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
