import { Link } from 'react-router-dom';
import { CaretRight } from '@phosphor-icons/react';
import { PushSettings } from './push-settings.js';
import { HomeScreenGuide } from './home-screen-guide.js';
import { useAuth } from '../app/auth.js';

export function SettingsPage() {
  const auth = useAuth();
  return (
    <main>
      <h1 className="page-title">设置</h1>
      <div className="panel rows">
        <Link to="/settings/security">
          账号与安全
          <CaretRight />
        </Link>
        <Link to="/settings/general">
          通用（主题、字号）
          <CaretRight />
        </Link>
        <Link to="/settings/privacy">
          隐私
          <CaretRight />
        </Link>
        <Link to="/services/proactive">
          主动消息与免打扰
          <CaretRight />
        </Link>
      </div>
      <PushSettings />
      <HomeScreenGuide manual />
      <button className="panel full" onClick={() => void auth.logout().catch(() => {})}>
        退出登录
      </button>
    </main>
  );
}
