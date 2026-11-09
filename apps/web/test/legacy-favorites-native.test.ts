import { afterEach, expect, it, vi } from 'vitest';
import {
  AuthResponse,
  LegacyFavoriteImportItem,
  type LegacyFavoriteImportItem as Item,
} from '@weiban/contracts';
import {
  LegacyFavoritesNative,
  transferLegacyFavorites,
  type LegacyFavoritesBridge,
  type LegacyTransferReceipt,
} from '../src/data/legacy-favorites-native.js';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const owner = `${userId}:${sessionId}`;
const digest = 'a'.repeat(64);
const auth = AuthResponse.parse({
  user: {
    userId,
    username: 'legacy1',
    role: 'user',
    profileCompleted: true,
    createdAt: '2026-10-05T12:00:00.000Z',
  },
  session: {
    sessionId,
    kind: 'app',
    token: 'SYNTHETIC-TOKEN-ONLY-'.padEnd(48, 'x'),
    expiresAt: '2027-01-01T00:00:00.000Z',
  },
});
const item = (key = 'b', accountKey = 'legacy1'): Item =>
  LegacyFavoriteImportItem.parse({
    accountKey,
    itemKey: key.repeat(64),
    favorite: {
      chatKey: 'role',
      chatTitle: '合成会话',
      savedAt: 1720000000000,
      message: {
        author: '合成好友',
        type: 'text',
        content: '仅用于测试的收藏',
        isMine: false,
        timestamp: '2026-01-01T00:00:00.000Z',
        customField: { kept: true },
      },
    },
  });
