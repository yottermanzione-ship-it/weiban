import { useEffect, useState } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import { ChatsCircle, AddressBook, Compass, User, CaretLeft } from '@phosphor-icons/react';
import { IdentityEndpoints } from '@weiban/contracts';
import { ConversationListPage } from '../features/conversation-list.js';
import { ConversationPage } from '../features/chat.js';
import { ChatSettingsPage } from '../features/chat-settings.js';
import { ContactsPage, DiscoverPage, CharacterPage } from '../features/contacts.js';
import { ChatProvider } from './chat.js';
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
  const [searchParams] = useSearchParams();
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
    window.addEventListener('weiban:settings-updated', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('weiban:settings-updated', refresh);
    };
  }, [auth.session]);
  if (auth.loading)
    return (
      <main className="empty" role="status">
        正在打开微伴…
      </main>
    );
  if (!auth.session) return <AuthPage />;
  const firstProfile = !auth.session.user.profileCompleted;
  const onboarding = auth.onboarding || firstProfile || searchParams.get('onboarding') === '1';
  if (!firstProfile && auth.onboarding && ['/', '/chat'].includes(location.pathname))
    return <Navigate to="/discover?onboarding=1" replace />;
  if (firstProfile && location.pathname !== '/profile') return <Navigate to="/profile" replace />;
  const roots = ['/chat', '/contacts', '/discover', '/me'];
  return (
    <div
      className="app-shell"
      key={`${auth.session.user.userId}:${auth.session.session.sessionId}`}
    >
      {firstProfile && (
        <header className="topbar">
          <button onClick={() => void auth.logout()}>‹ 返回登录</button>
        </header>
      )}
      {offline && (
        <div role="status" className="offline">
          网络暂不可用，正在显示本机保存的内容
        </div>
      )}
      {!onboarding &&
        !roots.includes(location.pathname) &&
        !location.pathname.startsWith('/chat/') && (
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
            <Navigate to={auth.session.user.profileCompleted ? '/chat' : '/profile'} replace />
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
        <Route path="/chat" element={<ConversationListPage />} />
        <Route path="/chat/:conversationId" element={<ConversationPage />} />
        <Route path="/chat/:conversationId/settings" element={<ChatSettingsPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/characters/:characterId" element={<CharacterPage />} />
        <Route path="*" element={<Navigate to="/me" replace />} />
      </Routes>
      {!onboarding && !location.pathname.startsWith('/chat/') && (
        <nav className="tabbar" aria-label="主导航">
          {(
            [
              ['/chat', '微伴', ChatsCircle],
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
      )}
    </div>
  );
}
export function App() {
  return (
    <AuthProvider>
      <UpdatePrompt />
      <ChatProvider>
        <Shell />
      </ChatProvider>
    </AuthProvider>
  );
}
