import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretLeft, CheckCircle } from './old-icons.js';
import { BillingEndpoints, IdentityEndpoints } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { pointsText } from './points.js';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { useRemote } from '../data/use-remote.js';

/*
 * 注销账号（ACC-06；设计 account-deletion.md）：说明页 → 输入密码 → 完成页。
 * 密码错误（403 invalid_credentials）只提示、不退出登录；只有服务器明确「未登录」（401）时才退出。
 * 不挽留、不倒计时、不显示删除进度。
 */

const deletedItems = [
  '所有聊天记录和 TA 们的记忆',
  '你创建和导入的角色、导入的原始记录',
  '你上传的头像和图片',
  '积分和积分明细',
  '卡片、成就、宠物',
  '经期日记',
  '提醒、心愿清单、每日一问的回答、信件',
  '你在人设广场发布的作品、评论和点赞',
];

/** 清掉本机缓存：IndexedDB、Service Worker 缓存、Web Push 订阅（设计第 5 节）。 */
async function clearLocalData() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    /* 没有推送订阅。 */
  }
  try {
    for (const key of (await caches?.keys?.()) ?? []) await caches.delete(key);
  } catch {
    /* 浏览器不支持 Cache Storage。 */
  }
  try {
    const databases = (await indexedDB.databases?.()) ?? [];
    for (const db of databases) if (db.name) indexedDB.deleteDatabase(db.name);
  } catch {
    /* 部分浏览器没有 databases()。 */
  }
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* 隐私模式。 */
  }
}

export function AccountDeletionPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const wallet = useRemote(BillingEndpoints.getWallet);
  const [dialog, setDialog] = useState(false);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [lockedUntil, setLockedUntil] = useState(0);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dialog) input.current?.focus();
  }, [dialog, error]);
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = window.setTimeout(() => setLockedUntil(0), Math.max(0, lockedUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [lockedUntil]);
  const balance = wallet.data?.balancePoints ?? 0;

  async function submit() {
    if (!password || pending) return;
    setPending(true);
    setError('');
    try {
      await api.call(IdentityEndpoints.deleteAccount, {
        body: { password, confirm: 'DELETE' },
        networkOnly: true,
      });
      setDialog(false);
      setDone(true);
    } catch (e) {
      setPassword('');
      if (e instanceof ApiFailure && e.code === 'invalid_credentials') setError('密码错误');
      else if (e instanceof ApiFailure && e.status === 429) {
        setError(e.message || '尝试次数过多，请稍后再试');
        setLockedUntil(Date.now() + 10 * 60_000);
      } else if (e instanceof ApiFailure && e.status === 0) setError('网络不可用，请重试');
      else setError(e instanceof ApiFailure ? e.message : '网络不可用，请重试');
    } finally {
      setPending(false);
    }
  }

  async function finish() {
    await clearLocalData();
    await auth.logout().catch(() => {});
    navigate('/', { replace: true });
  }

  if (done)
    return (
      <main className="empty deletion-done">
        <CheckCircle size={64} aria-hidden />
        <h1>账号已注销</h1>
        <p className="hint">这个账号的数据正在删除，所有设备都已退出登录</p>
        <button className="primary" onClick={() => void finish()}>
          好的
        </button>
      </main>
    );
  return (
    <main>
      <header className="page-header">
        <button className="text-button" aria-label="返回" onClick={() => navigate(-1)}>
          <CaretLeft size={24} />
        </button>
        <h1>注销账号</h1>
        <span />
      </header>
      <h2 className="deletion-title">注销后，这个账号的全部数据会被删除，无法恢复。</h2>
      <h3 className="section-label">将被删除的内容</h3>
      <ul className="panel deletion-list">
        {deletedItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="panel stack">
        {balance > 0 && (
          <p>
            剩余积分 <strong className="numeric">{pointsText(balance)}</strong> 将作废
          </p>
        )}
        <p className="hint">
          别人已经从人设广场添加的角色属于对方，会保留，作者显示为「已注销用户」。
        </p>
      </div>
      <button className="danger danger-row" onClick={() => setDialog(true)}>
        注销账号
      </button>
      {dialog && (
        <div className="dialog-scrim">
          <form
            className="dialog"
            role="dialog"
            aria-label="输入密码确认注销"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <strong>输入密码确认注销</strong>
            <p className="hint">注销后无法恢复。</p>
            <label>
              密码
              <input
                ref={input}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <small role="alert" className="error">
                {error}
              </small>
            )}
            <div className="button-row">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setDialog(false);
                  setError('');
                  setPassword('');
                }}
              >
                取消
              </button>
              <button className="danger" disabled={!password || pending || lockedUntil > 0}>
                {pending ? '正在注销…' : '注销'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
