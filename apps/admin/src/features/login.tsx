import { useState, type FormEvent } from 'react';
import { IdentityEndpoints, type AuthResponse } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
export function LoginPage({ onLogin }: { onLogin: (auth: AuthResponse) => void }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const auth = await api.call(IdentityEndpoints.login, {
        body: {
          username: String(form.get('username')),
          password: String(form.get('password')),
          kind: 'admin',
          device: {
            platform: 'web',
            name: '管理后台',
            appVersion: '0.1.0',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
      });
      await api.authenticate(auth);
      onLogin(auth);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="login">
      <h1>微伴管理后台</h1>
      <form className="panel stack" onSubmit={(e) => void submit(e)}>
        <label>
          管理员账号
          <input name="username" required autoComplete="username" />
        </label>
        <label>
          密码
          <input
            name="password"
            required
            type="password"
            autoComplete="current-password"
            minLength={10}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={pending}>
          登录
        </button>
      </form>
    </main>
  );
}
