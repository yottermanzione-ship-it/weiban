/** Real production pages and CSS. Only transport/account data are synthetic; no copied phone UI. */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { freshSyncState } from '@weiban/client-core';
import {
  Conversation,
  IdentityEndpoints,
  ModelAccessEndpoints,
  MembershipEndpoints,
  EcologyEndpoints,
  CompanionEndpoints,
  type AuthResponse,
} from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/media-call.css';
import '../../src/app/l6.css';
import '../../src/app/l6b.css';
import '../../src/app/plaza.css';
import '../../src/app/play.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/chat-old.css';
import '../../src/app/pages-old.css';
import '../../src/app/ecology.css';
import '../../src/app/common-fixes.css';
import '../../src/app/edit-pages.css';
import '../../src/app/ui-components.css';
import '../../src/app/persona-card.css';
import { api, localStore } from '../../src/data/client.js';
import { AuthProvider } from '../../src/app/auth.js';
import { ChatProvider } from '../../src/app/chat.js';
import { TabBar } from '../../src/app/app.js';
import { CallProvider } from '../../src/features/call.js';
import {
  OnboardingGuidePage,
  OnboardingGuideProvider,
} from '../../src/features/onboarding-guide.js';
import { ConversationListPage } from '../../src/features/conversation-list.js';
import { ConversationPage } from '../../src/features/chat.js';
import { DiscoverPage } from '../../src/features/contacts.js';
import { MePage, ServicesPage } from '../../src/features/me.js';
import { EcologyPage } from '../../src/features/ecology.js';
import { MiniAppFrame, MiniAppsHomePage, miniAppFor } from '../../src/features/miniapps.js';
import { CardAlbumsPage } from '../../src/features/cards.js';
import { ToastHost } from '../../src/features/toast.js';
const userId = '01920000-0000-7000-8000-000000000014';
const sessionId = '01920000-0000-7000-8000-000000000015';
const characterId = '01920000-0000-7000-8000-000000000031';
const conversationId = '01920000-0000-7000-8000-000000000041';
const time = '2026-10-29T12:00:00.000Z';
const auth: AuthResponse = {
  user: {
    userId,
    username: 'guide_fixture',
    role: 'user',
    profileCompleted: true,
    createdAt: time,
  },
  session: {
    sessionId,
    token: 'NON_REAL_LOCAL_GUIDE_TOKEN_'.repeat(3),
    kind: 'app',
    expiresAt: '2027-01-01T00:00:00.000Z',
  },
};
const conversation = Conversation.parse({
  conversationId,
  type: 'direct',
  title: '引导测试角色',
  participants: [
    { participantId: userId, kind: 'user', refId: userId, joinedAt: time },
    { participantId: characterId, kind: 'character', refId: characterId, joinedAt: time },
  ],
  contentScope: 'normal',
  lastSeq: 0,
  lastMessage: null,
  state: {
    pinned: false,
    muted: false,
    hidden: false,
    clearedThroughSeq: 0,
    readSeq: 0,
    markedUnread: false,
  },
  unreadCount: 0,
  peerReadSeq: 0,
  createdAt: time,
  updatedAt: time,
});
const state = { ...freshSyncState(), initialized: true, conversations: [conversation] };
await api.authenticate(auth);
await localStore.setOwned({ userId, sessionId }, `sync-state:${userId}:${sessionId}`, state);
const calls: Array<{ path: string; method: string }> = [];
Object.assign(window, { onboardingLiveCalls: calls });
Object.assign(api, {
  call: async (endpoint: { path: string; method: string }) => {
    calls.push({ path: endpoint.path, method: endpoint.method });
    if (endpoint.method !== 'GET')
      throw new Error(`Unexpected write in read-only guide: ${endpoint.path}`);
    const path = endpoint.path;
    if (endpoint === IdentityEndpoints.me) return auth.user;
    if (endpoint === ModelAccessEndpoints.getScenarioConfig)
      return {
        needsSetup: false,
        scenarios: [
          { scenario: 'chat', selection: { modelKey: 'fixture/model', available: true } },
        ],
      };
    if (endpoint === ModelAccessEndpoints.getModelStatus)
      return { available: true, modelKey: 'fixture/model', reason: null };
    if (endpoint === MembershipEndpoints.get) return { tier: 'free', expiresAt: null };
    if (endpoint === EcologyEndpoints.get)
      return {
        enabled: false,
        activityLevel: 'occasional',
        actions: [],
        levels: [],
        characters: [],
        eligible: false,
        runnable: false,
        pausedReason: null,
        introSeen: false,
        estimatedPointsPerDay: null,
        updatedAt: time,
      };
    if (endpoint === CompanionEndpoints.listModes)
      return {
        items: [
          { id: 'daily', name: '日常聊天', description: '聊聊生活', recommended: true },
          { id: 'treehole', name: '树洞分享', description: '认真听你说', recommended: false },
        ],
      };
    if (path.endsWith('/sync/state')) return { latestUpdateSeq: 0 };
    if (path.endsWith('/sync/updates')) return { items: [], hasMore: false, nextSeq: 0 };
    if (path.endsWith('/messages'))
      return {
        items: [],
        hasMore: false,
        coverage: { startSeq: 0, endSeq: 0, hasOlder: false, excludedRanges: [] },
      };
    if (path.endsWith('/model-status'))
      return { available: true, modelKey: 'fixture/model', reason: null };
    if (path.includes('scenario-config'))
      return {
        needsSetup: false,
        scenarios: [
          { scenario: 'chat', selection: { modelKey: 'fixture/model', available: true } },
        ],
      };
    if (path.endsWith('/me/ecology'))
      return {
        enabled: false,
        activityLevel: 'occasional',
        actions: [],
        levels: [],
        characters: [],
        eligible: false,
        runnable: false,
        pausedReason: null,
        introSeen: false,
        estimatedPointsPerDay: null,
        updatedAt: time,
      };
    if (path.endsWith('/modes'))
      return {
        items: [
          { id: 'daily', name: '日常聊天', description: '聊聊生活', recommended: true },
          { id: 'treehole', name: '树洞分享', description: '认真听你说', recommended: false },
        ],
      };
    if (path.includes('companion'))
      return { scenarioMode: 'daily', personaFit: 50, instantReply: true, mode: 'daily' };
    if (path.endsWith('/me/profile'))
      return {
        nickname: '引导测试用户',
        avatarMediaId: null,
        birthday: null,
        gender: 'unspecified',
        city: null,
        about: null,
        timeZone: 'Asia/Shanghai',
        updatedAt: time,
      };
    if (path.endsWith('/membership')) return { tier: 'free', expiresAt: null };
    if (path.endsWith('/wallet'))
      return { balancePoints: 0, availablePoints: 0, lowBalanceThresholdPoints: 0 };
    if (path.includes('/characters/') && !path.includes('cards'))
      return {
        characterId,
        name: '引导测试角色',
        avatar: {
          image: null,
          display: { supportColors: [], avatarPattern: 'none', avatarText: null },
        },
        avatarMediaId: null,
        statusText: null,
        signature: null,
        kind: 'preset',
        updatedAt: time,
      };
    return {
      items: [],
      characters: [],
      nextCursor: null,
      unseenPostCount: 0,
      unseenInteractionCount: 0,
      characterIds: [],
      count: 0,
      total: 0,
      latestUpdateSeq: 0,
    };
  },
});
class InertSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  close() {
    this.readyState = 3;
  }
  send() {
    /* No external transport in the local fixture. */
  }
}
Object.defineProperty(window, 'WebSocket', { value: InertSocket, configurable: true });
function FixtureShell() {
  const { pathname } = useLocation();
  const tabs = ['/chat', '/discover', '/me'].includes(pathname);
  const miniApp = miniAppFor(pathname);
  const routes = (
    <Routes>
      <Route path="/help/guide" element={<OnboardingGuidePage />} />
      <Route path="/chat" element={<ConversationListPage />} />
      <Route path="/chat/:conversationId" element={<ConversationPage />} />
      <Route path="/discover" element={<DiscoverPage />} />
      <Route path="/me" element={<MePage />} />
      <Route path="/services" element={<ServicesPage />} />
      <Route path="/services/ecology" element={<EcologyPage />} />
      <Route path="/miniapps" element={<MiniAppsHomePage />} />
      <Route path="/services/cards" element={<CardAlbumsPage />} />
    </Routes>
  );
  return (
    <CallProvider>
      <OnboardingGuideProvider userId={userId}>
        <div
          className={`app-shell ${tabs ? 'with-tabs' : ''} ${pathname === '/chat' ? 'on-chat-list' : ''}`}
        >
          {miniApp ? (
            <MiniAppFrame key={miniApp.id} app={miniApp}>
              {routes}
            </MiniAppFrame>
          ) : (
            routes
          )}
          {tabs && <TabBar hidden={false} />}
          <ToastHost />
        </div>
      </OnboardingGuideProvider>
    </CallProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/help/guide']}>
    <AuthProvider>
      <ChatProvider>
        <FixtureShell />
      </ChatProvider>
    </AuthProvider>
  </MemoryRouter>,
);
