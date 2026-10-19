import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ProLayout } from '@ant-design/pro-components';
import { App as AntApp, Dropdown, Spin } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { IdentityEndpoints, type AuthResponse } from '@weiban/contracts';
import { api } from '../data/client.js';
import { LoginPage } from '../features/login.js';
import { DashboardPage } from '../features/dashboard.js';
import { AccountsPage } from '../features/accounts.js';
import { MembershipPage } from '../features/membership.js';
import { RechargePage } from '../features/recharge.js';
import { ModelManagementPage } from '../features/model-management.js';
import { PricesPage } from '../features/prices.js';
import { AlertsPage } from '../features/alerts.js';
import { CharactersPage } from '../features/characters.js';
import { UsagePage } from '../features/usage.js';
import { BillingPage } from '../features/billing.js';
import { ScenarioModesPage } from '../features/scenario-modes.js';
import { PublicUpdatesPage } from '../features/public-updates.js';
import { AnnouncementsPage, ReleaseNotesPage, VersionPoliciesPage } from '../features/releases.js';
import { HolidaysPage } from '../features/holidays.js';
import { SymptomTagsPage } from '../features/symptom-tags.js';
import { RelationsPage } from '../features/relations.js';
import {
  CardTemplatesPage,
  StickerLibraryPage,
  VoiceLibraryPage,
  WorkLinksPage,
} from '../features/media-library.js';
import { AccountDeletionsPage, PetSpeciesPage } from '../features/pets-deletions.js';
import { DailyQuestionsPage, PlazaAdminPage } from '../features/plaza-admin.js';
import { PlannerPage } from '../features/planner.js';
import { RoleRequestsPage } from '../features/role-requests.js';
import { SupportAdminPage } from '../features/support.js';
import { MENU, badgeOf, groupBadge } from './menu.js';
import { TodoProvider, useTodos } from './todos.js';

function Logo() {
  return <div className="admin-logo">伴</div>;
}

export function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  // 开发模式下 React 会把 effect 跑两遍。引导过程只跑一次（复用同一个 Promise），
  // 否则第二次 updateUser 会换掉 auth 对象，让页面上正在飞的请求误判「登录状态已改变」。
  const bootstrap = useRef<Promise<AuthResponse | null> | null>(null);

  useEffect(() => {
    bootstrap.current ??= (async () => {
      try {
        let session = await api.restore();
        if (session) {
          try {
            session = await api.updateUser(await api.call(IdentityEndpoints.me));
          } catch {
            session = await api.restore();
          }
        }
        if (session?.session.kind !== 'admin' || session.user.role !== 'admin') {
          await api.forget();
          session = null;
        }
        return session;
      } catch {
        return null;
      }
    })();
    let active = true;
    void bootstrap.current
      .then((session) => {
        if (active) setAuth(session);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const expired = () => setAuth(null);
    window.addEventListener('weiban-admin:unauthenticated', expired);
    return () => {
      active = false;
      window.removeEventListener('weiban-admin:unauthenticated', expired);
    };
  }, []);

  async function logout() {
    try {
      await api.call(IdentityEndpoints.logout);
    } finally {
      await api.forget();
      setAuth(null);
    }
  }

  if (loading) {
    return (
      <div className="boot-screen">
        <Spin size="large" />
        <p>正在打开管理后台…</p>
      </div>
    );
  }
  if (!auth) return <LoginPage onLogin={setAuth} />;

  return (
    <TodoProvider>
      <AdminShell
        username={auth.user.username}
        pathname={location.pathname}
        onNavigate={(path) => navigate(path)}
        onLogout={() => void logout().catch(() => {})}
      />
    </TodoProvider>
  );
}

function AdminShell({
  username,
  pathname,
  onNavigate,
  onLogout,
}: {
  username: string;
  pathname: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  const { counts } = useTodos();
  const { message } = AntApp.useApp();

  const decorated = MENU.map((item) => {
    const groupCount = groupBadge(item, counts);
    return {
      ...item,
      // 分组标题用「图标上的红点」提示有待办，展开后每个菜单项再显示具体数字。
      icon: item.icon ? (
        <span className="admin-menu-icon">
          {item.icon}
          {groupCount > 0 && <i className="admin-menu-dot" />}
        </span>
      ) : undefined,
      children: item.children?.map((child) => ({
        ...child,
        badge: badgeOf(child.path, counts),
      })),
    };
  });

  return (
    <ProLayout
      title="微伴管理后台"
      logo={<Logo />}
      layout="side"
      fixedHeader
      fixSiderbar
      siderWidth={216}
      route={{ path: '/', routes: decorated }}
      location={{ pathname }}
      menu={{ autoClose: false }}
      contentStyle={{ padding: 20, minHeight: 'calc(100vh - 48px)' }}
      menuItemRender={(item, dom) => {
        const badge = (item as { badge?: number }).badge ?? 0;
        if (!item.path) return dom;
        return (
          <Link to={item.path} className="admin-menu-link">
            <span className="admin-menu-label">{item.name}</span>
            {badge > 0 && <span className="admin-menu-badge">{badge > 99 ? '99+' : badge}</span>}
          </Link>
        );
      }}
      avatarProps={{
        icon: <UserOutlined />,
        size: 'small',
        title: username,
        render: (_props, dom) => (
          <Dropdown
            menu={{
              items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录' }],
              onClick: ({ key }) => {
                if (key === 'logout') {
                  message.success('已退出登录');
                  onLogout();
                }
              },
            }}
          >
            <div className="admin-avatar">{dom}</div>
          </Dropdown>
        ),
      }}
      onMenuHeaderClick={() => onNavigate('/dashboard')}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/characters" element={<CharactersPage />} />
        <Route path="/prices" element={<PricesPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/membership" element={<MembershipPage />} />
        <Route path="/recharge" element={<RechargePage />} />
        <Route path="/model" element={<ModelManagementPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/scenario-modes" element={<ScenarioModesPage />} />
        <Route path="/public-updates" element={<PublicUpdatesPage />} />
        <Route path="/holidays" element={<HolidaysPage />} />
        <Route path="/relations" element={<RelationsPage />} />
        <Route path="/stickers" element={<StickerLibraryPage />} />
        <Route path="/voices" element={<VoiceLibraryPage />} />
        <Route path="/card-templates" element={<CardTemplatesPage />} />
        <Route path="/work-links" element={<WorkLinksPage />} />
        <Route path="/symptom-tags" element={<SymptomTagsPage />} />
        <Route path="/pet-species" element={<PetSpeciesPage />} />
        <Route path="/account-deletions" element={<AccountDeletionsPage />} />
        <Route path="/plaza" element={<PlazaAdminPage />} />
        <Route path="/reports" element={<PlazaAdminPage />} />
        <Route path="/support" element={<SupportAdminPage />} />
        <Route path="/role-requests" element={<RoleRequestsPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/daily-questions" element={<DailyQuestionsPage />} />
        <Route path="/announcements" element={<AnnouncementsPage />} />
        <Route path="/release-notes" element={<ReleaseNotesPage />} />
        <Route path="/version-policies" element={<VersionPoliciesPage />} />
        <Route path="/admin/alerts" element={<AlertsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ProLayout>
  );
}
