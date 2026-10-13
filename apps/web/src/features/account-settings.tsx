/*
 * 设置子页（docs/refactor/06-old-ui-spec.md 4.10）：账号与安全、隐私、通用、主动消息与免打扰。
 * 同样用 GroupHeader + MenuRow / SwitchRow。粉色主题已删除（tokens v3），通用页只留深色模式与字体大小（本机）。
 */
import { useEffect, useState, type FormEvent } from 'react';
import { IdentityEndpoints, MemorySharingEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import {
  fontScales,
  getFontScale,
  getScheme,
  setFontScale,
  setScheme,
  type Scheme,
} from '../data/display-prefs.js';
import { OldIcon } from './old-icons.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar, SwitchRow } from './shell-kit.js';
import { ChoiceSheet } from './settings.js';
import { Dialog, showToast } from './toast.js';

// ---------- 账号与安全 ----------

export function AccountSecurityPage() {
  const sessions = useRemote(IdentityEndpoints.listSessions);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function revokeSession(sessionId: string) {
    setPending(true);
    setError('');
    try {
      await api.call(IdentityEndpoints.revokeSession, { params: { sessionId } });
      sessions.refresh();
      showToast('该设备已下线', 2000, 'success');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <NavBar title="账号与安全" fallback="/settings" />
      <MenuGroup>
        <MenuRow
          label="修改密码"
          value={showChangePassword ? '收起' : undefined}
          onClick={() => setShowChangePassword((v) => !v)}
        />
      </MenuGroup>
      {showChangePassword && (
        <ChangePasswordForm
          onDone={() => {
            setShowChangePassword(false);
            showToast('密码已修改', 2000, 'success');
          }}
        />
      )}
      <GroupHeader>登录设备</GroupHeader>
      <MenuGroup>
        {sessions.data?.items.map((s) => (
          <MenuRow
            key={s.sessionId}
            label={s.device.name ?? s.device.platform ?? '未知设备'}
            subtitle={`${s.device.platform} · 最近活跃 ${new Date(s.lastActiveAt).toLocaleDateString('zh-CN')}`}
            value={s.current ? '本设备' : undefined}
            chevron={false}
            right={
              !s.current ? (
                <button
                  type="button"
                  className="inline-danger"
                  disabled={pending}
                  onClick={(event) => {
                    event.stopPropagation();
                    setRevoking(s.sessionId);
                  }}
                >
                  下线
                </button>
              ) : undefined
            }
          />
        ))}
      </MenuGroup>
      {sessions.error && <p role="alert">{sessions.error}</p>}
      {error && (
        <p role="alert" className="notice-bar">
          {error}
        </p>
      )}
      <MenuGroup>
        <MenuRow to="/settings/delete-account" label="注销账号" danger />
      </MenuGroup>
      {revoking && (
        <Dialog
          actions={[
            { label: '取消', onClick: () => setRevoking(null) },
            {
              label: '下线',
              danger: true,
              onClick: () => {
                const id = revoking;
                setRevoking(null);
                void revokeSession(id);
              },
            },
          ]}
        >
          <p>让这台设备退出登录？</p>
        </Dialog>
      )}
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
    <form onSubmit={(e) => void submit(e)}>
      <div className="field-rows">
        <label className="field-row">
          <span>当前密码</span>
          <input type="password" name="oldPassword" required autoComplete="current-password" />
        </label>
        <label className="field-row">
          <span>新密码</span>
          <input
            type="password"
            name="newPassword"
            minLength={8}
            required
            autoComplete="new-password"
            placeholder="至少 8 位"
          />
        </label>
        <label className="field-row">
          <span>确认</span>
          <input
            type="password"
            name="confirm"
            minLength={8}
            required
            autoComplete="new-password"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="error page-note">
          {error}
        </p>
      )}
      <div className="page-bottom">
        <button className="primary full" disabled={pending}>
          保存新密码
        </button>
      </div>
    </form>
  );
}

// ---------- 隐私 ----------

const sharingNames = {
  friends: '互相认识的角色之间可以聊起（默认）',
  basic: '只共享基础资料',
  off: '关闭',
} as const;

