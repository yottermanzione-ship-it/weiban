import { PushSettings } from './push-settings.js';
import { useState } from 'react';
import { IdentityEndpoints } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
export function SettingsPage() {
  const prefs = useRemote(IdentityEndpoints.getPreferences);
  const auth = useAuth();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  async function theme(value: 'green' | 'pink') {
    setPending(true);
    try {
      const result = await api.call(IdentityEndpoints.updatePreferences, {
        body: { theme: value },
      });
      document.documentElement.dataset.theme = result.theme;
      prefs.refresh();
      setMessage('已保存，主题会同步到其他设备');
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <h1 className="page-title">设置</h1>
      <div className="panel stack">
        <h2>主题</h2>
        <div className="theme-options">
          <button
            disabled={pending}
            aria-pressed={prefs.data?.theme === 'green'}
            onClick={() => void theme('green')}
          >
            默认
          </button>
          <button
            disabled={pending}
            aria-pressed={prefs.data?.theme === 'pink'}
            onClick={() => void theme('pink')}
          >
            微伴粉
          </button>
        </div>
        <p className="hint">主题会同步到你登录的所有设备。</p>
        <p role="status">{message || prefs.error}</p>
      </div>
      <PushSettings />
      <button className="panel full" onClick={() => void auth.logout().catch(() => {})}>
        退出登录
      </button>
    </main>
  );
}
