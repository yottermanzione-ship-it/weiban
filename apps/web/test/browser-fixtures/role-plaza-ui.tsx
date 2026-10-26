/**
 * 开发浏览器夹具：挂真实的 RolePlazaHubPage（两个 tab、搜索、虚拟列表、列表末尾手动加载行）。
 * 只有接口数据是固定的假数据，用来验布局与交互；不连数据库、不调真实接口，也不代表生产验收。
 * 查询参数：tab=official|custom 决定初始分页；宽高由 Playwright 设置。
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PlazaEndpoints, PlazaOfficialEndpoints } from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/l6.css';
import '../../src/app/plaza.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/chat-old.css';
import '../../src/app/pages-old.css';
import { AuthProvider } from '../../src/app/auth.js';
import { ChatProvider } from '../../src/app/chat.js';
import { api } from '../../src/data/client.js';
import { RolePlazaHubPage } from '../../src/features/role-plaza.js';

const TOTAL = 40;
const PAGE = 20;
/** 「加载更多」故意慢一点：夹具要能看见在途转圈、验证在途期间再点也不会多拉一批。 */
const MORE_DELAY_MS = 600;

const display = {
  supportColors: [] as string[],
  avatarText: null as string | null,
  avatarPattern: 'star' as const,
  themeColor: null as string | null,
};

const officialCard = (i: number) => ({
  character: {
    characterId: `official-${i}`,
    kind: 'preset',
    name: `微伴${i}`,
    avatar: { image: null, display },
    tagline: `第 ${i} 个官方角色`,
    tags: [],
    categoryId: null,
    basis: 'original',
    added: false,
  },
  // 有赞有评论也不影响排序：这里的数据只用于行内文字（为 0 时不应显示）。
  likeCount: i % 3,
  commentCount: i % 2,
  likedByMe: false,
});

const workCard = (i: number) => ({
  workId: `work-${i}`,
  kind: 'custom_character',
  name: `作品${i}`,
  tagline: `第 ${i} 个作品`,
  basis: 'original',
  basedOnPresetId: null,
  basedOnPresetName: null,
  avatarUrl: null,
  author: { authorId: 'author-1', nickname: '作者甲', avatarUrl: null, deleted: false },
  likeCount: i % 3,
  adoptCount: TOTAL + 1 - i,
  commentCount: 0,
  adoptedByMe: false,
  likedByMe: false,
  currentVersion: 1,
  publishedAt: '2026-10-20T00:00:00Z',
});

type Recorded = { path: string; cursor?: string; limit?: number; sort?: string };
const calls: Recorded[] = [];
Object.assign(window, { plazaCalls: calls });

const pageOf = <T,>(cursor: string | undefined, make: (i: number) => T) => {
  const offset = cursor ? Number(cursor) : 0;
  const count = Math.max(0, Math.min(PAGE, TOTAL - offset));
  return {
    items: Array.from({ length: count }, (_, k) => make(offset + k + 1)),
    nextCursor: offset + PAGE < TOTAL ? String(offset + PAGE) : null,
  };
};
const slow = () => new Promise((resolve) => setTimeout(resolve, MORE_DELAY_MS));

Object.assign(api, {
  restore: async () => null,
  cached: async () => undefined,
  call: async (
    endpoint: { path: string },
    options: { query?: { cursor?: string; limit?: number; sort?: string } } = {},
  ) => {
    const query = options.query ?? {};
    calls.push({ path: endpoint.path, cursor: query.cursor, limit: query.limit, sort: query.sort });
    if (endpoint === PlazaOfficialEndpoints.list) {
      if (query.cursor) await slow();
      return pageOf(query.cursor, officialCard);
    }
    if (endpoint === PlazaEndpoints.listWorks) {
      if (query.cursor) await slow();
      return pageOf(query.cursor, workCard);
    }
    if (endpoint === PlazaEndpoints.getBadge) return { myWorksUnseen: 0, reportResultsUnseen: 0 };
    return {};
  },
});

const search = location.search || '?tab=official';
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[`/plaza${search}`]}>
    <AuthProvider>
      <ChatProvider>
        <RolePlazaHubPage />
      </ChatProvider>
    </AuthProvider>
  </MemoryRouter>,
);
