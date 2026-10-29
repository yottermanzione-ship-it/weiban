import { SupportRow } from './support.js';
import { HistoryRecoveryRow } from './history-recovery.js';
/*
 * 设置（docs/refactor/06-old-ui-spec.md 4.10）：每组前有分组标题；普通行 MenuRow，带说明的开关用 SwitchRow；
 * 选择类（深色模式、字体大小、提示音）用单列单选弹层，选中项右侧绿色 ✓。
 * 深色模式、字体大小、提示音是每台设备自己的设置（PRD SVC-01），存本机。粉色主题已删除（tokens v3）。
 */
import { useEffect, useState } from 'react';
import { IdentityEndpoints } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { HomeScreenGuide } from './home-screen-guide.js';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import {
  fontScales,
  getFontScale,
  getScheme,
  getCharacterStatusVisible,
  setCharacterStatusVisible,
  getReadReceiptVisible,
  setReadReceiptVisible,
  setFontScale,
  setScheme,
  type Scheme,
} from '../data/display-prefs.js';
import { enableWebPush, disableWebPush } from '../notifications/client.js';
import { OldIcon } from './old-icons.js';
import {
  getMessageSoundEnabled,
  getNoticeSound,
  noticeSounds,
  previewNoticeSound,
  setMessageSoundEnabled,
  setNoticeSound,
} from './message-sound.js';
import {
  CheckSlot,
  ChoiceSheet as SharedChoiceSheet,
  ComingSoonRow,
  GroupHeader,
  MenuGroup,
  MenuRow,
  NavBar,
  SwitchRow,
} from './shell-kit.js';
import { useAnnouncementUnread } from './release.js';
import { AlertDialog, showToast } from './toast.js';
import { SubPageLayer } from './edit-page.js';

const schemeNames: Record<Scheme, string> = {
  system: '跟随系统',
  light: '浅色模式',
  dark: '深色模式',
};
const sounds = noticeSounds;

/** 设置里的单选：公共 Choice Sheet（shell-kit，26 号 §2）。 */
export function ChoiceSheet<T extends string | number>({
  title,
  value,
  options,
  onPick,
  onClose,
}: {
  title: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onPick(value: T): void;
  onClose(): void;
}) {
  return (
    <SharedChoiceSheet
      title={title}
      value={value}
      options={options}
      onChange={onPick}
      onClose={onClose}
    />
  );
}

/**
 * 提示音（U2，sheet-audit 第 13 项）：整页二级页面。每行「名称 …… 试听 ✓」：试听按钮和对号各占固定一列，
 * 所有行上下对齐；试听按钮和整行选择是两个并列按钮（不再按钮套按钮）。点一行即试听并选中，「完成」才保存。
 */
