import { useState, type FormEvent } from 'react';
import { IdentityEndpoints } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';

// ---------- Account Security ----------

export function AccountSecurityPage() {
  const sessions = useRemote(IdentityEndpoints.listSessions);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showChangePassword, setShowChangePassword] = useState(false);

  async function revokeSession(sessionId: string) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await api.call(IdentityEndpoints.revokeSession, { params: { sessionId } });
      sessions.refresh();
      setMessage('该设备已下线');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1 className="page-title">账号与安全</h1>

      <div className="panel rows">
        <button onClick={() => setShowChangePassword((v) => !v)}>
          {showChangePassword ? '收起' : '修改密码'}
        </button>
      </div>

      {showChangePassword && (
        <ChangePasswordForm
          onDone={() => {
            setShowChangePassword(false);
            setMessage('密码已修改');
          }}
        />
      )}

      <section className="panel stack">
        <h2>登录设备</h2>
        {sessions.error && <p role="alert">{sessions.error}</p>}
        {sessions.data?.items.map((s) => (
          <div key={s.sessionId} className="session-row">
            <div>
              <strong>{s.device.name ?? s.device.platform ?? '未知设备'}</strong>
              <p className="hint">
                {s.device.platform} · 最近活跃{' '}
                {new Date(s.lastActiveAt).toLocaleDateString('zh-CN')}
              </p>
              {s.current && <span className="badge">本设备</span>}
            </div>
            {!s.current && (
              <button
                disabled={pending}
                onClick={() => void revokeSession(s.sessionId)}
                className="danger-btn"
              >
                踢下线
              </button>
            )}
          </div>
        ))}
      </section>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}

      <DeleteAccountSection />
    </main>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get('newPassword'));
    const confirm = String(form.get('confirm'));
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setPending(true);
    setError('');
    try {
      // changePassword endpoint not yet in contracts — filed as contract change request in handoff
      throw Object.assign(new Error('接口待后端实现，请等待后续版本'), { code: 'not_implemented' });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
    void onDone;
  }

  return (
    <form className="panel stack" onSubmit={(e) => void submit(e)}>
      <h2>修改密码</h2>
      <label>
        当前密码
        <input type="password" name="oldPassword" required autoComplete="current-password" />
      </label>
      <label>
        新密码（至少 10 位）
        <input
          type="password"
          name="newPassword"
          minLength={10}
          required
          autoComplete="new-password"
        />
      </label>
      <label>
        确认新密码
        <input type="password" name="confirm" minLength={10} required autoComplete="new-password" />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={pending}>
        保存新密码
      </button>
    </form>
  );
}

function DeleteAccountSection() {
  const auth = useAuth();
  const [step, setStep] = useState<'idle' | 'confirm' | 'pending'>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    setStep('pending');
    setError('');
    try {
      await api.call(IdentityEndpoints.deleteAccount, {
        body: { password, confirm: 'DELETE' },
      });
      await auth.logout();
    } catch (e) {
      const msg = friendlyError(e);
      // Per ACC-06 v1.4: password error keeps user logged in, stays on page
      setError(msg.includes('invalid_credentials') ? '密码错误，请重新输入' : msg);
      setStep('confirm');
    }
  }

  if (step === 'idle') {
    return (
      <div className="panel rows">
        <button className="danger-btn" onClick={() => setStep('confirm')}>
          注销账号
        </button>
      </div>
    );
  }

  return (
    <form className="panel stack" onSubmit={(e) => void submit(e)}>
      <h2>确认注销账号</h2>
      <p className="warn">注销后所有聊天、记忆、余额将被删除，不可恢复。</p>
      <label>
        请输入密码确认
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          aria-describedby="delete-error"
        />
      </label>
      {error && (
        <p id="delete-error" role="alert" className="error">
          {error}
        </p>
      )}
      <button className="danger-btn primary" disabled={step === 'pending'}>
        确认注销
      </button>
      <button
        type="button"
        onClick={() => {
          setStep('idle');
          setError('');
        }}
      >
        取消
      </button>
    </form>
  );
}

// ---------- Privacy Settings ----------

