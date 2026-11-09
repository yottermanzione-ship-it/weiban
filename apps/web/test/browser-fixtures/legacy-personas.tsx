/** Browser-only synthetic fixture. No real server, legacy document or private account. */
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiFailure } from '@weiban/client-core';
import {
  AuthResponse,
  IdentityEndpoints,
  LegacyFavoritesEndpoints,
  LegacyPersonaEndpoints as E,
  LegacyPersonaDetail,
  LegacyPersonaReset,
} from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/l6.css';
import '../../src/app/pages-old.css';
import { AuthProvider, useAuth } from '../../src/app/auth.js';
import { api } from '../../src/data/client.js';
import {
  LegacyPersonaEntry,
  LegacyPersonaPage,
  LegacyPersonasPage,
} from '../../src/features/legacy-personas.js';
import { MenuGroup } from '../../src/features/shell-kit.js';
import { ToastHost } from '../../src/features/toast.js';

const first = '11111111-1111-4111-8111-111111111111',
  second = '22222222-2222-4222-8222-222222222222';
const character = '33333333-3333-4333-8333-333333333333',
  blockedCharacter = '44444444-4444-4444-8444-444444444444';
const now = '2026-11-09T04:00:00.000Z',
  query = new URLSearchParams(location.search);
const events: Array<Record<string, unknown>> = [];
const receipts = new Map<string, { item: LegacyPersonaDetail; replayed: boolean }>();
let fail = query.get('fail'),
  hold = query.get('hold');
