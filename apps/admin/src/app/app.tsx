import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { WorkspaceLayout } from './workspace-layout.js';
import { Alert, App as AntApp, Button, Skeleton, Spin } from 'antd';
import { IdentityEndpoints, type AuthResponse } from '@weiban/contracts';
import { api } from '../data/client.js';
import { VersionBanner } from './version-banner.js';
import { LoginPage } from '../features/login.js';

import { TodoProvider } from './todos.js';
import { activePage } from './menu.js';

function lazyPage<Page extends ComponentType>(load: () => Promise<{ default: Page }>) {
  let pending: ReturnType<typeof load> | undefined;
  const start = () =>
    (pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    }));
  return Object.assign(lazy(start), {
    preload: () => {
      void start().catch(() => undefined);
    },
  });
}

const DashboardPage = lazyPage(() =>
  import('../features/dashboard.js').then((m) => ({ default: m.DashboardPage })),
);
const UserListPage = lazyPage(() =>
  import('../features/users/list.js').then((m) => ({ default: m.UserListPage })),
);
const MembershipRecordsPage = lazyPage(() =>
  import('../features/users/records.js').then((m) => ({ default: m.MembershipRecordsPage })),
);
const TopupRecordsPage = lazyPage(() =>
  import('../features/users/topups.js').then((m) => ({ default: m.TopupRecordsPage })),
);
const ScanPaymentsPage = lazyPage(() =>
  import('../features/scan-payments.js').then((m) => ({ default: m.ScanPaymentsPage })),
);
const PlansPage = lazyPage(() =>
  import('../features/users/plans.js').then((m) => ({ default: m.PlansPage })),
);
const SettingsPage = lazyPage(() =>
  import('../features/settings.js').then((m) => ({ default: m.SettingsPage })),
);
const ModelManagementPage = lazyPage(() =>
  import('../features/model-management.js').then((m) => ({ default: m.ModelManagementPage })),
);
const PricesPage = lazyPage(() =>
  import('../features/prices.js').then((m) => ({ default: m.PricesPage })),
);
const AlertsPage = lazyPage(() =>
  import('../features/alerts.js').then((m) => ({ default: m.AlertsPage })),
);
const ClientLogsPage = lazyPage(() =>
  import('../features/client-logs.js').then((m) => ({ default: m.ClientLogsPage })),
);
const CharactersPage = lazyPage(() =>
  import('../features/characters.js').then((m) => ({ default: m.CharactersPage })),
);
const UsagePage = lazyPage(() =>
  import('../features/usage.js').then((m) => ({ default: m.UsagePage })),
);
const BillingPage = lazyPage(() =>
  import('../features/billing.js').then((m) => ({ default: m.BillingPage })),
);
const ScenarioModesPage = lazyPage(() =>
  import('../features/scenario-modes.js').then((m) => ({ default: m.ScenarioModesPage })),
);
const PublicUpdatesPage = lazyPage(() =>
  import('../features/public-updates.js').then((m) => ({ default: m.PublicUpdatesPage })),
);
const AnnouncementsPage = lazyPage(() =>
  import('../features/releases.js').then((m) => ({ default: m.AnnouncementsPage })),
);
const ReleaseNotesPage = lazyPage(() =>
  import('../features/releases.js').then((m) => ({ default: m.ReleaseNotesPage })),
);
const VersionPoliciesPage = lazyPage(() =>
  import('../features/releases.js').then((m) => ({ default: m.VersionPoliciesPage })),
);
const HolidaysPage = lazyPage(() =>
  import('../features/holidays.js').then((m) => ({ default: m.HolidaysPage })),
);
const SymptomTagsPage = lazyPage(() =>
  import('../features/symptom-tags.js').then((m) => ({ default: m.SymptomTagsPage })),
);
const RelationsPage = lazyPage(() =>
  import('../features/relations.js').then((m) => ({ default: m.RelationsPage })),
);
const CardTemplatesPage = lazyPage(() =>
  import('../features/media-library.js').then((m) => ({ default: m.CardTemplatesPage })),
);
const StickerLibraryPage = lazyPage(() =>
  import('../features/media-library.js').then((m) => ({ default: m.StickerLibraryPage })),
);
const VoiceLibraryPage = lazyPage(() =>
  import('../features/media-library.js').then((m) => ({ default: m.VoiceLibraryPage })),
);
const WorkLinksPage = lazyPage(() =>
  import('../features/media-library.js').then((m) => ({ default: m.WorkLinksPage })),
);
const PetSpeciesPage = lazyPage(() =>
  import('../features/pets-deletions.js').then((m) => ({ default: m.PetSpeciesPage })),
);
const AccountDeletionsPage = lazyPage(() =>
  import('../features/account-deletions.js').then((m) => ({ default: m.AccountDeletionsPage })),
);
const DailyQuestionsPage = lazyPage(() =>
  import('../features/daily-questions.js').then((m) => ({ default: m.DailyQuestionsPage })),
);
const PlazaAdminPage = lazyPage(() =>
  import('../features/plaza.js').then((m) => ({ default: m.PlazaAdminPage })),
);
const PlannerPage = lazyPage(() =>
  import('../features/planner.js').then((m) => ({ default: m.PlannerPage })),
);
const EcologyAdminPage = lazyPage(() =>
  import('../features/ecology.js').then((m) => ({ default: m.EcologyAdminPage })),
);
const MemoryTiersPage = lazyPage(() =>
  import('../features/memory-tiers.js').then((m) => ({ default: m.MemoryTiersPage })),
);
const RoleRequestsPage = lazyPage(() =>
  import('../features/role-requests.js').then((m) => ({ default: m.RoleRequestsPage })),
);
const SearchEntitiesPage = lazyPage(() =>
  import('../features/search-entities.js').then((m) => ({ default: m.SearchEntitiesPage })),
);
const SupportAdminPage = lazyPage(() =>
  import('../features/support.js').then((m) => ({ default: m.SupportAdminPage })),
);