export function PrivacySettingsPage() {
  const remote = useRemote(IdentityEndpoints.getNotificationSettings);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function toggle(key: 'allowCharacterGroupInvites', value: boolean) {
    setPending(true);
    setError('');
    try {
      await api.call(IdentityEndpoints.updateNotificationSettings, {
        body: { [key]: value },
      });
      remote.refresh();
      setMessage('已保存');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1 className="page-title">隐私</h1>
      <div className="panel stack">
        <label className="check">
          <input
            type="checkbox"
            checked={remote.data?.allowCharacterGroupInvites ?? true}
            disabled={pending || !remote.data}
            onChange={(e) => void toggle('allowCharacterGroupInvites', e.target.checked)}
          />
          允许角色拉我进群
        </label>
        <p className="hint">关闭后，角色不会自动把你加入群聊。</p>
        <p className="hint">跨角色记忆共享（MEM-07）等更多隐私设置将在后续版本中添加。</p>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {remote.error && <p role="alert">{remote.error}</p>}
    </main>
  );
}

// ---------- General Settings ----------

export function GeneralSettingsPage() {
  const prefs = useRemote(IdentityEndpoints.getPreferences);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function setTheme(value: 'green' | 'pink') {
    setPending(true);
    try {
      const result = await api.call(IdentityEndpoints.updatePreferences, {
        body: { theme: value },
      });
      document.documentElement.dataset.theme = result.theme;
      window.dispatchEvent(new Event('weiban:settings-updated'));
      prefs.refresh();
      setMessage('主题已保存，会同步到其他设备');
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1 className="page-title">通用</h1>
      <div className="panel stack">
        <h2>主题</h2>
        <div className="theme-options">
          <button
            disabled={pending}
            aria-pressed={prefs.data?.theme === 'green'}
            onClick={() => void setTheme('green')}
          >
            默认（接近微信）
          </button>
          <button
            disabled={pending}
            aria-pressed={prefs.data?.theme === 'pink'}
            onClick={() => void setTheme('pink')}
          >
            微伴粉
          </button>
        </div>
        <p className="hint">主题会同步到你登录的所有设备。</p>
        <p role="status">{message || prefs.error}</p>
      </div>
      <div className="panel stack">
        <h2>无障碍</h2>
        <p className="hint">字体大小等更多设置将在后续版本中添加。</p>
      </div>
    </main>
  );
}

// ---------- Proactive Messages Settings ----------

export function ProactiveSettingsPage() {
  const remote = useRemote(IdentityEndpoints.getNotificationSettings);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      await api.call(IdentityEndpoints.updateNotificationSettings, {
        body: {
          proactiveMessagesEnabled: form.get('proactiveMessages') === 'on',
          proactiveCallsEnabled: form.get('proactiveCalls') === 'on',
          doNotDisturb: {
            enabled: form.get('dndEnabled') === 'on',
            start: String(form.get('dndStart') || '00:00'),
            end: String(form.get('dndEnd') || '08:00'),
          },
        },
      });
      remote.refresh();
      setMessage('已保存');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  const data = remote.data;

  return (
    <main>
      <h1 className="page-title">主动消息设置</h1>
      <p className="hint notice">
        设置已保存，实际主动能力随 L3 上线。当前设置会在功能上线后生效。
      </p>
      {data && (
        <form key={data.updatedAt} className="panel stack" onSubmit={(e) => void save(e)}>
          <label className="check">
            <input
              type="checkbox"
              name="proactiveMessages"
              defaultChecked={data.proactiveMessagesEnabled}
            />
            主动消息总开关
          </label>
          <p className="hint">关闭后所有角色都不会主动发消息。</p>

          <label className="check">
            <input
              type="checkbox"
              name="proactiveCalls"
              defaultChecked={data.proactiveCallsEnabled}
            />
            主动来电总开关
          </label>
          <p className="hint">默认关闭。开启后角色可能主动发起语音通话。</p>

          <label className="check">
            <input type="checkbox" name="dndEnabled" defaultChecked={data.doNotDisturb.enabled} />
            免打扰时段
          </label>
          <div className="time-range">
            <label>
              开始
              <input type="time" name="dndStart" defaultValue={data.doNotDisturb.start} />
            </label>
            <span aria-hidden="true">–</span>
            <label>
              结束
              <input type="time" name="dndEnd" defaultValue={data.doNotDisturb.end} />
            </label>
          </div>
          <p className="hint">时段内不发主动消息、不主动来电；你自己发消息时角色照常回复。</p>

          <button className="primary" disabled={pending}>
            保存
          </button>
        </form>
      )}
      {remote.error && <p role="alert">{remote.error}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}
