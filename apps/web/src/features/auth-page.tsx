import { useState, type FormEvent } from 'react';
import { IdentityEndpoints } from '@weiban/contracts';
import { useNavigate } from 'react-router-dom';
import { api } from '../data/client.js';
import { useAuth } from '../app/auth.js';
import { friendlyError } from '../data/use-remote.js';
export function AuthPage() {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const auth = useAuth();
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const data = new FormData(event.currentTarget);
    // 邀请码选填（2026-10-12）：没填就不带这个字段
    const inviteCode = String(data.get('inviteCode') ?? '').trim();
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
            body: { ...body, ...(inviteCode ? { inviteCode } : {}) },
          })
        : await api.call(IdentityEndpoints.login, { body: { ...body, kind: 'app' } });
      await auth.accept(result);
      navigate(result.user.profileCompleted ? '/me' : '/profile', { replace: true });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="auth-page old-auth">
      <div className="auth-watermark" aria-hidden />
      <div className="auth-content">
        <img src="/assets/old-ui/brand/weiban_logo.png" className="auth-logo" alt="" />
        <h1 className="auth-wordmark">微伴</h1>
        <form onSubmit={(event) => void submit(event)} className="auth-form">
          <label className="line-field">
            <span>微伴号</span>
            <input
              name="username"
              autoComplete="username"
              required
              minLength={4}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              placeholder="4–32 位字母、数字或下划线"
            />
          </label>
          <label className="line-field">
            <span>密码</span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete={register ? 'new-password' : 'current-password'}
              placeholder="至少 8 位"
            />
          </label>
          {register && (
            <label className="line-field">
              <span>邀请码（选填）</span>
              <input
                name="inviteCode"
                autoComplete="off"
                minLength={6}
                maxLength={64}
                placeholder="有就填，填了可得注册赠送"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <button className="primary auth-submit" disabled={pending}>
            {pending ? '请稍候' : register ? '注册' : '登录'}
          </button>
          <div className="auth-links">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? '已有账号，去登录' : '注册新账号'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