const ADMIN_PAGES = [
  ['/dashboard', DashboardPage],
  ['/characters', CharactersPage],
  ['/prices', PricesPage],
  ['/accounts', UserListPage],
  ['/membership-records', MembershipRecordsPage],
  ['/recharge-records', TopupRecordsPage],
  ['/plans', PlansPage],
  ['/scan-payments', ScanPaymentsPage],
  ['/model', ModelManagementPage],
  ['/usage', UsagePage],
  ['/billing', BillingPage],
  ['/scenario-modes', ScenarioModesPage],
  ['/public-updates', PublicUpdatesPage],
  ['/holidays', HolidaysPage],
  ['/relations', RelationsPage],
  ['/stickers', StickerLibraryPage],
  ['/voices', VoiceLibraryPage],
  ['/card-templates', CardTemplatesPage],
  ['/work-links', WorkLinksPage],
  ['/symptom-tags', SymptomTagsPage],
  ['/pet-species', PetSpeciesPage],
  ['/account-deletions', AccountDeletionsPage],
  ['/plaza', PlazaAdminPage],
  ['/reports', PlazaAdminPage],
  ['/support', SupportAdminPage],
  ['/role-requests', RoleRequestsPage],
  ['/search-entities', SearchEntitiesPage],
  ['/planner', PlannerPage],
  ['/ecology', EcologyAdminPage],
  ['/memory-tiers', MemoryTiersPage],
  ['/daily-questions', DailyQuestionsPage],
  ['/announcements', AnnouncementsPage],
  ['/release-notes', ReleaseNotesPage],
  ['/version-policies', VersionPoliciesPage],
  ['/settings', SettingsPage],
  ['/admin/alerts', AlertsPage],
  ['/client-logs', ClientLogsPage],
] as const;

function preloadPage(path: string) {
  const pathname = path.split('?')[0];
  ADMIN_PAGES.find(([candidate]) => candidate === pathname)?.[1].preload();
}

function PendingPage({ title }: { title: string }) {
  return (
    <section className="page" aria-busy="true" aria-label={title}>
      <div className="page-head">
        <h1>{title}</h1>
      </div>
      <div className="weiban-glass-card route-placeholder">
        <Skeleton active paragraph={{ rows: 3 }} />
      </div>
    </section>
  );
}

class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <Alert
          type="error"
          showIcon
          message="页面没能打开"
          action={<Button onClick={() => window.location.reload()}>刷新重试</Button>}
        />
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
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
      <AdminShell username={auth.user.username} onLogout={() => void logout().catch(() => {})} />
    </TodoProvider>
  );
}

function AdminShell({ username, onLogout }: { username: string; onLogout: () => void }) {
  const { message } = AntApp.useApp();
  const location = useLocation();
  const { link } = activePage(location.pathname, location.search);
  return (
    <WorkspaceLayout
      username={username}
      preloadPage={preloadPage}
      onLogout={() => {
        message.success('已退出登录');
        onLogout();
      }}
    >
      <VersionBanner />
      <PageErrorBoundary>
        <Suspense fallback={<PendingPage title={link.name} />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/membership" element={<Navigate to="/accounts" replace />} />
            <Route path="/recharge" element={<Navigate to="/plans" replace />} />
            {ADMIN_PAGES.map(([path, Page]) => (
              <Route
                key={path}
                path={path}
                element={path === '/reports' ? <PlazaAdminPage initialTab="reports" /> : <Page />}
              />
            ))}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </PageErrorBoundary>
    </WorkspaceLayout>
  );
}