function SoundPage({
  value,
  onSave,
  onClose,
}: {
  value: string;
  onSave(value: string): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(value);
  const preview = (sound: string) =>
    void previewNoticeSound(sound).catch(() => showToast('当前浏览器无法试听'));
  return (
    <SubPageLayer
      title="提示音"
      canSave={draft !== value}
      onCancel={onClose}
      onSave={() => {
        onSave(draft);
        onClose();
      }}
    >
      <div className="sound-list" role="radiogroup" aria-label="提示音">
        {sounds.map((s) => (
          <div key={s.value} className="sound-row">
            <button
              type="button"
              role="radio"
              aria-checked={draft === s.value}
              className="pick-row sound-pick"
              onClick={() => {
                setDraft(s.value);
                preview(s.value);
              }}
            >
              <span>{s.label}</span>
              <span className="sound-play-slot" aria-hidden />
              <CheckSlot checked={draft === s.value} size={22} />
            </button>
            <button
              type="button"
              className="sound-play"
              aria-label={`试听${s.label}`}
              onClick={() => preview(s.value)}
            >
              <OldIcon name="wechat/voice" size={20} />
            </button>
          </div>
        ))}
      </div>
    </SubPageLayer>
  );
}

async function pushEnabled(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return !!(await registration?.pushManager?.getSubscription());
}

export function SettingsPage() {
  const auth = useAuth();
  const announcements = useAnnouncementUnread();
  const notification = useRemote(IdentityEndpoints.getNotificationSettings);
  const [push, setPush] = useState(false);
  const [pending, setPending] = useState(false);
  const [scheme, setSchemeState] = useState(getScheme);
  const [font, setFont] = useState(getFontScale);
  const [statusVisible, setStatusVisible] = useState(getCharacterStatusVisible);
  const [readVisible, setReadVisible] = useState(getReadReceiptVisible);
  const [sound, setSound] = useState(getNoticeSound);
  const [messageSound, setMessageSound] = useState(getMessageSoundEnabled);
  const [choice, setChoice] = useState<'scheme' | 'font' | 'sound' | null>(null);
  const [logout, setLogout] = useState(false);
  useEffect(() => {
    void pushEnabled()
      .then(setPush)
      .catch(() => {});
  }, []);
  async function togglePush(enable: boolean) {
    setPending(true);
    try {
      if (enable) await enableWebPush();
      else await disableWebPush();
      setPush(enable);
      showToast(enable ? '已开启此设备通知' : '已关闭此设备通知', 2000, 'success');
    } catch (e) {
      showToast(
        e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : '通知设置暂未完成',
      );
    } finally {
      setPending(false);
    }
  }
  async function updateNotification(body: {
    pushShowContent?: boolean;
    pushSoundEnabled?: boolean;
  }) {
    setPending(true);
    try {
      await api.call(IdentityEndpoints.updateNotificationSettings, { body });
      notification.refresh();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <NavBar title="设置" fallback="/me" />
      <GroupHeader>账号</GroupHeader>
      <MenuGroup>
        <MenuRow to="/settings/security" label="账号与安全" />
      </MenuGroup>
      <GroupHeader>通知</GroupHeader>
      <MenuGroup>
        <SwitchRow
          label="新消息通知"
          subtitle="接收角色回复和好友通过提醒（只对这台设备）"
          checked={push}
          disabled={pending}
          onChange={(value) => void togglePush(value)}
        />
        {notification.data && (
          <SwitchRow
            label="通知显示消息内容"
            checked={notification.data.pushShowContent}
            disabled={pending}
            onChange={(pushShowContent) => void updateNotification({ pushShowContent })}
          />
        )}
        {notification.data && (
          <SwitchRow
            label="通知声音"
            checked={notification.data.pushSoundEnabled}
            disabled={pending}
            onChange={(pushSoundEnabled) => void updateNotification({ pushSoundEnabled })}
          />
        )}
        <SwitchRow
          label="消息提示音"
          subtitle="聊天界面消息收发提示音"
          checked={messageSound}
          onChange={(value) => {
            setMessageSoundEnabled(value);
            setMessageSound(value);
          }}
        />
        {messageSound && (
          <MenuRow
            label="提示音"
            value={sounds.find((s) => s.value === sound)?.label}
            onClick={() => setChoice('sound')}
          />
        )}
      </MenuGroup>
      <GroupHeader>隐私</GroupHeader>
      <MenuGroup>
        <MenuRow to="/settings/privacy" label="角色之间共享我的信息" />
        <MenuRow to="/services/period/settings" label="经期日记相关" />
      </MenuGroup>
      <GroupHeader>通用</GroupHeader>
      <MenuGroup>
        <SwitchRow
          label="角色状态表情"
          subtitle="在资料昵称和私聊标题旁显示当天已有的状态"
          checked={statusVisible}
          onChange={(visible) => {
            setCharacterStatusVisible(visible);
            setStatusVisible(visible);
          }}
        />
        <SwitchRow
          label="显示消息已读状态"
          subtitle="关闭后，私聊气泡下不再显示「已读」「已送达」"
          checked={readVisible}
          onChange={(visible) => {
            setReadReceiptVisible(visible);
            setReadVisible(visible);
          }}
        />
        <MenuRow label="深色模式" value={schemeNames[scheme]} onClick={() => setChoice('scheme')} />
        <MenuRow
          label="字体大小"
          value={fontScales.find((f) => f.value === font)?.label}
          onClick={() => setChoice('font')}
        />
        <HistoryRecoveryRow />
        <MenuRow label="聊天背景" onClick={() => showToast('暂未开放', 2000, 'info')} />
        <ComingSoonRow id="teen" withIcon={false} />
        <ComingSoonRow id="care" withIcon={false} />
        <MenuRow to="/models" label="模型配置" />
        <MenuRow to="/settings/plugins" label="插件" />
      </MenuGroup>
      <GroupHeader>关于</GroupHeader>
      <MenuGroup>
        <MenuRow to="/help/guide" label="新手引导" />
        <SupportRow />
        <MenuRow to="/settings/about" label="关于微伴" dot={announcements > 0} />
      </MenuGroup>
      <HomeScreenGuide manual />
      <MenuGroup>
        <MenuRow label="退出登录" danger center chevron={false} onClick={() => setLogout(true)} />
      </MenuGroup>
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
      {choice === 'sound' && (
        <SoundPage
          value={sound}
          onSave={(value) => {
            setNoticeSound(value as typeof sound);
            setSound(value as typeof sound);
          }}
          onClose={() => setChoice(null)}
        />
      )}
      {logout && (
        <AlertDialog
          title="退出登录？"
          message="退出后不会删除任何数据，下次登录仍可使用。"
          confirmLabel="退出登录"
          onCancel={() => setLogout(false)}
          onConfirm={() => {
            setLogout(false);
            void auth.logout().catch(() => {});
          }}
        />
      )}
    </main>
  );
}
