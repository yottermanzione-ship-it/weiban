/** 开发浏览器夹具：挂载真实页面/手势组件；接口为固定夹具，不表示供应商或真实数据库联调。 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { BillingEndpoints, ModelAccessEndpoints } from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/pages-old.css';
import { AuthProvider } from '../../src/app/auth.js';
import { ChatProvider } from '../../src/app/chat.js';
import { api } from '../../src/data/client.js';
import { ToastHost } from '../../src/features/toast.js';
import { ServicesPage } from '../../src/features/me.js';
import { LedgerPage, WalletPage } from '../../src/features/wallet.js';
import { ModelsPage, ScenarioModelPage } from '../../src/features/models.js';
import { PullMiniApps } from '../../src/features/pull-panel.js';

const models = [
  {
    modelKey: 'test/restricted',
    displayName: '受限模型',
    vendorName: '测试厂商',
    leaderboardRank: 1,
    available: true,
    capabilities: ['adult_content'],
    priceTier: 'cheap',
    tags: [],
  },
  {
    modelKey: 'test/known',
    displayName: '已排名模型',
    vendorName: '测试厂商',
    leaderboardRank: 2,
    available: true,
    capabilities: ['vision'],
    priceTier: 'cheap',
    tags: [],
  },
  {
    modelKey: 'test/unknown',
    displayName: '无数据模型',
    vendorName: '另一厂商',
    leaderboardRank: null,
    available: true,
    capabilities: ['vision'],
    priceTier: 'cheap',
    tags: [],
  },
];
let chosen = 'test/known';
const calls: string[] = [];
Object.assign(window, { feedbackCalls: calls });
Object.assign(api, {
  restore: async () => null,
  cached: async () => undefined,
  call: async (
    endpoint: { path: string },
    options: { body?: { selections?: { chat?: { modelKey: string } } } } = {},
  ) => {
    calls.push(endpoint.path);
    if (endpoint === ModelAccessEndpoints.listModels) return { items: models };
    if (endpoint === ModelAccessEndpoints.getLeaderboardInfo)
      return {
        source: {
          label: 'Arena',
          url: 'https://arena.ai/leaderboard/chat/text',
          asOf: '2026-10-20',
        },
        fetchedAt: '2026-10-22T08:00:00Z',
        method: 'fetch',
        popular: [{ modelKey: 'test/known', users: 12 }],
      };
    if (endpoint === ModelAccessEndpoints.updateScenarioConfig)
      chosen = options.body?.selections?.chat?.modelKey ?? chosen;
    if (
      endpoint === ModelAccessEndpoints.getScenarioConfig ||
      endpoint === ModelAccessEndpoints.updateScenarioConfig
    )
      return {
        needsSetup: false,
        scenarios: [
          {
            scenario: 'chat',
            selection: { modelKey: chosen, available: true },
            recommendedModelKey: null,
          },
        ],
      };
    if (endpoint === BillingEndpoints.getWallet)
      return { balancePoints: 100, availablePoints: 100, lowBalanceThresholdPoints: 10 };
    if (endpoint === BillingEndpoints.getUsageSummary) return { totalPoints: 3 };
    if (endpoint === BillingEndpoints.listLedger)
      return {
        items: [0, 1].map((i) => ({
          entryId: `entry-${i}`,
          type: 'charge',
          characterId: null,
          category: 'chat',
          points: -2,
          createdAt: '2026-10-22T08:00:00Z',
          usageRecordId: `usage-${i}`,
          note: null,
          balanceAfterPoints: 98 - i * 2,
        })),
        nextCursor: null,
      };
    return {};
  },
});
const page = new URLSearchParams(location.search).get('page') ?? 'pull';
const initial = page === 'rank' ? '/models/scenario/chat' : `/${page}`;
function PullFixture() {
  return (
    <div className="app-shell with-tabs">
      <main className="chat-list-page">
        <PullMiniApps title="微伴">
          <header className="chat-list-head">
            <span />
            <h1>微伴</h1>
            <button aria-label="更多">＋</button>
          </header>
          <div className="search-strip">
            <span className="search-entry">搜索</span>
          </div>
          <div className="virtual-list" style={{ overflowY: 'auto' }}>
            {Array.from({ length: 18 }, (_, i) => (
              <div className="conv-row" key={i}>
                开发用会话 {i + 1}
              </div>
            ))}
          </div>
        </PullMiniApps>
      </main>
      <nav className="tabbar">微伴 通讯录 发现 我</nav>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[initial]}>
    <AuthProvider>
      <ToastHost />
      <ChatProvider>
        <Routes>
          <Route path="/pull" element={<PullFixture />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/models/scenario/:scenario" element={<ScenarioModelPage />} />
        </Routes>
      </ChatProvider>
    </AuthProvider>
  </MemoryRouter>,
);