type Request = Record<string, unknown> & { id: string; type: string; owner: string };
function receipt(
  items: Item[],
  status: 'imported' | 'existing' | 'removed' = 'imported',
): LegacyTransferReceipt {
  return {
    imported: status === 'imported' ? items.length : 0,
    existing: status === 'existing' ? items.length : 0,
    removed: status === 'removed' ? items.length : 0,
    items: items.map(({ accountKey, itemKey }) => ({
      accountKey,
      itemKey,
      status,
      mediaStatus: 'none',
    })),
  };
}
function setup(pages: Item[][] = [[item()]]) {
  const requests: Request[] = [];
  const controller = new AbortController();
  let current = true;
  let offset = 0;
  const total = pages.reduce((sum, page) => sum + page.length, 0);
  let respond: (request: Request) => Record<string, unknown> = (request) => {
    if (request.type === 'bind') return { userId, available: true };
    if (request.type === 'ack') return { userId, snapshotDigest: digest, acknowledged: true };
    const items = pages[offset++] ?? [];
    const at = request.offset as number;
    return {
      userId,
      available: true,
      snapshotDigest: digest,
      total,
      offset: at,
      nextOffset: at + items.length < total ? at + items.length : null,
      items,
      unscopedPresent: false,
      acknowledged: false,
    };
  };
  const bridge: LegacyFavoritesBridge = {
    onmessage: null,
    postMessage: vi.fn((raw) => {
      const request = JSON.parse(raw) as Request;
      requests.push(request);
      if (request.type !== 'clear')
        queueMicrotask(() =>
          bridge.onmessage?.({
            data: JSON.stringify({
              v: 1,
              id: request.id,
              owner: request.owner,
              ok: true,
              ...respond(request),
            }),
          }),
        );
    }),
  };
  const native = new LegacyFavoritesNative(bridge);
  const services = {
    current: () => current,
    source: vi.fn(async () => ({
      userId,
      legacyAccountKeys: ['legacy1', 'legacy2'],
      available: true,
    })),
    parseItems: (items: unknown[]) => items.map((value) => LegacyFavoriteImportItem.parse(value)),
    importItems: vi.fn(async (items: Item[]) => receipt(items)),
    progress: vi.fn(),
  };
  const run = () => transferLegacyFavorites(auth, native, services, controller.signal);
  return {
    controller,
    native,
    bridge,
    services,
    requests,
    run,
    setCurrent: (value: boolean) => {
      current = value;
    },
    changeReply: (
      fn: (request: Request, reply: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const old = respond;
      respond = (request) => fn(request, old(request));
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('saves every page, preserves extensions and separates equal item keys in different account partitions', async () => {
  const lab = setup([[item('b', 'legacy1')], [item('b', 'legacy2')]]);
  const result = await lab.run();
  expect(result).toMatchObject({ phase: 'complete', processed: 2, imported: 2, total: 2 });
  expect(lab.services.importItems).toHaveBeenCalledTimes(2);
  expect(lab.services.importItems.mock.calls[0]![0][0]!.favorite.message.customField).toEqual({
    kept: true,
  });
  expect(lab.requests.map((request) => request.type)).toEqual(['bind', 'read', 'read', 'ack']);
  expect(lab.requests[1]).toMatchObject({ offset: 0, limit: 25, snapshotDigest: null, owner });
  expect(lab.requests[2]).toMatchObject({ offset: 1, snapshotDigest: digest });
  expect(
    lab.requests
      .filter((request) => request.type !== 'bind')
      .every((request) => request.auth === undefined),
  ).toBe(true);
  lab.native.dispose(owner);
});

it('does not skip re-reading an acknowledged snapshot and respects removed server tombstones', async () => {
  const lab = setup();
  lab.changeReply((request, reply) =>
    request.type === 'read' ? { ...reply, acknowledged: true } : reply,
  );
  lab.services.importItems.mockImplementation(async (items) => receipt(items, 'removed'));
  expect(await lab.run()).toMatchObject({ phase: 'complete', imported: 0, removed: 1 });
  expect(lab.services.importItems).toHaveBeenCalledOnce();
  lab.native.dispose(owner);
});

it('never acknowledges a failed later import batch; an independent retry can return existing receipts', async () => {
  const lab = setup([[item('b')], [item('c')]]);
  lab.services.importItems
    .mockResolvedValueOnce(receipt([item('b')]))
    .mockRejectedValueOnce(new Error('synthetic network failure'));
  await expect(lab.run()).rejects.toMatchObject({ code: 'import_failed' });
  expect(lab.requests.some((request) => request.type === 'ack')).toBe(false);
  lab.native.dispose(owner);
  const retry = setup([[item('b')], [item('c')]]);
  retry.services.importItems
    .mockResolvedValueOnce(receipt([item('b')], 'existing'))
    .mockResolvedValueOnce(receipt([item('c')]));
  expect(await retry.run()).toMatchObject({ phase: 'complete', existing: 1, imported: 1 });
  retry.native.dispose(owner);
});

it.each(['missing', 'wrong_account', 'wrong_count', 'duplicate'] as const)(
  'rejects incomplete or mismatched per-item receipt: %s',
  async (mode) => {
    const lab = setup([[item('b'), item('c')]]);
    lab.services.importItems.mockImplementation(async (items) => {
      const result = receipt(items);
      if (mode === 'missing') result.items.pop();
      if (mode === 'wrong_account') result.items[0]!.accountKey = 'other1';
      if (mode === 'wrong_count') result.imported = 0;
      if (mode === 'duplicate') result.items[1] = result.items[0]!;
      return result;
    });
    await expect(lab.run()).rejects.toMatchObject({ code: 'import_failed' });
    expect(lab.requests.some((request) => request.type === 'ack')).toBe(false);
    lab.native.dispose(owner);
  },
);

it.each(['digest', 'total', 'offset', 'pagination'] as const)(
  'stops on native snapshot or pagination drift: %s',
  async (mode) => {
    const lab = setup([[item('b')], [item('c')]]);
    lab.changeReply((request, reply) => {
      if (request.type !== 'read' || request.offset !== 1) return reply;
      return mode === 'digest'
        ? { ...reply, snapshotDigest: 'f'.repeat(64) }
        : mode === 'total'
          ? { ...reply, total: 3 }
          : mode === 'offset'
            ? { ...reply, offset: 0 }
            : { ...reply, nextOffset: 1 };
    });
    await expect(lab.run()).rejects.toMatchObject({
      code: mode === 'digest' || mode === 'total' ? 'snapshot_changed' : 'invalid_reply',
    });
    expect(lab.services.importItems).toHaveBeenCalledOnce();
    expect(lab.requests.some((request) => request.type === 'ack')).toBe(false);
    lab.native.dispose(owner);
  },
);

it('refuses foreign source ownership before requesting a native binding', async () => {
  const lab = setup();
  lab.services.source.mockResolvedValue({
    userId: sessionId,
    legacyAccountKeys: ['legacy1'],
    available: true,
  });
  await expect(lab.run()).rejects.toMatchObject({ code: 'source_changed' });
  expect(lab.requests).toEqual([]);
  lab.native.dispose(owner);
});

it('unavailable source reads no native preferences and issues no import or acknowledgment', async () => {
  const lab = setup();
  lab.services.source.mockResolvedValue({ userId, legacyAccountKeys: [], available: false });
  expect(await lab.run()).toMatchObject({ phase: 'unavailable' });
  expect(lab.requests).toEqual([]);
  expect(lab.services.importItems).not.toHaveBeenCalled();
  lab.native.dispose(owner);
});

it('rejects another account partition, duplicate same-partition item and overlarge page without acknowledging', async () => {
  for (const pages of [
    [[item('b', 'other1')]],
    [[item('b')], [item('b')]],
    [Array.from({ length: 26 }, () => item())],
  ]) {
    const lab = setup(pages);
    await expect(lab.run()).rejects.toMatchObject({ code: 'invalid_reply' });
    expect(lab.requests.some((request) => request.type === 'ack')).toBe(false);
    lab.native.dispose(owner);
  }
});

it('account switch after native read prevents submitting that old account page', async () => {
  const lab = setup();
  lab.changeReply((request, reply) => {
    if (request.type === 'read') lab.setCurrent(false);
    return reply;
  });
  await expect(lab.run()).rejects.toMatchObject({ name: 'AbortError' });
  expect(lab.services.importItems).not.toHaveBeenCalled();
  lab.native.dispose(owner);
  expect(lab.requests.at(-1)).toMatchObject({ type: 'clear', owner });
});

it('account switch while an import is in flight ignores its late success and never acknowledges', async () => {
  const lab = setup();
  lab.services.importItems.mockImplementation(async (items) => {
    lab.setCurrent(false);
    return receipt(items);
  });
  await expect(lab.run()).rejects.toMatchObject({ name: 'AbortError' });
  expect(lab.requests.some((request) => request.type === 'ack')).toBe(false);
  lab.native.dispose(owner);
});

it('empty authorized snapshots can be acknowledged while unscoped originals are visibly reported', async () => {
  const lab = setup([[]]);
  lab.changeReply((request, reply) =>
    request.type === 'read' ? { ...reply, unscopedPresent: true } : reply,
  );
  expect(await lab.run()).toMatchObject({ phase: 'complete', processed: 0, unscopedPresent: true });
  expect(lab.services.importItems).not.toHaveBeenCalled();
  expect(lab.requests.at(-1)).toMatchObject({ type: 'ack' });
  lab.native.dispose(owner);
});

it('keeps all persisted rows visible but does not acknowledge a snapshot with unresolved media', async () => {
  const lab = setup([[item('b')], [item('c')]]);
  lab.services.importItems.mockImplementation(async (items) => {
    const result = receipt(items);
    if (items[0]!.itemKey === 'b'.repeat(64)) result.items[0]!.mediaStatus = 'unavailable';
    return result;
  });
  expect(await lab.run()).toMatchObject({
    phase: 'incomplete',
    processed: 2,
    imported: 2,
    unavailableMedia: 1,
  });
  expect(lab.services.importItems).toHaveBeenCalledTimes(2);
  expect(lab.requests.some((request) => request.type === 'ack')).toBe(false);
  lab.native.dispose(owner);
});

it('native blocked errors are sanitized and item-too-large is not claimed imported', async () => {
  const lab = setup();
  lab.changeReply((request, reply) =>
    request.type === 'read'
      ? {
          ok: false,
          reason: 'item_too_large',
          blocked: true,
          retryable: false,
          privateDetail: 'must-not-display',
        }
      : reply,
  );
  await expect(lab.run()).rejects.toMatchObject({ code: 'item_too_large', retryable: false });
  expect(lab.services.importItems).not.toHaveBeenCalled();
  lab.native.dispose(owner);
});

it('correlates out-of-order responses, ignores malformed messages and rejects wrong-owner responses', async () => {
  const requests: Request[] = [];
  const bridge: LegacyFavoritesBridge = {
    postMessage: (value) => requests.push(JSON.parse(value) as Request),
    onmessage: null,
  };
  const native = new LegacyFavoritesNative(bridge);
  const signal = new AbortController().signal;
  const first = native.request('read', owner, {}, signal);
  const second = native.request('ack', owner, {}, signal);
  bridge.onmessage?.({ data: '{malformed' });
  bridge.onmessage?.({
    data: JSON.stringify({ v: 1, id: requests[1]!.id, owner, ok: true, acknowledged: true }),
  });
  bridge.onmessage?.({
    data: JSON.stringify({ v: 1, id: requests[0]!.id, owner: 'wrong-owner', ok: true }),
  });
  await expect(second).resolves.toMatchObject({ acknowledged: true });
  await expect(first).rejects.toMatchObject({ code: 'invalid_reply' });
  native.dispose(owner);
});

it('rejects UTF-8 replies above 256 KiB, cancels pending requests and restores the original receiver', async () => {
  const previous = vi.fn();
  const bridge: LegacyFavoritesBridge = { postMessage: vi.fn(), onmessage: previous };
  const native = new LegacyFavoritesNative(bridge);
  const controller = new AbortController();
  const oversized = native.request('read', owner, {}, controller.signal);
  bridge.onmessage?.({ data: '中'.repeat(90_000) });
  await expect(oversized).rejects.toMatchObject({ code: 'invalid_reply' });
  const cancelled = native.request('read', owner, {}, controller.signal);
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  native.dispose(owner);
  expect(bridge.onmessage).toBe(previous);
});

it('native timeout remains retryable and never invents a successful receipt', async () => {
  vi.useFakeTimers();
  const native = new LegacyFavoritesNative({ postMessage: vi.fn(), onmessage: null });
  const request = native.request('read', owner, {}, new AbortController().signal);
  const result = expect(request).rejects.toMatchObject({ code: 'timeout', retryable: true });
  await vi.advanceTimersByTimeAsync(45_000);
  await result;
  native.dispose(owner);
});