export function PrivacySettingsPage() {
  const remote = useRemote(IdentityEndpoints.getNotificationSettings);
  const sharing = useRemote(MemorySharingEndpoints.get);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function toggle(key: 'allowCharacterGroupInvites', value: boolean) {
    setPending(true);
    setError('');
    try {
      await api.call(IdentityEndpoints.updateNotificationSettings, {
        body: { [key]: value },
      });
      remote.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  function setLevel(level: 'off' | 'basic' | 'friends') {
    setPending(true);
    setError('');
    void api
      .call(MemorySharingEndpoints.update, { body: { level } })
      .then(() => sharing.refresh())
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setPending(false));
  }

  return (
    <main>
      <NavBar title="隐私" fallback="/settings" />
      <MenuGroup>
        <SwitchRow
          label="允许角色拉我进群"
          subtitle="关闭后，角色不会自动把你加入群聊"
          checked={remote.data?.allowCharacterGroupInvites ?? true}
          disabled={pending || !remote.data}
          onChange={(value) => void toggle('allowCharacterGroupInvites', value)}
        />
      </MenuGroup>
      <GroupHeader>角色之间共享我的信息</GroupHeader>
      <MenuGroup>
        {(['friends', 'basic', 'off'] as const).map((level) => (
          <MenuRow
            key={level}
            label={sharingNames[level]}
            chevron={false}
            disabled={pending || !sharing.data}
            right={
              (sharing.data?.level ?? 'friends') === level ? (
                <OldIcon name="wechat/check" size={22} className="ink-brand" />
              ) : undefined
            }
            onClick={() => setLevel(level)}
          />
        ))}
      </MenuGroup>
      <p className="hint page-note">
        开启后，互相认识的角色可能会转述你和另一个角色聊过的事；关闭后立即生效，其他角色不再使用转述来的记忆。
      </p>
      {(error || remote.error) && (
        <p role="alert" className="notice-bar">
          {error || remote.error}
        </p>
      )}
    </main>
  );
}

// ---------- 通用 ----------

const schemeNames: Record<Scheme, string> = {
  system: '跟随系统',
  light: '浅色模式',
  dark: '深色模式',
};

export function GeneralSettingsPage() {
  const [scheme, setSchemeState] = useState(getScheme);
  const [font, setFont] = useState(getFontScale);
  const [choice, setChoice] = useState<'scheme' | 'font' | null>(null);
  return (
    <main>
      <NavBar title="通用" fallback="/settings" />
      <MenuGroup>
        <MenuRow label="深色模式" value={schemeNames[scheme]} onClick={() => setChoice('scheme')} />
        <MenuRow
          label="字体大小"
          value={fontScales.find((f) => f.value === font)?.label}
          onClick={() => setChoice('font')}
        />
      </MenuGroup>
      <p className="hint page-note">深色模式和字体大小只对这台设备生效。</p>
      {choice === 'scheme' && (
        <ChoiceSheet
          title="深色模式"
          value={scheme}
          options={(['system', 'light', 'dark'] as const).map((value) => ({
            value,
            label: schemeNames[value],
          }))}
          onPick={(value) => {
            setScheme(value);
            setSchemeState(value);
          }}
          onClose={() => setChoice(null)}
        />
      )}
      {choice === 'font' && (
        <ChoiceSheet
          title="字体大小"
          value={font}
          options={fontScales.map((f) => ({ value: f.value, label: f.label }))}
          onPick={(value) => {
            setFontScale(value);
            setFont(value);
          }}
          onClose={() => setChoice(null)}
        />
      )}
    </main>
  );
}

// ---------- 主动消息与免打扰 ----------

export function ProactiveSettingsPage() {
  const remote = useRemote(IdentityEndpoints.getNotificationSettings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const data = remote.data;
  const [dnd, setDnd] = useState({ enabled: false, start: '00:00', end: '08:00' });
  useEffect(() => {
    if (data) setDnd(data.doNotDisturb);
  }, [data]);

  async function save(body: {
    proactiveMessagesEnabled?: boolean;
    proactiveCallsEnabled?: boolean;
    doNotDisturb?: { enabled: boolean; start: string; end: string };
  }) {
    setPending(true);
    setError('');
    try {
      await api.call(IdentityEndpoints.updateNotificationSettings, { body });
      remote.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <NavBar title="主动消息与免打扰" fallback="/services" />
      {data && (
        <>
          <MenuGroup>
            <SwitchRow
              label="主动消息总开关"
              subtitle="关闭后所有角色都不会主动发消息"
              checked={data.proactiveMessagesEnabled}
              disabled={pending}
              onChange={(proactiveMessagesEnabled) => void save({ proactiveMessagesEnabled })}
            />
            <SwitchRow
              label="主动来电总开关"
              subtitle="默认关闭。开启后角色可能主动发起语音通话"
              checked={data.proactiveCallsEnabled}
              disabled={pending}
              onChange={(proactiveCallsEnabled) => void save({ proactiveCallsEnabled })}
            />
          </MenuGroup>
          <GroupHeader>免打扰</GroupHeader>
          <MenuGroup>
            <SwitchRow
              label="免打扰时段"
              subtitle="时段内不发主动消息、不主动来电；你自己发消息时角色照常回复"
              checked={dnd.enabled}
              disabled={pending}
              onChange={(enabled) => {
                const next = { ...dnd, enabled };
                setDnd(next);
                void save({ doNotDisturb: next });
              }}
            />
            {dnd.enabled && (
              <>
                <label className="field-row">
                  <span>开始</span>
                  <input
                    type="time"
                    value={dnd.start}
                    disabled={pending}
                    onChange={(e) => setDnd({ ...dnd, start: e.target.value })}
                    onBlur={() => void save({ doNotDisturb: dnd })}
                  />
                </label>
                <label className="field-row">
                  <span>结束</span>
                  <input
                    type="time"
                    value={dnd.end}
                    disabled={pending}
                    onChange={(e) => setDnd({ ...dnd, end: e.target.value })}
                    onBlur={() => void save({ doNotDisturb: dnd })}
                  />
                </label>
              </>
            )}
          </MenuGroup>
        </>
      )}
      {(remote.error || error) && (
        <p role="alert" className="notice-bar">
          {remote.error || error}
        </p>
      )}
    </main>
  );
}
