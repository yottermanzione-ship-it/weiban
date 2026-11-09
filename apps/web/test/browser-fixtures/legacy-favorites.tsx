/** Synthetic component fixture only; all application API calls are handled in memory. */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import {
  AuthResponse,
  Favorite,
  IdentityEndpoints,
  LegacyFavorite,
  LegacyFavoriteImportRequest,
  LegacyFavoritesEndpoints,
  LibraryEndpoints,
  MediaEndpoints,
} from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/l6.css';
import '../../src/app/pages-old.css';
import { AuthProvider, useAuth } from '../../src/app/auth.js';
import { api } from '../../src/data/client.js';
import { FavoritesPage } from '../../src/features/favorites.js';
import { ToastHost } from '../../src/features/toast.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const mediaId = '99999999-9999-4999-8999-999999999999';
const query = new URLSearchParams(location.search);
const nativeMode = query.get('native') === '1';
const missingMedia = query.get('media') === 'missing';
let failImport = query.get('fail') === 'once';
let holdImport = query.get('hold') === '1';
let releaseImport: (() => void) | null = null;
const events: string[] = [];
const auth = (id = firstId) =>
  AuthResponse.parse({
    user: {
      userId: id,
      username: id === firstId ? 'legacy1' : 'other1',
      role: 'user',
      profileCompleted: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    session: {
      sessionId: id,
      kind: 'app',
      token: `SYNTHETIC-FIXTURE-${id}`,
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  });
const now = '2026-11-09T00:00:00.000Z';
function legacy(
  index: number,
  content: string,
  mediaStatus: 'none' | 'ready' | 'unavailable' = 'none',
): LegacyFavorite {
  return LegacyFavorite.parse({
    favoriteId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    accountKey: 'legacy1',
    itemKey: index.toString(16).padStart(64, '0'),
    chatTitle: '旧版合成会话',
    savedAt: '2024-07-03T09:46:40.000Z',
    importedAt: now,
    message: {
      author: '合成好友',
      type: mediaStatus === 'none' ? 'text' : 'image',
      content,
      isMine: false,
      timestamp: '2024-07-03T09:40:00.000Z',
      duration: null,
      quotedAuthor: '旧引用',
      quotedContent: '这份快照独立于原消息',
    },
    media: mediaStatus === 'ready' ? { kind: 'image', mediaId, durationMs: null } : null,
    mediaStatus,
    mediaIssue: mediaStatus === 'unavailable' ? 'file_missing' : null,
  });
}
const records = new Map<string, Map<string, LegacyFavorite>>([
  [
    firstId,
    new Map(
      (nativeMode
        ? []
        : [
            legacy(1, '旧版独立收藏仍然可见'),
            legacy(
              2,
              '<img src="https://outside.invalid/private" onerror="window.fixtureXss=true">',
            ),
            legacy(3, '[图片]', 'unavailable'),
            legacy(4, '[图片]', 'ready'),
          ]
      ).map((item) => [JSON.stringify([item.accountKey, item.itemKey]), item]),
    ),
  ],
]);
const tombstones = new Map<string, Set<string>>();
const nativeItems = [
  {
    accountKey: 'legacy1',
    itemKey: 'e'.repeat(64),
    favorite: {
      chatKey: 'role',
      chatTitle: '原手机收藏',
      savedAt: 1720000000000,
      message: {
        type: 'text',
        content: '从原手机保存的文字',
        author: '原好友',
        isMine: false,
        timestamp: '2024-07-03T09:40:00.000Z',
      },
    },
  },
  {
    accountKey: 'legacy1',
    itemKey: 'f'.repeat(64),
    favorite: {
      chatKey: 'role',
      chatTitle: '原手机收藏',
      savedAt: 1720000000001,
      message: missingMedia
        ? {
            type: 'image',
            content: '[图片]',
            imageUrl: '/synthetic/original/image.png',
            author: '原好友',
            isMine: false,
            timestamp: '2024-07-03T09:40:01.000Z',
          }
        : {
            type: 'text',
            content: '第二条原手机收藏',
            author: '原好友',
            isMine: false,
            timestamp: '2024-07-03T09:40:01.000Z',
          },
    },
  },
];
Object.assign(window, {
  legacyFixture: {
    events,
    release: () => {
      holdImport = false;
      releaseImport?.();
    },
    refresh: () => window.dispatchEvent(new Event('weiban:legacy-favorites-updated')),
  },
});
await api.authenticate(auth());
Object.assign(api, {
  peek: () => undefined,
  cached: async () => undefined,
  call: async (
    endpoint: { path: string },
    options: { body?: unknown; params?: { favoriteId?: string }; query?: { cursor?: string } } = {},
  ) => {
    const userId = api.ownerKey().split(':')[0]!;
    if (endpoint === IdentityEndpoints.me) return auth(userId).user;
    if (endpoint === IdentityEndpoints.updateCurrentDevice) return {};
    if (endpoint === IdentityEndpoints.getProfile) return null;
    if (endpoint === LibraryEndpoints.listFavorites)
      return {
        items: [
          Favorite.parse({
            favoriteId: firstId,
            source: { kind: 'moments_post', postId: firstId, authorCharacterId: null },
            characterId: null,
            content: { type: 'text', text: '新版普通收藏继续保留' },
            extraImages: [],
            shareable: true,
            notShareableReason: null,
            sourceCreatedAt: now,
            createdAt: now,
          }),
        ],
        nextCursor: null,
      };
    if (endpoint === LegacyFavoritesEndpoints.source) {
      events.push('source');
      return {
        userId,
        legacyAccountKeys: userId === firstId ? ['legacy1'] : [],
        available: userId === firstId,
      };
    }
    if (endpoint === LegacyFavoritesEndpoints.list) {
      const items = [...(records.get(userId)?.values() ?? [])].filter(
        (item) => !tombstones.get(userId)?.has(JSON.stringify([item.accountKey, item.itemKey])),
      );
      const offset = Number(options.query?.cursor ?? 0);
      const page = items.slice(offset, offset + 2);
      return {
        items: page,
        nextCursor: offset + page.length < items.length ? String(offset + page.length) : null,
      };
    }
    if (endpoint === LegacyFavoritesEndpoints.remove) {
      events.push('remove');
      const found = [...(records.get(userId)?.entries() ?? [])].find(
        ([, item]) => item.favoriteId === options.params?.favoriteId,
      );
      if (found) {
        const removed = tombstones.get(userId) ?? new Set<string>();
        removed.add(found[0]);
        tombstones.set(userId, removed);
      }
      return undefined;
    }
    if (endpoint === LegacyFavoritesEndpoints.import) {
      events.push('import-start');
      const body = LegacyFavoriteImportRequest.parse(options.body);
      if (failImport) {
        failImport = false;
        events.push('import-failed');
        throw new Error('synthetic failure');
      }
      if (holdImport)
        await new Promise<void>((resolve) => {
          releaseImport = resolve;
        });
      const owned = records.get(userId) ?? new Map<string, LegacyFavorite>();
      records.set(userId, owned);
      const statuses = body.items.map((item) => {
        const key = JSON.stringify([item.accountKey, item.itemKey]);
        if (tombstones.get(userId)?.has(key))
          return {
            accountKey: item.accountKey,
            itemKey: item.itemKey,
            status: 'removed',
            mediaStatus: 'none',
          };
        const previous = owned.get(key);
        const source = item.favorite;
        const image = source.message.type === 'image';
        const value = LegacyFavorite.parse({
          favoriteId:
            previous?.favoriteId ??
            `00000000-0000-4000-8000-${String(100 + owned.size).padStart(12, '0')}`,
          accountKey: item.accountKey,
          itemKey: item.itemKey,
          chatTitle: source.chatTitle,
          savedAt: new Date(source.savedAt).toISOString(),
          importedAt: now,
          message: {
            author: source.message.author,
            type: source.message.type,
            content: source.message.content,
            isMine: source.message.isMine,
            timestamp: source.message.timestamp ?? null,
            duration: source.message.duration ?? null,
            quotedAuthor: source.message.quotedAuthor ?? null,
            quotedContent: source.message.quotedContent ?? null,
          },
          media: item.mediaId ? { kind: 'image', mediaId: item.mediaId, durationMs: null } : null,
          mediaStatus: item.mediaId ? 'ready' : image ? 'unavailable' : 'none',
          mediaIssue: item.mediaId ? null : (item.mediaIssue ?? previous?.mediaIssue ?? null),
        });
        owned.set(key, value);
        return {
          accountKey: item.accountKey,
          itemKey: item.itemKey,
          status: previous ? 'existing' : 'imported',
          mediaStatus: value.mediaStatus,
        };
      });
      events.push('import-saved');
      return {
        imported: statuses.filter((item) => item.status === 'imported').length,
        existing: statuses.filter((item) => item.status === 'existing').length,
        removed: statuses.filter((item) => item.status === 'removed').length,
        items: statuses,
      };
    }
    if (endpoint === MediaEndpoints.getMedia)
      return {
        mediaId,
        purpose: 'chat_image',
        mimeType: 'image/svg+xml',
        sizeBytes: 100,
        width: 20,
        height: 20,
        url: `${location.origin}/fixture-media/pixel.svg`,
        urlExpiresAt: '2027-01-01T00:00:00.000Z',
        createdAt: now,
      };
    throw new Error('Unexpected fixture API');
  },
});
if (nativeMode) {
  window.weibanLegacyFavorites = {
    onmessage: null,
    postMessage: (raw) => {
      const request = JSON.parse(raw) as {
        id: string;
        type: string;
        owner: string;
        offset?: number;
        snapshotDigest?: string;
      };
      events.push(`native-${request.type}`);
      if (request.type === 'clear') return;
      const base = {
        v: 1,
        id: request.id,
        owner: request.owner,
        ok: true,
        userId: request.owner.split(':')[0],
      };
      const offset = request.offset ?? 0;
      const payload =
        request.type === 'bind'
          ? { available: true }
          : request.type === 'ack'
            ? { snapshotDigest: 'a'.repeat(64), acknowledged: true }
            : request.type === 'media'
              ? { ok: false, reason: 'file_missing', blocked: true, retryable: false }
              : {
                  available: true,
                  snapshotDigest: 'a'.repeat(64),
                  total: nativeItems.length,
                  offset,
                  nextOffset: offset + 1 < nativeItems.length ? offset + 1 : null,
                  items: nativeItems.slice(offset, offset + 1),
                  unscopedPresent: false,
                  acknowledged: false,
                };
      queueMicrotask(() =>
        window.weibanLegacyFavorites?.onmessage?.({
          data: JSON.stringify({ ...base, ...payload }),
        }),
      );
    },
  };
}
function Harness() {
  const session = useAuth();
  return (
    <>
      <button type="button" onClick={() => void session.accept(auth(secondId))}>
        切换合成账号
      </button>
      <button
        type="button"
        onClick={() => {
          holdImport = false;
          releaseImport?.();
        }}
      >
        完成迟到请求
      </button>
      <FavoritesPage />
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/me/favorites']}>
    <AuthProvider>
      <ToastHost />
      <Harness />
    </AuthProvider>
  </MemoryRouter>,
);
