import { ApiFailure } from '@weiban/client-core';
import { useState } from 'react';
import { IdentityEndpoints, Username } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { MenuRow, Sheet } from './shell-kit.js';
import { showToast } from './toast.js';

export function AccountAliasRow() {
  const remote = useRemote(IdentityEndpoints.getAlias, { networkOnly: true });
  const [open, setOpen] = useState(false);
  return (
    <>
      <MenuRow label="微伴号" value={remote.data?.username ?? '—'} onClick={() => setOpen(true)} />
      {open && (
        <AliasSheet
          initial={remote.data?.username ?? ''}
          nextChangeAt={remote.data?.nextChangeAt ?? null}
          onClose={() => setOpen(false)}
          onSaved={() => {
            remote.refresh();
            setOpen(false);
          }}
        />
      )}
      {remote.error && (
        <p role="alert" className="notice-bar">
          {remote.error}
        </p>
      )}
    </>
  );
}
function AliasSheet({
  initial,
  nextChangeAt,
  onClose,
  onSaved,
}: {
  initial: string;
  nextChangeAt: string | null;
  onClose(): void;
  onSaved(): void;
}) {
  const auth = useAuth();
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [next, setNext] = useState(nextChangeAt);
  const [now, setNow] = useState(Date.now());
  const unchanged = value.trim().toLowerCase() === initial.toLowerCase();
  const limited = !!next && new Date(next).getTime() > now && !unchanged;
  const valid = Username.safeParse(value.trim()).success;
  async function save() {
    if (pending || !valid || limited) return;
    setPending(true);
    setError('');
    try {
      const owner = auth.session
        ? { userId: auth.session.user.userId, sessionId: auth.session.session.sessionId }
        : null;
      if (!owner || !api.owns(owner)) throw new Error('会话已改变');
      const result = await api.call(IdentityEndpoints.updateAlias, {
        body: { username: value.trim() },
      });
      if (!api.owns(owner)) return;
      setNext(result.nextChangeAt);
      await auth.refreshUser();
      if (!api.owns(owner)) return;
      window.dispatchEvent(new Event('weiban:settings-updated'));
      onSaved();
      showToast(unchanged ? '微伴号未变更' : '微伴号已修改', 2000, 'success');
    } catch (e) {
      if (
        e instanceof ApiFailure &&
        e.code === 'rate_limited' &&
        typeof e.details?.nextChangeAt === 'string'
      )
        setNext(e.details.nextChangeAt);
      setError(friendlyError(e));
    } finally {
      setPending(false);
      setNow(Date.now());
    }
  }
  return (
    <Sheet
      title="修改微伴号"
      closeLabel="取消"
      onClose={() => {
        if (!pending) onClose();
      }}
      action={
        <button
          className="small-primary primary"
          disabled={pending || !valid || limited}
          onClick={() => void save()}
        >
          完成
        </button>
      }
    >
      <div className="field-sheet">
        <input
          autoFocus
          aria-label="微伴号"
          value={value}
          maxLength={32}
          disabled={pending}
          onChange={(e) => {
            setValue(e.target.value);
            setNow(Date.now());
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
      </div>
      <p className="hint page-note">
        4～32位字母、数字或下划线，每7天可修改一次。原微伴号仍可登录。
      </p>
      {next && <p className="hint page-note">下次可改：{new Date(next).toLocaleString('zh-CN')}</p>}
      {error && (
        <p role="alert" className="error page-note">
          {error}
        </p>
      )}
    </Sheet>
  );
}
