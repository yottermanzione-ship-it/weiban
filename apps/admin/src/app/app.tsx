import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { WorkspaceLayout } from './workspace-layout.js';
import { App as AntApp, Spin } from 'antd';
import { IdentityEndpoints, type AuthResponse } from '@weiban/contracts';
import { api } from '../data/client.js';
import { VersionBanner } from './version-banner.js';
import { LoginPage } from '../features/login.js';

import { TodoProvider } from './todos.js';

const DashboardPage = lazy(() =>
  import('../features/dashboard.js').then((m) => ({ default: m.DashboardPage })),
);
const UserListPage = lazy(() =>
  import('../features/users/list.js').then((m) => ({ default: m.UserListPage })),
);
const MembershipRecordsPage = lazy(() =>
  import('../features/users/records.js').then((m) => ({ default: m.MembershipRecordsPage })),
);
const TopupRecordsPage = lazy(() =>
  import('../features/users/topups.js').then((m) => ({ default: m.TopupRecordsPage })),
);
const ScanPaymentsPage = lazy(() =>
  import('../features/scan-payments.js').then((m) => ({ default: m.ScanPaymentsPage })),
);
const PlansPage = lazy(() =>
  import('../features/users/plans.js').then((m) => ({ default: m.PlansPage })),
);
const SettingsPage = lazy(() =>
  import('../features/settings.js').then((m) => ({ default: m.SettingsPage })),
);
const ModelManagementPage = lazy(() =>
  import('../features/model-management.js').then((m) => ({ default: m.ModelManagementPage })),
);
const PricesPage = lazy(() =>
  import('../features/prices.js').then((m) => ({ default: m.PricesPage })),
);
const AlertsPage = lazy(() =>
  import('../features/alerts.js').then((m) => ({ default: m.AlertsPage })),
);
const ClientLogsPage = lazy(() =>
  import('../features/client-logs.js').then((m) => ({ default: m.ClientLogsPage })),
);
const CharactersPage = lazy(() =>
  import('../features/characters.js').then((m) => ({ default: m.CharactersPage })),
);
const UsagePage = lazy(() =>
  import('../features/usage.js').then((m) => ({ default: m.UsagePage })),
);
const BillingPage = lazy(() =>
  import('../features/billing.js').then((m) => ({ default: m.BillingPage })),
);
const ScenarioModesPage = lazy(() =>
  import('../features/scenario-modes.js').then((m) => ({ default: m.ScenarioModesPage })),
);
const PublicUpdatesPage = lazy(() =>
  import('../features/public-updates.js').then((m) => ({ default: m.PublicUpdatesPage })),
);
const AnnouncementsPage = lazy(() =>
  import('../features/releases.js').then((m) => ({ default: m.AnnouncementsPage })),
);
const ReleaseNotesPage = lazy(() =>
  import('../features/releases.js').then((m) => ({ default: m.ReleaseNotesPage })),
);
const VersionPoliciesPage = lazy(() =>
  import('../features/releases.js').then((m) => ({ default: m.VersionPoliciesPage })),
);
const HolidaysPage = lazy(() =>
  import('../features/holidays.js').then((m) => ({ default: m.HolidaysPage })),
);
const SymptomTagsPage = lazy(() =>
  import('../features/symptom-tags.js').then((m) => ({ default: m.SymptomTagsPage })),
);
const RelationsPage = lazy(() =>
  import('../features/relations.js').then((m) => ({ default: m.RelationsPage })),
);
const CardTemplatesPage = lazy(() =>
  import('../features/media-library.js').then((m) => ({ default: m.CardTemplatesPage })),
);
const StickerLibraryPage = lazy(() =>
  import('../features/media-library.js').then((m) => ({ default: m.StickerLibraryPage })),
);
const VoiceLibraryPage = lazy(() =>
  import('../features/media-library.js').then((m) => ({ default: m.VoiceLibraryPage })),
);
const WorkLinksPage = lazy(() =>
  import('../features/media-library.js').then((m) => ({ default: m.WorkLinksPage })),
);
const PetSpeciesPage = lazy(() =>
  import('../features/pets-deletions.js').then((m) => ({ default: m.PetSpeciesPage })),
);
const AccountDeletionsPage = lazy(() =>
  import('../features/account-deletions.js').then((m) => ({ default: m.AccountDeletionsPage })),
);
const DailyQuestionsPage = lazy(() =>
  import('../features/daily-questions.js').then((m) => ({ default: m.DailyQuestionsPage })),
);
const PlazaAdminPage = lazy(() =>
  import('../features/plaza.js').then((m) => ({ default: m.PlazaAdminPage })),
);
const PlannerPage = lazy(() =>
  import('../features/planner.js').then((m) => ({ default: m.PlannerPage })),
);
const EcologyAdminPage = lazy(() =>
  import('../features/ecology.js').then((m) => ({ default: m.EcologyAdminPage })),
);
const MemoryTiersPage = lazy(() =>
  import('../features/memory-tiers.js').then((m) => ({ default: m.MemoryTiersPage })),
);
const RoleRequestsPage = lazy(() =>
  import('../features/role-requests.js').then((m) => ({ default: m.RoleRequestsPage })),
);
const SearchEntitiesPage = lazy(() =>
  import('../features/search-entities.js').then((m) => ({ default: m.SearchEntitiesPage })),
);
const SupportAdminPage = lazy(() =>
  import('../features/support.js').then((m) => ({ default: m.SupportAdminPage })),
);

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
  return (
    <WorkspaceLayout
      username={username}
      onLogout={() => {
        message.success('已退出登录');
        onLogout();
      }}
    >
      <VersionBanner />
      <Suspense
        fallback={
          <div className="workspace-loading" role="status">
            <Spin />
            正在打开页面…
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/characters" element={<CharactersPage />} />
          <Route path="/prices" element={<PricesPage />} />
          <Route path="/accounts" element={<UserListPage />} />
          <Route path="/membership-records" element={<MembershipRecordsPage />} />
          <Route path="/recharge-records" element={<TopupRecordsPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/scan-payments" element={<ScanPaymentsPage />} />
          {/* 10-20 批 E2：原「会员与订单」混合页删除，旧地址跳到用户列表；原「充值档位」并入套餐与价格。 */}
          <Route path="/membership" element={<Navigate to="/accounts" replace />} />
          <Route path="/recharge" element={<Navigate to="/plans" replace />} />
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
          <Route path="/reports" element={<PlazaAdminPage initialTab="reports" />} />
          <Route path="/support" element={<SupportAdminPage />} />
          <Route path="/role-requests" element={<RoleRequestsPage />} />
          <Route path="/search-entities" element={<SearchEntitiesPage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/ecology" element={<EcologyAdminPage />} />
          <Route path="/memory-tiers" element={<MemoryTiersPage />} />
          <Route path="/daily-questions" element={<DailyQuestionsPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/release-notes" element={<ReleaseNotesPage />} />
          <Route path="/version-policies" element={<VersionPoliciesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin/alerts" element={<AlertsPage />} />
          <Route path="/client-logs" element={<ClientLogsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </WorkspaceLayout>
  );
}
