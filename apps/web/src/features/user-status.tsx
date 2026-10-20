import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserStatusEndpoints, type UserStatus } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { useBack, useEscape } from './shell-kit.js';
import {
  STATUS_GROUPS,
  StatusIcon,
  statusChoiceOf,
  statusIconOf,
  type StatusChoice,
} from './status-icons.js';
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
function activeStatus(status: UserStatus | null | undefined): UserStatus | null {
  return status && (!status.expiresAt || Date.parse(status.expiresAt) > Date.now()) ? status : null;
}

/** F1-4「我」页头卡里的状态胶囊：没有状态显示「+ 状态」，有则显示图标与文字（参照微信）。 */
export function MyStatusChip() {
  const remote = useLiveStatus();
  const active = activeStatus(remote.data?.status);
  return (
    <Link
      className="me-status-chip"
      to="/me/status"
      aria-label={active ? `我的状态：${active.label}` : '设置状态'}
    >
      <StatusIcon name={active ? statusIconOf(active) : 'plus'} size={15} />
      <span>{active ? active.label : '状态'}</span>
    </Link>
  );
}

const durations = [
  { value: '1440', label: '24小时' },
  { value: 'day', label: '今天结束' },
  { value: '60', label: '1小时' },
  { value: 'forever', label: '一直' },
] as const;
type Duration = (typeof durations)[number]['value'];

function untilText(expiresAt: string | null) {
  if (!expiresAt) return '直到手动清除';
  const at = new Date(expiresAt);
  return `到 ${at.getMonth() + 1}月${at.getDate()}日 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** F1-5「设个状态」：深色毛玻璃 + 分组图标宫格（参照微信版式，图标自绘）。 */
export function UserStatusPage() {
  const remote = useLiveStatus();
  const goBack = useBack('/me');
  const current = activeStatus(remote.data?.status);
  const [picked, setPicked] = useState<StatusChoice | null>(null);
  const [text, setText] = useState('');
  const [duration, setDuration] = useState<Duration>('1440');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEscape(() => (picked ? setPicked(null) : goBack()));
  const currentKey = current ? statusChoiceOf(current).key : null;
  const highlighted = picked?.key ?? currentKey;
  function pick(choice: StatusChoice) {
    setPicked(choice);
    setError('');
    // 预设项可补一句；同一项时沿用当前状态的补充文字。补齐项的文字就是状态名，不再补充。
    setText(
      !choice.text && current && statusChoiceOf(current).key === choice.key
        ? (current.text ?? '')
        : '',
    );
  }
  async function save(clear = false) {
    if (!clear && !picked) return;
    setBusy(true);
    setError('');
    try {
      if (clear) await api.call(UserStatusEndpoints.clear);
      else if (picked)
        await api.call(UserStatusEndpoints.set, {
          body: {
            preset: picked.preset,
            text: picked.text ?? (text.trim() || null),
            duration:
              duration === 'forever'
                ? { kind: 'forever' }
                : duration === 'day'
                  ? { kind: 'end_of_day' }
                  : { kind: 'minutes', minutes: Number(duration) },
          },
        });
      remote.refresh();
      setPicked(null);
      showToast(clear ? '已清除状态' : '已设置状态');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  const needsText = picked?.key === 'custom' && !text.trim();
  return (
    <main className="status-page">
      <header className="status-head">
        <button type="button" className="status-close" aria-label="关闭" onClick={goBack}>
          <StatusIcon name="close" size={24} />
        </button>
        <h1>
          设个状态
          <small>朋友 24 小时内可见</small>
        </h1>
      </header>
      {remote.error && (
        <p className="status-tip" role="alert">
          {remote.error}{' '}
          <button type="button" className="status-link" onClick={remote.refresh}>
            重试
          </button>
        </p>
      )}
      {current && (
        <section className="status-group status-current" aria-label="当前状态">
          <StatusIcon name={statusIconOf(current)} size={26} />
          <span>
            {current.label}
            <small>{untilText(current.expiresAt)}</small>
          </span>
          <button
            type="button"
            className="status-link"
            disabled={busy}
            onClick={() => void save(true)}
          >
            清除状态
          </button>
        </section>
      )}
      {STATUS_GROUPS.map((group) => (
        <section key={group.title} className="status-group" aria-label={group.title}>
          <h2>{group.title}</h2>
          <div className="status-grid">
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === highlighted ? 'status-cell on' : 'status-cell'}
                aria-pressed={item.key === highlighted}
                onClick={() => pick(item)}
              >
                <StatusIcon name={item.icon} size={28} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="status-tip">角色在下一次聊天回复时可自然参考你的状态；此处不发布动态。</p>
      {picked && (
        <form
          className="status-confirm"
          aria-label={`设置状态：${picked.label}`}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="status-confirm-head">
            <StatusIcon name={picked.icon} size={30} />
            <strong>{text.trim() || picked.label}</strong>
          </div>
          {!picked.text && (
            <input
              maxLength={20}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                picked.key === 'custom' ? '写下你的状态（最多20字）' : '补充一句（可选，最多20字）'
              }
              aria-label="状态文字"
            />
          )}
          <div className="status-durations" role="radiogroup" aria-label="有效期">
            {durations.map((d) => (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={duration === d.value}
                className={duration === d.value ? 'on' : ''}
                disabled={busy}
                onClick={() => setDuration(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="status-actions">
            <button type="button" disabled={busy} onClick={() => setPicked(null)}>
              取消
            </button>
            <button type="submit" className="primary" disabled={busy || needsText}>
              {busy ? '正在保存…' : '设置'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
