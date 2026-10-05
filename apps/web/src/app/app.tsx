import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ChatsCircle, AddressBook, Compass, User, CaretLeft } from '@phosphor-icons/react';
import { IdentityEndpoints } from '@weiban/contracts';
import { AuthProvider, useAuth } from './auth.js';
import { AuthPage } from '../features/auth-page.js';
import { MePage, ServicesPage } from '../features/me.js';
import { ProfilePage } from '../features/profile.js';
import { SettingsPage } from '../features/settings.js';
import { WalletPage, LedgerPage, PricesPage } from '../features/wallet.js';
import { ModelsPage } from '../features/models.js';
import { api } from '../data/client.js';
import { UpdatePrompt } from './update-prompt.js';
function Shell() {
  const auth = useAuth();
  const location = useLocation();
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    if (!auth.session) return;
    let active = true;
    const refresh = () =>
      void api
        .call(IdentityEndpoints.getPreferences)
        .then((p) => {
          if (active) document.documentElement.dataset.theme = p.theme;
        })
        .catch(() => {});
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [auth.session]);
  if (auth.loading)
    return (
      <main className="empty" role="status">
        正在打开微伴…
      </main>
    );
  if (!auth.session) return <AuthPage />;
  const roots = ['/chat', '/contacts', '/discover', '/me'];
  return (
    <div className="app-shell">
      {offline && (
        <div role="status" className="offline">
          网络暂不可用，正在显示本机保存的内容
        </div>
      )}
      {!roots.includes(location.pathname) && (
        <header className="topbar">
          <Link
            to={
              ['/wallet', '/models', '/ledger', '/prices'].includes(location.pathname)
                ? '/services'
                : '/me'
            }
            aria-label="返回"
          >
            <CaretLeft size={24} />
            返回
          </Link>
        </header>
      )}
      <Routes>
        <Route
          path="/"
          element={
            <Navigate to={auth.session.user.profileCompleted ? '/me' : '/profile'} replace />
          }
        />
        <Route path="/me" element={<MePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/prices" element={<PricesPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route
          path="/chat"
          element={
            <main>
              <h1 className="page-title">聊天</h1>
              <p className="empty">还没有聊天，去添加一位角色吧</p>
              <Link className="plain" to="/discover">
                去发现
              </Link>
            </main>
          }
        />
        <Route
          path="/contacts"
          element={
            <main>
              <h1 className="page-title">通讯录</h1>
              <p className="empty">还没有添加角色</p>
            </main>
          }
        />
        <Route
          path="/discover"
          element={
            <main>
              <h1 className="page-title">发现</h1>
              <p className="empty">角色广场即将开放</p>
            </main>
          }
        />
        <Route path="*" element={<Navigate to="/me" replace />} />
      </Routes>
      <nav className="tabbar" aria-label="主导航">
        {(
          [
            ['/chat', '聊天', ChatsCircle],
            ['/contacts', '通讯录', AddressBook],
            ['/discover', '发现', Compass],
            ['/me', '我', User],
          ] as const
        ).map(([to, label, Icon]) => (
          <NavLink key={to} to={to}>
            <Icon size={24} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
export function App() {
  return (
    <AuthProvider>
      <UpdatePrompt />
      <Shell />
    </AuthProvider>
  );
}