const releases: Array<() => void> = [];
const auth = (id = first) =>
  AuthResponse.parse({
    user: {
      userId: id,
      username: id === first ? 'synthetic_one' : 'synthetic_two',
      role: 'user',
      profileCompleted: true,
      createdAt: now,
    },
    session: {
      sessionId: id,
      kind: 'app',
      token: `SYNTHETIC-LEGACY-PERSONA-${id}`,
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  });
let current = LegacyPersonaDetail.parse({
  characterId: character,
  characterName: '林间来信',
  state: query.get('blocked') ? 'blocked' : 'active',
  version: 3,
  sourceVersion: 2,
  sourceUpdatedAt: now,
  updatedAt: now,
  blockedReason: query.get('blocked') ? 'target_personal_changes' : null,
  resetAllowed: true,
  originalRetained: true,
  sections: [
    {
      key: 'core',
      title: '性格与相处',
      fields: [
        {
          label: '我保存的设定',
          value:
            '习惯慢慢听我把话说完，不急着给建议。\n见面时先聊聊窗外的天气，再一起安排今天的小事。',
        },
        { label: '日常约定', value: '晚间散步时，记得问我今天最开心的一件事。' },
      ],
    },
    {
      key: 'speech',
      title: '说话方式',
      fields: [{ label: '语气', value: '亲切、平静，偶尔开一个轻松的小玩笑。' }],
    },
    {
      key: 'relationship',
      title: '我们的关系',
      fields: [{ label: '相处习惯', value: '尊重彼此的边界，也愿意分享日常的小发现。' }],
    },
    {
      key: 'group',
      title: '一起聊天时',
      fields: [{ label: '参与方式', value: '先听大家的想法，再补充自己的故事。' }],
    },
    {
      key: 'lorebook',
      title: '记在心里的故事',
      fields: [{ label: '雨天书店', value: '第一次见面是在下雨的傍晚。书店门口的灯一直亮着。' }],
    },
    {
      key: 'examples',
      title: '对话示例',
      fields: [
        {
          label: '一段虚构对话',
          value: '我：今天有点累。\nTA：那就先坐一会儿吧，想说话时我都在。',
        },
        {
          label: '原样保存的文字',
          value: '<img src="https://outside.invalid/private" onerror="window.personaXss=true">',
        },
        { label: '完整长句', value: `长句开始${'只用于合成界面测试'.repeat(35)}长句结束` },
      ],
    },
  ],
});
const blocked = LegacyPersonaDetail.parse({
  ...current,
  characterId: blockedCharacter,
  characterName: '岛屿笔记',
  state: 'blocked',
  blockedReason: 'unsupported_structure',
  sections: [],
  resetAllowed: false,
});
const summary = (item: LegacyPersonaDetail) => {
  const { sections: _sections, resetAllowed: _reset, originalRetained: _retained, ...value } = item;
  return value;
};
await api.authenticate(auth());
Object.assign(api, {
  peek: () => undefined,
  cached: async () => undefined,
  call: async (
    endpoint: { path: string },
    options: { params?: { characterId?: string }; body?: unknown; signal?: AbortSignal } = {},
  ) => {
    const owner = api.ownerKey().split(':')[0]!;
    if (endpoint === IdentityEndpoints.me) return auth(owner).user;
    if (endpoint === IdentityEndpoints.updateCurrentDevice || endpoint === IdentityEndpoints.logout)
      return {};
    if (endpoint === LegacyFavoritesEndpoints.source)
      return { userId: owner, legacyAccountKeys: [], available: false };
    if (endpoint === E.list) {
      events.push({ type: 'list', owner });
      if (query.get('unsupported'))
        throw new ApiFailure('not_found', 'synthetic server detail', 404);
      return {
        items: owner === first && !query.get('empty') ? [summary(current), summary(blocked)] : [],
      };
    }
    if (endpoint === E.get) {
      const captured =
        owner === first
          ? structuredClone(options.params?.characterId === blockedCharacter ? blocked : current)
          : null;
      events.push({ type: 'get', owner });
      if (hold === 'get') await new Promise<void>((resolve) => releases.push(resolve));
      if (query.get('status'))
        throw new ApiFailure('unknown', 'private-should-not-render', Number(query.get('status')));
      return { item: query.get('empty') ? null : captured };
    }
    if (endpoint === E.reset) {
      const body = LegacyPersonaReset.parse(options.body);
      events.push({ type: 'reset', owner, ...body });
      if (hold === 'reset') await new Promise<void>((resolve) => releases.push(resolve));
      if (receipts.has(body.clientCommandId))
        return { ...receipts.get(body.clientCommandId), replayed: true };
      if (fail === 'conflict') {
        fail = null;
        current = { ...current, version: 4 };
        throw new ApiFailure('conflict', 'synthetic private conflict', 409);
      }
      if (body.expectedVersion !== current.version)
        throw new ApiFailure('conflict', 'version changed', 409);
      current = {
        ...current,
        state: 'reset',
        version: current.version + 1,
        sections: [],
        resetAllowed: false,
        originalRetained: false,
        blockedReason: null,
      };
      const result = { item: structuredClone(current), replayed: false };
      receipts.set(body.clientCommandId, result);
      if (fail === 'lost') {
        fail = null;
        throw new Error('synthetic lost acknowledgement');
      }
      return result;
    }
    return {};
  },
});
function Fixture() {
  const session = useAuth();
  useEffect(() => {
    Object.assign(window, {
      legacyPersonaFixture: {
        events,
        switchAccount: () => session.accept(auth(second)),
        logout: () => session.logout(),
        release: () => {
          hold = null;
          releases.splice(0).forEach((resolve) => resolve());
        },
      },
    });
  }, [session]);
  return (
    <>
      <ToastHost />
      <Routes>
        <Route path="/settings/legacy-personas" element={<LegacyPersonasPage />} />
        <Route path="/characters/:characterId/legacy-persona" element={<LegacyPersonaPage />} />
        <Route
          path="/entry"
          element={
            <main>
              <p>既有设置仍可使用</p>
              <MenuGroup>
                <LegacyPersonaEntry />
                <LegacyPersonaEntry characterId={character} />
              </MenuGroup>
            </main>
          }
        />
      </Routes>
    </>
  );
}
const start =
  query.get('page') === 'list'
    ? '/settings/legacy-personas'
    : query.get('page') === 'entry'
      ? '/entry'
      : `/characters/${character}/legacy-persona`;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[start]}>
      <AuthProvider>
        <Fixture />
      </AuthProvider>
    </MemoryRouter>
  </StrictMode>,
);
