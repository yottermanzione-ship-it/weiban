import { PushSettings } from './push-settings.js';
import { HomeScreenGuide } from './home-screen-guide.js';
import { useAuth } from '../app/auth.js';
import { ComingSoonRow, MenuGroup, MenuRow, NavBar } from './shell-kit.js';
import { useAnnouncementUnread } from './release.js';

/** 设置（docs/refactor/02a 4.1）。青少年模式、关怀模式、插件按总经理要求放上，点进去是「暂未开放」。 */
export function SettingsPage() {
  const auth = useAuth();
  const announcements = useAnnouncementUnread();
  return (
    <main>
      <NavBar title="设置" fallback="/me" />
      <MenuGroup>
        <MenuRow to="/settings/security" label="账号与安全" />
      </MenuGroup>
      <MenuGroup>
        <ComingSoonRow id="teen" withIcon={false} />
        <ComingSoonRow id="care" withIcon={false} />
      </MenuGroup>
      <MenuGroup>
        <MenuRow to="/services/proactive" label="主动消息与免打扰" />
        <MenuRow to="/settings/privacy" label="隐私" />
        <MenuRow to="/settings/general" label="通用" value="主题、字号" />
      </MenuGroup>
      <PushSettings />
      <MenuGroup>
        <MenuRow to="/settings/about" label="关于微伴" dot={announcements > 0} />
        <ComingSoonRow id="plugins" withIcon={false} />
      </MenuGroup>
      <HomeScreenGuide manual />
      <MenuGroup>
        <button
          type="button"
          className="menu-row"
          onClick={() => void auth.logout().catch(() => {})}
        >
          <span className="menu-label center">退出登录</span>
        </button>
      </MenuGroup>
    </main>
  );
}
