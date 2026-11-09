/** All account/contact/cloud data is synthetic and API calls stay in memory. */
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ApiFailure } from '@weiban/client-core';
import {
  AuthResponse,
  IdentityEndpoints,
  LegacyFavoritesEndpoints,
  ContactsEndpoints,
  CharacterEndpoints,
  ContactOrganizationEndpoints as E,
  ContactOrganizationSnapshot,
  SaveContactOrganizationRequest,
} from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/l6.css';
import '../../src/app/pages-old.css';
import '../../src/app/common-fixes.css';
import '../../src/app/edit-pages.css';
import '../../src/app/ui-components.css';
import { AuthProvider, useAuth } from '../../src/app/auth.js';
import { api } from '../../src/data/client.js';
import { announceUpdate } from '../../src/data/updates.js';
import { ContactOrganizationProvider, useStars } from '../../src/data/stars.js';
import { ContactOrganizationPage } from '../../src/features/contact-organization.js';
import { ToastHost } from '../../src/features/toast.js';

const first = '11111111-1111-4111-8111-111111111111',
  second = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333',
  B = '44444444-4444-4444-8444-444444444444',
  C = '55555555-5555-4555-8555-555555555555',
  T = '66666666-6666-4666-8666-666666666666',
  REMOTE = '77777777-7777-4777-8777-777777777777';
const now = '2026-11-09T00:00:00.000Z',
  query = new URLSearchParams(location.search);
const names: Record<string, string> = { [A]: '岚溪', [B]: '林间来信', [C]: '岛屿笔记' };
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
      token: `SYNTHETIC-ORGANIZATION-${id}`,
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  });
const fresh = () =>
  ContactOrganizationSnapshot.parse({
    revision: 0,
    starredCharacterIds: [],
    tags: [],
    updatedAt: null,
  });
const clouds = new Map([
  [
    first,
    ContactOrganizationSnapshot.parse({
      revision: 1,
      starredCharacterIds: [A],
      tags: [{ tagId: T, name: '日常聊聊', characterIds: [A, B] }],
      updatedAt: now,
    }),
  ],
  [second, fresh()],
]);
const events: Array<Record<string, unknown>> = [],
  receipts = new Set<string>(),
  releases: Array<() => void> = [];
let fail = query.get('fail'),
  hold = query.get('hold');
await api.authenticate(auth());
Object.assign(api, {
  peek: () => undefined,
  cached: async () => undefined,
  call: async (
    endpoint: { path: string },
    options: { params?: { characterId?: string }; body?: unknown } = {},
  ) => {
    const owner = api.ownerKey().split(':')[0]!;
    if (endpoint === IdentityEndpoints.me) return auth(owner).user;
    if (endpoint === IdentityEndpoints.updateCurrentDevice || endpoint === IdentityEndpoints.logout)
      return {};
    if (endpoint === LegacyFavoritesEndpoints.source)
      return { userId: owner, legacyAccountKeys: [], available: false };
    if (endpoint === ContactsEndpoints.list)
      return {
        items:
          owner === first
            ? [A, B, C].map((id) => ({
                characterId: id,
                status: 'active',
                remark: names[id],
                customAvatarMediaId: null,
                addressAs: null,
                knownSince: '2026-01-01',
                conversationId: id,
                addedAt: now,
              }))
            : [],
      };
    if (endpoint === CharacterEndpoints.getProfile)
      return {
        characterId: options.params?.characterId,
        name: names[options.params?.characterId ?? ''] ?? '合成好友',
      };
    if (endpoint === E.get) {
      events.push({ type: 'get', owner });
      const captured = structuredClone(clouds.get(owner) ?? fresh());
      if (hold === 'get') await new Promise<void>((resolve) => releases.push(resolve));
      if (query.get('unsupported')) throw new ApiFailure('not_found', 'synthetic unsupported', 404);
      return captured;
    }
    if (endpoint === E.save) {
      const body = SaveContactOrganizationRequest.parse(options.body);
      events.push({ type: 'save', owner, ...structuredClone(body) });
      if (hold === 'save') await new Promise<void>((resolve) => releases.push(resolve));
      const cloud = clouds.get(owner) ?? fresh(),
        receipt = `${owner}:${body.clientCommandId}`;
      if (receipts.has(receipt)) return { snapshot: structuredClone(cloud), replayed: true };
      if (fail === 'conflict') {
        fail = null;
        clouds.set(owner, {
          ...cloud,
          revision: cloud.revision + 1,
          tags: [...cloud.tags, { tagId: REMOTE, name: '另一台设备', characterIds: [C] }],
        });
        throw new ApiFailure('conflict', 'revision changed', 409);
      }
      if (cloud.revision !== body.expectedRevision)
        throw new ApiFailure('conflict', 'revision changed', 409);
      const saved = {
        revision: cloud.revision + 1,
        starredCharacterIds: body.starredCharacterIds,
        tags: body.tags,
        updatedAt: now,
      };
      clouds.set(owner, saved);
      receipts.add(receipt);
      if (fail === 'lost') {
        fail = null;
        throw new Error('synthetic acknowledgement loss');
      }
      return { snapshot: structuredClone(saved), replayed: false };
    }
    return {};
  },
});
function HooksProbe() {
  const stars = useStars();
  return (
    <div data-testid="stars-probe" style={{ padding: '8px 16px', fontSize: 12 }}>
      <span>当前星标：{stars.stars.map((id) => names[id]).join('、') || '暂无'}</span>
      <button
        type="button"
        disabled={!stars.ready || stars.busy || !!stars.pendingOperation}
        onClick={() => stars.toggle(B)}
      >
        切换林间星标
      </button>
    </div>
  );
}
function Fixture() {
  const session = useAuth();
  useEffect(() => {
    Object.assign(window, {
      organizationFixture: {
        events,
        cloud: () => structuredClone(clouds.get(first)),
        switchAccount: () => session.accept(auth(second)),
        logout: () => session.logout(),
        release: () => {
          hold = null;
          releases.splice(0).forEach((resolve) => resolve());
        },
        remote: () => {
          const cloud = clouds.get(first)!;
          clouds.set(first, { ...cloud, revision: cloud.revision + 1, starredCharacterIds: [C] });
          announceUpdate({ type: 'data.changed', data: { section: 'contact_organization' } });
        },
      },
    });
  }, [session]);
  return (
    <>
      <HooksProbe />
      <ContactOrganizationPage />
      <ToastHost />
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={['/contacts/organization']}>
      <AuthProvider>
        <ContactOrganizationProvider>
          <Fixture />
        </ContactOrganizationProvider>
      </AuthProvider>
    </MemoryRouter>
  </StrictMode>,
);
