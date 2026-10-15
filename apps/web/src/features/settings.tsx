import { HistoryRecoveryRow } from './history-recovery.js';
/*
 * 设置（docs/refactor/06-old-ui-spec.md 4.10）：每组前有分组标题；普通行 MenuRow，带说明的开关用 SwitchRow；
 * 选择类（深色模式、字体大小、提示音）用单列单选弹层，选中项右侧绿色 ✓。
 * 深色模式、字体大小、提示音是每台设备自己的设置（PRD SVC-01），存本机。粉色主题已删除（tokens v3）。
 */
import { useEffect, useState, type ReactNode } from 'react';
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
  setFontScale,
  setScheme,
  type Scheme,
} from '../data/display-prefs.js';
import { enableWebPush, disableWebPush } from '../notifications/client.js';
import { OldIcon } from './old-icons.js';
import {
  ComingSoonRow,
  GroupHeader,
  MenuGroup,
  MenuRow,
  NavBar,
  Sheet,
  SwitchRow,
} from './shell-kit.js';
import { useAnnouncementUnread } from './release.js';
import { Dialog, showToast } from './toast.js';

const schemeNames: Record<Scheme, string> = {
  system: '跟随系统',
  light: '浅色模式',
  dark: '深色模式',
};
const SOUND_KEY = 'weiban:notice-sound';
const sounds = [
  { value: 'iphone', label: 'IOS提示音', file: '/assets/old-ui/audio/notice_iphone.ogg' },
  { value: 'pc', label: 'PC提示音', file: '/assets/old-ui/audio/notice_pc.ogg' },
] as const;
function readSound(): string {
  try {
    return localStorage.getItem(SOUND_KEY) ?? 'iphone';
  } catch {
    return 'iphone';
  }
}

/** 单选列表弹层：每项 56，文字左对齐，选中项右侧绿色 ✓。 */
export function ChoiceSheet<T extends string | number>({
  title,
  value,
  options,
  onPick,
  onClose,
  extra,
}: {
  title: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onPick(value: T): void;
  onClose(): void;
  extra?: (value: T) => ReactNode;
}) {
  return (
    <Sheet title={title} onClose={onClose} closeLabel="取消">
      <MenuGroup>
        {options.map((option) => (
          <MenuRow
            key={String(option.value)}
            label={option.label}
            chevron={false}
            right={
              <>
                {extra?.(option.value)}
                {option.value === value && (
                  <OldIcon name="wechat/check" size={22} className="ink-brand" />
                )}
              </>
            }
            onClick={() => {
              onPick(option.value);
              onClose();
            }}
          />
        ))}
      </MenuGroup>
    </Sheet>
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
  const [sound, setSound] = useState(readSound);
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
            label="声音"
            checked={notification.data.pushSoundEnabled}
            disabled={pending}
            onChange={(pushSoundEnabled) => void updateNotification({ pushSoundEnabled })}
          />
        )}
        <MenuRow
          label="提示音"
          value={sounds.find((s) => s.value === sound)?.label}
          onClick={() => setChoice('sound')}
        />
        <MenuRow to="/services/proactive" label="主动消息与免打扰" />
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
          subtitle="在资料昵称旁显示当天已有的状态"
          checked={statusVisible}
          onChange={(visible) => {
            setCharacterStatusVisible(visible);
            setStatusVisible(visible);
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
        <ComingSoonRow id="plugins" withIcon={false} />
      </MenuGroup>
      <GroupHeader>关于</GroupHeader>
      <MenuGroup>
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
        <ChoiceSheet
          title="提示音"
          value={sound}
          options={sounds.map((s) => ({ value: s.value as string, label: s.label }))}
          onPick={(value) => {
            try {
              localStorage.setItem(SOUND_KEY, value);
            } catch {
              // 无痕模式：只在本次打开时生效
            }
            setSound(value);
          }}
          extra={(value) => (
            <button
              type="button"
              className="nav-bar-icon"
              aria-label="试听"
              onClick={(event) => {
                event.stopPropagation();
                const file = sounds.find((s) => s.value === value)?.file;
                if (file) void new Audio(file).play().catch(() => showToast('当前浏览器无法试听'));
              }}
            >
              <OldIcon name="wechat/voice" size={20} />
            </button>
          )}
          onClose={() => setChoice(null)}
        />
      )}
      {logout && (
        <Dialog
          actions={[
            { label: '取消', onClick: () => setLogout(false) },
            {
              label: '退出',
              danger: true,
              onClick: () => {
                setLogout(false);
                void auth.logout().catch(() => {});
              },
            },
          ]}
        >
          <p>退出后不会删除任何数据，下次登录仍可使用</p>
        </Dialog>
      )}
    </main>
  );
}
