import { useEffect, useRef, useState } from 'react';
import { USER_STATUS_PRESETS, UserStatusEndpoints, type UserStatusPreset } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { MenuGroup, MenuRow, NavBar } from './shell-kit.js';
import { showToast } from './toast.js';

function useLiveStatus() {
  const remote = useRemote(UserStatusEndpoints.get, { networkOnly: true });
  const refresh = useRef(remote.refresh);
  refresh.current = remote.refresh;
  const [, tick] = useState(0);
  useUpdates((u) => {
    if (u.type === 'settings.updated' && (u.data as { section?: string })?.section === 'profile')
      refresh.current();
  });
  useEffect(() => {
    const restore = () => {
      tick((v) => v + 1);
      if (document.visibilityState === 'visible') refresh.current();
    };
    window.addEventListener('focus', restore);
    document.addEventListener('visibilitychange', restore);
    return () => {
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', restore);
    };
  }, []);
  const expires = remote.data?.status?.expiresAt;
  useEffect(() => {
    if (!expires) return;
    const delay = Date.parse(expires) - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(
      () => {
        tick((v) => v + 1);
        refresh.current();
      },
      Math.min(delay + 10, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [expires]);
  return remote;
}
export function MyStatusRow() {
  const remote = useLiveStatus();
  const s = remote.data?.status;
  const active = s && (!s.expiresAt || Date.parse(s.expiresAt) > Date.now());
  return (
    <MenuRow to="/me/status" label="我的状态" value={active ? s.emoji + ' ' + s.label : '未设置'} />
  );
}
export function UserStatusPage() {
  const remote = useLiveStatus();
  const [preset, setPreset] = useState<UserStatusPreset>('happy');
  const [text, setText] = useState('');
  const [duration, setDuration] = useState('day');
  const dirty = useRef(false),
    initialized = useRef(false);
  useEffect(() => {
    if (!remote.data || initialized.current || dirty.current) return;
    initialized.current = true;
    const status = remote.data.status;
    if (status) {
      setPreset(status.preset as UserStatusPreset);
      setText(status.text ?? '');
    }
  }, [remote.data]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(clear = false) {
    setBusy(true);
    setError('');
    try {
      if (clear) await api.call(UserStatusEndpoints.clear);
      else
        await api.call(UserStatusEndpoints.set, {
          body: {
            preset,
            text: text.trim() || null,
            duration:
              duration === 'forever'
                ? { kind: 'forever' }
                : duration === 'day'
                  ? { kind: 'end_of_day' }
                  : { kind: 'minutes', minutes: Number(duration) },
          },
        });
      remote.refresh();
      showToast(clear ? '已清除状态' : '已设置状态');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  const current = remote.data?.status;
  return (
    <main>
      <NavBar title="我的状态" fallback="/me" />
      {remote.loading && !remote.data && (
        <p className="empty" role="status">
          正在读取状态…
        </p>
      )}
      {remote.error && (
        <p className="page-note" role="alert">
          {remote.error}{' '}
          <button type="button" className="text-button" onClick={remote.refresh}>
            重试
          </button>
        </p>
      )}
      <MenuGroup>
        <MenuRow
          label="当前状态"
          value={
            current && (!current.expiresAt || Date.parse(current.expiresAt) > Date.now())
              ? current.emoji + ' ' + current.label
              : '未设置'
          }
          chevron={false}
        />
      </MenuGroup>
      {current && (
        <p className="hint">
          当前有效期：
          {current.expiresAt ? new Date(current.expiresAt).toLocaleString() : '直到手动清除'}
          。下方有效期选择在本次设置时生效。
        </p>
      )}
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          状态
          <select
            value={preset}
            disabled={busy}
            onChange={(e) => {
              dirty.current = true;
              setPreset(e.target.value as UserStatusPreset);
            }}
          >
            {USER_STATUS_PRESETS.map((s) => (
              <option key={s.preset} value={s.preset}>
                {s.emoji} {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          补充文字
          <input
            maxLength={20}
            value={text}
            disabled={busy}
            onChange={(e) => {
              dirty.current = true;
              setText(e.target.value);
            }}
            placeholder="最多20字"
          />
        </label>
        <label>
          有效期
          <select value={duration} disabled={busy} onChange={(e) => setDuration(e.target.value)}>
            <option value="day">今天结束（资料时区）</option>
            <option value="60">1小时</option>
            <option value="1440">24小时</option>
            <option value="forever">直到手动清除</option>
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          className="primary"
          type="submit"
          disabled={busy || (preset === 'custom' && !text.trim())}
        >
          {busy ? '正在保存…' : '设置状态'}
        </button>
        <button type="button" disabled={busy || !current} onClick={() => void save(true)}>
          清除状态
        </button>
      </form>
      <p className="page-note">角色在下一次聊天回复时可自然参考你的状态；此处不发布动态。</p>
    </main>
  );
}
