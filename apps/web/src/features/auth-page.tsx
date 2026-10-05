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
            body: { ...body, inviteCode: String(data.get('inviteCode') ?? '') },
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
    <main className="auth-page">
      <img src="/icon.svg" className="brand-logo" alt="" />
      <h1>微伴</h1>
      <p className="subtitle">把爱豆加进你的好友列表</p>
      <form onSubmit={(event) => void submit(event)} className="panel stack">
        <h2>{register ? '邀请码注册' : '登录'}</h2>
        <label>
          微伴号
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
        <label>
          密码
          <input
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete={register ? 'new-password' : 'current-password'}
            placeholder="至少 10 位"
          />
        </label>
        {register && (
          <label>
            邀请码
            <input name="inviteCode" autoComplete="off" required minLength={6} maxLength={64} />
          </label>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={pending}>
          {pending ? '请稍候' : register ? '注册' : '登录'}
        </button>
        <button
          type="button"
          className="plain"
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register ? '已有账号，去登录' : '有邀请码？注册账号'}
        </button>
      </form>
    </main>
  );
}
