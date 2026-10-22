/*
 * 登录 / 注册（总经理 2026-10-14 反馈 1.2：完全照社交应用的「账号密码登录」页）：
 * 左上 ×、居中大标题、「账号 / 密码」两行带分隔线的表单、灰色说明、蓝色文字链接、
 * 「登录后同步最近的聊天记录」勾选、绿色「同意并登录」大按钮、最底「找回密码 | 注册」。
 * 注册 / 登录直接切换，不使用「更多」菜单；用不上的入口（手机号登录、找回密码）提示「暂未开放」。
 * 总经理 10-14 确认（Q12）：未登录先显示微信那种欢迎页——品牌 + 底部「登录」「注册」两个按钮；登录页左上 × 回到欢迎页。
 */
import { useRef, useState, type FormEvent } from 'react';
import { IdentityEndpoints } from '@weiban/contracts';
import { useNavigate } from 'react-router-dom';
import { api } from '../data/client.js';
import { useAuth } from '../app/auth.js';
import { friendlyError } from '../data/use-remote.js';
import { OldIcon } from './old-icons.js';
import { CheckCircle, showComingSoon } from './shell-kit.js';
import { showToast } from './toast.js';

export function AuthPage() {
  const [welcome, setWelcome] = useState(true);
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [sync, setSync] = useState(true);
  const form = useRef<HTMLFormElement>(null);
  const auth = useAuth();
  const navigate = useNavigate();
  const switchMode = (next: boolean) => {
    setRegister(next);
    setError('');
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const body = {
      username: String(data.get('username') ?? ''),
      password: String(data.get('password') ?? ''),
      device: {
        platform: 'web' as const,
        name: '网页版',
        appVersion: '0.1.0',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };
    try {
      const result = register
        ? await api.call(IdentityEndpoints.register, {
            body,
          })
        : await api.call(IdentityEndpoints.login, { body: { ...body, kind: 'app' } });
      await auth.accept(result);
      navigate(result.user.profileCompleted ? '/chat' : '/profile', { replace: true });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  if (welcome)
    return (
      <main className="auth-page wx-welcome">
        <div className="wx-welcome-brand">
          <img src="/assets/old-ui/brand/icon.png" alt="" width={72} height={72} />
          <strong>微伴</strong>
          <span>有 TA 陪你聊天</span>
        </div>
        <div className="wx-welcome-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              switchMode(false);
              setWelcome(false);
            }}
          >
            登录
          </button>
          <button
            type="button"
            className="wx-welcome-secondary"
            onClick={() => {
              switchMode(true);
              setWelcome(false);
            }}
          >
            注册
          </button>
        </div>
      </main>
    );
  return (
    <main className="auth-page wx-auth">
      <div className="wx-auth-top">
        <button
          type="button"
          className="nav-bar-icon"
          aria-label="返回"
          onClick={() => {
            form.current?.reset();
            setError('');
            setWelcome(true);
          }}
        >
          <OldIcon name="wechat/close" size={24} />
        </button>
      </div>
      <h1 className="wx-auth-title">{register ? '注册微伴号' : '微伴号登录'}</h1>
      <form ref={form} onSubmit={(event) => void submit(event)} className="wx-auth-form">
        <div className="wx-auth-fields">
          <label className="wx-auth-field">
            <span>账号</span>
            <input
              name="username"
              autoComplete="username"
              required
              minLength={4}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              placeholder={register ? '设置微伴号' : '请填写微伴号'}
            />
          </label>
          <label className="wx-auth-field">
            <span>密码</span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete={register ? 'new-password' : 'current-password'}
              placeholder={register ? '设置密码，至少 8 位' : '请填写密码'}
            />
          </label>
        </div>
        <p className="wx-auth-note">
          {register
            ? '微伴号由 4–32 位字母、数字或下划线组成，设置后用于登录。'
            : '微伴号是注册时设置的账号，由字母、数字或下划线组成。'}
        </p>
        <button type="button" className="wx-auth-link" onClick={showComingSoon}>
          用手机号登录
        </button>{' '}
        {error && (
          <p role="alert" className="wx-auth-error">
            {error}
          </p>
        )}
        <div className="wx-auth-bottom">
          {!register && (
            <button
              type="button"
              className="wx-auth-check"
              role="checkbox"
              aria-checked={sync}
              onClick={() => setSync(!sync)}
            >
              <CheckCircle checked={sync} size={16} />
              登录后同步最近的聊天记录
            </button>
          )}
          <button className="primary wx-auth-submit" disabled={pending}>
            {pending ? '请稍候…' : register ? '同意并注册' : '同意并登录'}
          </button>
          <p className="wx-auth-foot">
            <button
              type="button"
              onClick={() =>
                showToast('微伴号密码暂不支持自助找回，请联系管理员重置', 3000, 'info')
              }
            >
              找回密码
            </button>
            <i aria-hidden />
            <button type="button" onClick={() => switchMode(!register)}>
              {register ? '已有账号，登录' : '注册'}
            </button>
          </p>
        </div>
      </form>
    </main>
  );
}
