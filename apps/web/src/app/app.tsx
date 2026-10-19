import { SupportPage, SupportCreatePage, SupportDetailPage } from '../features/support.js';
import { StickerStorePage, StickerStoreDetailPage } from '../features/sticker-store.js';
import { UserStatusPage } from '../features/user-status.js';
import { PluginsPage } from '../features/plugins.js';
import { EcologyInsufficientNotice } from '../features/ecology-insufficient-notice.js';
import { EcologyPage } from '../features/ecology.js';
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { RouteMotion } from '../features/route-motion.js';
import { OldIcon } from '../features/old-icons.js';
import { BackArrow } from '../features/shell-kit.js';
import { useChat } from './chat.js';
import { ConversationListPage } from '../features/conversation-list.js';
import { ConversationPage } from '../features/chat.js';
import { MemoriesPage } from '../features/memories.js';
import { ChatSettingsPage } from '../features/chat-settings.js';
import { ContactsPage, DiscoverPage, CharacterPage, RolePlazaPage } from '../features/contacts.js';
import { ComingSoonPage, useBack } from '../features/shell-kit.js';
import { MiniAppFrame, MiniAppsHomePage, miniAppFor } from '../features/miniapps.js';
import {
  AboutPage,
  AnnouncementsPage,
  ReleaseCenter,
  ReleaseNotesPage,
  useAnnouncementUnread,
} from '../features/release.js';
import { ChatProvider } from './chat.js';
import { AuthProvider, useAuth } from './auth.js';
import { AuthPage } from '../features/auth-page.js';
import { SplashScreen, useSplash } from '../features/splash.js';
import { MePage, ServicesPage } from '../features/me.js';
import { ProfilePage } from '../features/profile.js';
import { SettingsPage } from '../features/settings.js';
import { WalletPage, LedgerPage, PricesPage, RechargePage } from '../features/wallet.js';
import { MembershipPage } from '../features/membership.js';
import { CharacterModelPage, ModelsPage } from '../features/models.js';
import { LeaderboardPage } from '../features/leaderboard.js';
import { UsagePage } from '../features/usage.js';
import {
  CreateCustomCharacterPage,
  EditCustomCharacterPage,
} from '../features/custom-character.js';
import {
  AccountSecurityPage,
  PrivacySettingsPage,
  GeneralSettingsPage,
  ProactiveSettingsPage,
} from '../features/account-settings.js';
import { TimelinePage } from '../features/timeline.js';
import { AnniversariesPage } from '../features/growth.js';
import {
  PeriodPage,
  PeriodDayPage,
  PeriodHistoryPage,
  PeriodAuthorizationPage,
  PeriodSettingsPage,
} from '../features/period.js';
import { GroupListPage, GroupSettingsPage, SelectMembersPage } from '../features/groups.js';
import {
  CharacterMomentsPage,
  ComposeMomentPage,
  MomentDetailPage,
  MomentsFeedPage,
  MomentsNotificationsPage,
  MyMomentsPage,
  useMomentsBadge,
} from '../features/moments.js';
import { NewFriendsPage, useNewFriendsDot } from '../features/new-friends.js';
import { RelationsPage } from '../features/relations.js';
import { ServiceWorkerRefresh } from './update-prompt.js';
import { CallLinkPage, CallProvider } from '../features/call.js';
import { MyStickersPage } from '../features/stickers.js';
import { VoicePickerPage } from '../features/voices.js';
import { ToastHost } from '../features/toast.js';
import {
  AchievementWatcher,
  AchievementsPage,
  CardAlbumPage,
  CardAlbumsPage,
  FamiliarityOverviewPage,
} from '../features/cards.js';
import { FavoriteDetailPage, FavoritesPage } from '../features/favorites.js';
import {
  ConversationHitsPage,
  ConversationSearchPage,
  GlobalSearchPage,
} from '../features/search.js';
import { ShareEditorPage } from '../features/share.js';
import { ImportListPage, ImportPage } from '../features/import.js';
import { SupplementPage } from '../features/supplement.js';
import { AccountDeletionPage } from '../features/account-deletion.js';
import { AdoptPage, PetPage, PetWithPage, PetsPage } from '../features/pets.js';
import {
  AuthorPage,
  MyWorksPage,
  PlazaProfilePage,
  PublishPage,
  ReportPage,
  WorkPage,
} from '../features/plaza.js';
import {
  OfficialRolePage,
  RoleCreatePage,
  RolePlazaHubPage,
  RoleRequestDetailPage,
  RoleRequestFormPage,
  RoleRequestListPage,
  useRoleRequestBadge,
} from '../features/role-plaza.js';
import {
  DailyHistoryPage,
  DailyQuestionPage,
  FocusCapsule,
  FocusPage,
  LetterPage,
  LettersPage,
  ReminderEditPage,
  RemindersPage,
  WishlistPage,
  WishlistsPage,
  WriteLetterPage,
} from '../features/play.js';
/** 这些页面自带返回按钮，不显示通用顶栏。 */
const ownHeader = [
  /^\/(sticker-store|support)(\/|$)/,
  /^\/me\/status$/,
  /^\/settings\/plugins$/,
  /^\/characters\/[^/]+\/(timeline|anniversaries|moments|relations|voice|cards|supplement)$/,
  /^\/(imports|pets|plaza|play|roles|role-requests)(\/|$)/,
  /^\/settings\/delete-account$/,
  /^\/(share|search)(\/|$)/,
  /^\/me\/favorites/,
  /^\/services\/period/,
  /^\/(contacts\/(new|groups|add)|groups\/new|moments|me\/moments|me\/stickers|calls\/)/,
  // 换壳后用统一标题栏 NavBar 的页面
  /^\/(coming-soon|miniapps|discover\/plaza)(\/|$)/,
  /^\/(services|settings)$/,
  /^\/settings\/(about|announcements|release-notes)$/,
  /^\/characters\/[^/]+\/model$/,
  // 旧版界面（06-old-ui-spec）改用 NavBar 的页面
  /^\/settings\/(security|privacy|general)$/,
  /^\/services\/proactive$/,
  /^\/services\/ecology$/,
  /^\/characters\/[^/]+$/,
  /^\/profile$/,
  /^\/(wallet|ledger|prices|usage|models|leaderboard|membership)(\/|$)/,
];
function TopBack({ fallback }: { fallback: string }) {
  const back = useBack(fallback);
  return (
    <button type="button" className="text-button" onClick={back} aria-label="返回">
      <BackArrow />
      返回
    </button>
  );
}
/**
 * 底部标签图标（2026-10-18 换用内联单色线条图）。
 * 之前用 design-assets 里的灰度 png 当遮罩，png 自带灰底，mask 之后变成一整块实心方块。
 * 内联 SVG 走 currentColor：未选中灰、选中绿，跟微信一致。
 */
function TabGlyph({ index }: { index: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 } as const;
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden focusable="false">
      {index === 0 && (
        <path
          {...common}
          d="M12 3.5c-4.97 0-9 3.36-9 7.5 0 2.3 1.26 4.35 3.25 5.72-.16 1.2-.78 2.5-1.86 3.53 1.68-.15 3.4-.83 4.6-1.72.92.24 1.93.37 3.01.37 4.97 0 9-3.36 9-7.5S16.97 3.5 12 3.5Z"
        />
      )}
      {index === 1 && (
        <g {...common}>
          <circle cx="9" cy="8.5" r="3" />
          <path d="M3.5 19c0-3.04 2.46-5.5 5.5-5.5s5.5 2.46 5.5 5.5" />
          <path d="M15.5 6.3a3 3 0 0 1 0 5.4M17 13.6c1.9.8 3 2.4 3 4.4" />
        </g>
      )}
      {index === 2 && (
        <g {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M15.5 8.5 13 13l-4.5 2.5L11 11l4.5-2.5Z" />
        </g>
      )}
      {index === 3 && (
        <g {...common}>
          <circle cx="12" cy="8" r="3.6" />
          <path d="M4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6" />
        </g>
      )}
    </svg>
  );
}
/** 底部标签栏（规格 4.1）：单色线条图标随选中变色，10 号字，角标。 */
function TabBar({ hidden }: { hidden: boolean }) {
  const badge = useMomentsBadge();
  const friends = useNewFriendsDot();
  const roleRequests = useRoleRequestBadge();
  const announcements = useAnnouncementUnread();
  const { state } = useChat();
  const unread = state.conversations
    .filter((c) => !c.state.muted && !c.state.hidden)
    .reduce((total, c) => total + c.unreadCount, 0);
  const tabs = [
    { to: '/chat', label: '微伴', index: 0, count: unread, dot: false },
    { to: '/contacts', label: '通讯录', index: 1, count: 0, dot: friends || roleRequests > 0 },
    {
      to: '/discover',
      label: '发现',
      index: 2,
      count: badge?.unseenInteractionCount ?? 0,
      dot: !!badge && badge.unseenPostCount > 0,
    },
    { to: '/me', label: '我', index: 3, count: 0, dot: announcements > 0 },
  ];
  return (
    <nav className={`tabbar ${hidden ? 'hidden' : ''}`} aria-label="主导航">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to}>
          {({ isActive }) => (
            <>
              <span className="tab-icon">
                <TabGlyph index={tab.index} />
                {tab.count > 0 ? (
                  <span className="tab-badge" aria-label={`${tab.count} 条未读`}>
                    {tab.count > 99 ? '99+' : tab.count}
                  </span>
                ) : (
                  tab.dot && <span className="tab-dot" aria-label="有新内容" />
                )}
              </span>
              <span>{tab.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
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
  // 加载中由上层的启动页盖住
  if (auth.loading) return null;
  if (!auth.session)
    return (
      <>
        <AuthPage />
        <ToastHost />
      </>
    );
  const firstProfile = !auth.session.user.profileCompleted;
  const onboarding = auth.onboarding || firstProfile || searchParams.get('onboarding') === '1';
  if (!firstProfile && auth.onboarding && ['/', '/chat'].includes(location.pathname))
    return <Navigate to="/discover?onboarding=1" replace />;
  if (firstProfile && location.pathname !== '/profile') return <Navigate to="/profile" replace />;
  const roots = ['/chat', '/contacts', '/discover', '/me'];
  const miniApp = onboarding ? undefined : miniAppFor(location.pathname);
  // 旧版（微信）规则：标签栏只在四个标签页出现（规格 4.1）。
  const showTabs = !onboarding && !miniApp && roots.includes(location.pathname);
  return (
    <CallProvider>
      <div
        className={`app-shell ${showTabs ? 'with-tabs' : ''}`}
        key={`${auth.session.user.userId}:${auth.session.session.sessionId}`}
      >
        <FocusCapsule />
        {offline && (
          <div role="status" className="offline">
            网络暂不可用，正在显示本机保存的内容
          </div>
        )}
        <RouteMotion>
          {!onboarding &&
            !miniApp &&
            !roots.includes(location.pathname) &&
            !location.pathname.startsWith('/chat/') &&
            !ownHeader.some((pattern) => pattern.test(location.pathname)) && (
              <header className="topbar">
                <TopBack
                  fallback={
                    [
                      '/wallet',
                      '/models',
                      '/ledger',
                      '/prices',
                      '/leaderboard',
                      '/usage',
                      '/services/proactive',
                      '/services/familiarity',
                    ].includes(location.pathname)
                      ? '/services'
                      : ['/settings/security', '/settings/privacy', '/settings/general'].includes(
                            location.pathname,
                          )
                        ? '/settings'
                        : '/me'
                  }
                />
              </header>
            )}
          {(() => {
            const routes = (
              <Routes location={location}>
                <Route
                  path="/"
                  element={
                    <Navigate
                      to={auth.session.user.profileCompleted ? '/chat' : '/profile'}
                      replace
                    />
                  }
                />
                <Route path="/me" element={<MePage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/wallet" element={<WalletPage />} />
                <Route path="/membership" element={<MembershipPage />} />
                <Route path="/wallet/recharge" element={<RechargePage />} />
                <Route path="/ledger" element={<LedgerPage />} />
                <Route path="/prices" element={<PricesPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/leaderboard" element={<LeaderboardPage />} />
                <Route path="/usage" element={<UsagePage />} />
                <Route path="/characters/custom/new" element={<CreateCustomCharacterPage />} />
                <Route
                  path="/characters/custom/:characterId/edit"
                  element={<EditCustomCharacterPage />}
                />
                <Route path="/settings/security" element={<AccountSecurityPage />} />
                <Route path="/settings/privacy" element={<PrivacySettingsPage />} />
                <Route path="/settings/general" element={<GeneralSettingsPage />} />
                <Route path="/services/proactive" element={<ProactiveSettingsPage />} />
                <Route path="/services/ecology" element={<EcologyPage />} />
                <Route path="/services/period" element={<PeriodPage />} />
                <Route path="/services/period/day/:date" element={<PeriodDayPage />} />
                <Route path="/services/period/history" element={<PeriodHistoryPage />} />
                <Route
                  path="/services/period/authorization"
                  element={<PeriodAuthorizationPage />}
                />
                <Route path="/services/period/settings" element={<PeriodSettingsPage />} />
                <Route path="/chat" element={<ConversationListPage />} />
                <Route path="/chat/:conversationId" element={<ConversationPage />} />
                <Route path="/chat/:conversationId/settings" element={<ChatSettingsPage />} />
                <Route path="/characters/:characterId/memories" element={<MemoriesPage />} />
                <Route path="/characters/:characterId/timeline" element={<TimelinePage />} />
                <Route path="/characters/:characterId/moments" element={<CharacterMomentsPage />} />
                <Route path="/characters/:characterId/relations" element={<RelationsPage />} />
                <Route path="/contacts/new" element={<NewFriendsPage />} />
                <Route path="/contacts/groups" element={<GroupListPage />} />
                <Route path="/groups/new" element={<SelectMembersPage />} />
                <Route path="/chat/:conversationId/group" element={<GroupSettingsPage />} />
                <Route path="/moments" element={<MomentsFeedPage />} />
                <Route path="/moments/new" element={<ComposeMomentPage />} />
                <Route path="/moments/notifications" element={<MomentsNotificationsPage />} />
                <Route path="/moments/posts/:postId" element={<MomentDetailPage />} />
                <Route path="/me/moments" element={<MyMomentsPage />} />
                <Route
                  path="/characters/:characterId/anniversaries"
                  element={<AnniversariesPage />}
                />
                <Route path="/sticker-store" element={<StickerStorePage />} />
                <Route path="/sticker-store/:packId" element={<StickerStoreDetailPage />} />
                <Route path="/support" element={<SupportPage />} />
                <Route path="/support/new" element={<SupportCreatePage />} />
                <Route path="/support/tickets/:ticketId" element={<SupportDetailPage />} />
                <Route path="/me/status" element={<UserStatusPage />} />
                <Route path="/settings/plugins" element={<PluginsPage />} />
                <Route path="/me/stickers" element={<MyStickersPage />} />
                <Route path="/me/favorites" element={<FavoritesPage />} />
                <Route path="/me/favorites/:favoriteId" element={<FavoriteDetailPage />} />
                <Route path="/services/cards" element={<CardAlbumsPage />} />
                <Route path="/services/achievements" element={<AchievementsPage />} />
                <Route path="/services/familiarity" element={<FamiliarityOverviewPage />} />
                <Route path="/characters/:characterId/cards" element={<CardAlbumPage />} />
                <Route path="/search" element={<GlobalSearchPage />} />
                <Route path="/search/:conversationId" element={<ConversationHitsPage />} />
                <Route path="/chat/:conversationId/search" element={<ConversationSearchPage />} />
                <Route path="/share" element={<ShareEditorPage />} />
                <Route path="/imports" element={<ImportListPage />} />
                <Route path="/imports/new" element={<ImportPage />} />
                <Route path="/imports/:jobId" element={<ImportPage />} />
                <Route path="/characters/:characterId/supplement" element={<SupplementPage />} />
                <Route path="/settings/delete-account" element={<AccountDeletionPage />} />
                <Route path="/services/pets" element={<PetsPage />} />
                <Route path="/pets/adopt" element={<AdoptPage />} />
                <Route path="/pets/:petId" element={<PetPage />} />
                <Route path="/play/daily" element={<DailyQuestionPage />} />
                <Route path="/play/daily/history" element={<DailyHistoryPage />} />
                <Route path="/play/wishlists" element={<WishlistsPage />} />
                <Route path="/play/wishlists/:characterId" element={<WishlistPage />} />
                <Route path="/play/letters" element={<LettersPage />} />
                <Route path="/play/letters/new" element={<WriteLetterPage />} />
                <Route path="/play/letters/:letterId" element={<LetterPage />} />
                <Route path="/play/focus" element={<FocusPage />} />
                <Route path="/play/reminders" element={<RemindersPage />} />
                <Route path="/play/reminders/:reminderId" element={<ReminderEditPage />} />
                <Route path="/plaza/works/:workId" element={<WorkPage />} />
                <Route path="/plaza/authors/:authorId" element={<AuthorPage />} />
                <Route path="/plaza/me" element={<MyWorksPage />} />
                <Route path="/plaza/profile" element={<PlazaProfilePage />} />
                <Route path="/plaza/publish" element={<PublishPage />} />
                <Route path="/plaza/report" element={<ReportPage />} />
                <Route path="/characters/:characterId/voice" element={<VoicePickerPage />} />
                <Route path="/calls/:callId" element={<CallLinkPage />} />
                <Route path="/coming-soon/:feature" element={<ComingSoonPage />} />
                <Route path="/miniapps" element={<MiniAppsHomePage />} />
                <Route path="/discover/plaza" element={<Navigate to="/plaza" replace />} />
                <Route path="/contacts/add" element={<RolePlazaPage />} />
                <Route path="/plaza" element={<RolePlazaHubPage />} />
                <Route path="/plaza/official/:characterId" element={<OfficialRolePage />} />
                <Route path="/roles/create" element={<RoleCreatePage />} />
                <Route path="/role-requests" element={<RoleRequestListPage />} />
                <Route path="/role-requests/new" element={<RoleRequestFormPage />} />
                <Route path="/role-requests/:requestId" element={<RoleRequestDetailPage />} />
                <Route path="/pets/with/:characterId" element={<PetWithPage />} />
                <Route path="/characters/:characterId/model" element={<CharacterModelPage />} />
                <Route path="/settings/about" element={<AboutPage />} />
                <Route path="/settings/announcements" element={<AnnouncementsPage />} />
                <Route path="/settings/release-notes" element={<ReleaseNotesPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/discover" element={<DiscoverPage />} />
                <Route path="/characters/:characterId" element={<CharacterPage />} />
                <Route path="*" element={<Navigate to="/me" replace />} />
              </Routes>
            );
            return miniApp ? (
              <MiniAppFrame key={miniApp.id} app={miniApp}>
                {routes}
              </MiniAppFrame>
            ) : (
              routes
            );
          })()}
        </RouteMotion>
        {showTabs && <TabBar hidden={false} />}
        <AchievementWatcher />
        {!firstProfile && <ReleaseCenter />}
        <ToastHost />
        {!firstProfile && !onboarding && (
          <EcologyInsufficientNotice
            userId={auth.session.user.userId}
            sessionId={auth.session.session.sessionId}
          />
        )}
      </div>
    </CallProvider>
  );
}
/** 启动页盖在最上层：至少 1.2 秒、且登录状态恢复完成后淡出。 */
function Splash() {
  const auth = useAuth();
  const phase = useSplash(!auth.loading);
  return phase === 'done' ? null : <SplashScreen fading={phase === 'fading'} />;
}
export function App() {
  return (
    <AuthProvider>
      <ServiceWorkerRefresh />
      <ChatProvider>
        <Shell />
        <Splash />
      </ChatProvider>
    </AuthProvider>
  );
}
