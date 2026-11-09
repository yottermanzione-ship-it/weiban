import type { AuthResponse } from '@weiban/contracts';

export interface LegacyFavoritesBridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}
declare global {
  interface Window {
    weibanLegacyFavorites?: LegacyFavoritesBridge;
  }
}

export const LEGACY_FAVORITES_PAGE_LIMIT = 25;
export const LEGACY_FAVORITES_REPLY_BYTES = 256 * 1024;
const DIGEST = /^[a-f0-9]{64}$/u;
type FailureCode =
  | 'native_unavailable'
  | 'native_failed'
  | 'invalid_reply'
  | 'snapshot_changed'
  | 'item_too_large'
  | 'source_changed'
  | 'import_failed'
  | 'remote_reference'
  | 'file_missing'
  | 'path_rejected'
  | 'file_changed'
  | 'unsupported_media'
  | 'media_too_large'
  | 'item_ambiguous'
  | 'media_unavailable'
  | 'timeout';
const MEDIA_FAILURES = new Set<FailureCode>([
  'remote_reference',
  'file_missing',
  'path_rejected',
  'file_changed',
  'unsupported_media',
  'media_too_large',
  'item_ambiguous',
  'media_unavailable',
]);

export class LegacyFavoritesFailure extends Error {
  constructor(
    readonly code: FailureCode,
    readonly retryable = true,
  ) {
    super(
      code === 'item_too_large'
        ? '有一条旧收藏超过本次读取限制，原收藏仍保留，请联系支持处理'
        : code === 'native_unavailable'
          ? '当前应用尚不支持读取旧收藏，请使用支持迁入的微伴版本'
          : code === 'media_too_large' ||
              code === 'unsupported_media' ||
              code === 'path_rejected' ||
              code === 'item_ambiguous'
            ? '有一条旧收藏附件暂时无法迁入，原文件仍保留，请联系支持处理'
            : '旧版收藏尚未全部保存，原收藏仍保留，请重试',
    );
  }
}

function aborted(): DOMException {
  return new DOMException('Legacy favorites transfer cancelled', 'AbortError');
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One owner-bound bridge session; no body/token logging and no browser persistence. */
export class LegacyFavoritesNative {
  private readonly pending = new Map<
    string,
    {
      owner: string;
      resolve: (reply: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly previous: LegacyFavoritesBridge['onmessage'];
  private closed = false;
  constructor(private readonly bridge: LegacyFavoritesBridge) {
    this.previous = bridge.onmessage;
    bridge.onmessage = this.receive;
  }
  private readonly receive = (event: { data: string }) => {
    if (typeof event.data !== 'string') return;
    if (
      event.data.length > LEGACY_FAVORITES_REPLY_BYTES ||
      new TextEncoder().encode(event.data).length > LEGACY_FAVORITES_REPLY_BYTES
    ) {
      for (const pending of [...this.pending.values()])
        pending.reject(new LegacyFavoritesFailure('invalid_reply'));
      return;
    }
    let reply: unknown;
    try {
      reply = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!record(reply) || typeof reply.id !== 'string') return;
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    if (reply.v !== 1 || reply.owner !== pending.owner || typeof reply.ok !== 'boolean') {
      pending.reject(new LegacyFavoritesFailure('invalid_reply'));
      return;
    }
    if (!reply.ok) {
      const reason =
        reply.reason === 'snapshot_changed' ||
        reply.reason === 'item_too_large' ||
        (typeof reply.reason === 'string' && MEDIA_FAILURES.has(reply.reason as FailureCode))
          ? (reply.reason as FailureCode)
          : 'native_failed';
      pending.reject(new LegacyFavoritesFailure(reason, reply.retryable !== false));
      return;
    }
    pending.resolve(reply);
  };
  request(
    type: 'bind' | 'read' | 'ack' | 'media',
    owner: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (this.closed || signal.aborted) return Promise.reject(aborted());
    return new Promise((resolveReply, rejectReply) => {
      const id = crypto.randomUUID();
      const finish = (reply?: Record<string, unknown>, error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        this.pending.delete(id);
        if (error) rejectReply(error);
        else resolveReply(reply!);
      };
      const cancel = () => finish(undefined, aborted());
      const timer = setTimeout(
        () => finish(undefined, new LegacyFavoritesFailure('timeout')),
        45_000,
      );
      this.pending.set(id, {
        owner,
        resolve: (reply) => finish(reply),
        reject: (error) => finish(undefined, error),
      });
      signal.addEventListener('abort', cancel, { once: true });
      try {
        this.bridge.postMessage(JSON.stringify({ ...body, v: 1, id, type, owner }));
      } catch {
        finish(undefined, new LegacyFavoritesFailure('native_failed'));
      }
    });
  }
  dispose(owner: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of [...this.pending.values()]) pending.reject(aborted());
    // clear is owner-scoped natively, so a late old-owner clear cannot clear a new binding.
    try {
      this.bridge.postMessage(
        JSON.stringify({ v: 1, id: crypto.randomUUID(), type: 'clear', owner }),
      );
    } catch {
      /* Old bridge can disappear during navigation; no source data is ever removed. */
    }
    if (this.bridge.onmessage === this.receive) this.bridge.onmessage = this.previous;
  }
}

export interface LegacyTransferItemKey {
  accountKey: string;
  itemKey: string;
}
export interface LegacyTransferReceipt {
  imported: number;
  existing: number;
  removed: number;
  items: Array<
    LegacyTransferItemKey & {
      status: 'imported' | 'existing' | 'removed';
      mediaStatus: 'none' | 'ready' | 'unavailable';
    }
  >;
}
export interface LegacyTransferProgress {
  phase: 'checking' | 'importing' | 'complete' | 'incomplete' | 'unavailable';
  processed: number;
  total: number;
  imported: number;
  existing: number;
  removed: number;
  unavailableMedia: number;
  unscopedPresent: boolean;
}
export interface LegacyTransferServices<T extends LegacyTransferItemKey> {
  current(): boolean;
  source(
    signal: AbortSignal,
  ): Promise<{ userId: string; legacyAccountKeys: string[]; available: boolean }>;
  parseItems(items: unknown[]): T[];
  importItems(
    items: T[],
    signal: AbortSignal,
    context: { snapshotDigest: string; owner: string },
  ): Promise<LegacyTransferReceipt>;
  progress(value: LegacyTransferProgress): void;
}

export const legacyFavoriteKey = (item: LegacyTransferItemKey) =>
  JSON.stringify([item.accountKey, item.itemKey]);
export function validateLegacyFavoriteReceipt(
  items: LegacyTransferItemKey[],
  receipt: LegacyTransferReceipt,
) {
  if (!Array.isArray(receipt.items) || receipt.items.length !== items.length)
    throw new LegacyFavoritesFailure('import_failed');
  const expected = new Set(items.map(legacyFavoriteKey)),
    accounted = new Set<string>();
  const counts = { imported: 0, existing: 0, removed: 0, unavailableMedia: 0 };
  for (const item of receipt.items) {
    const key = legacyFavoriteKey(item);
    if (
      !expected.has(key) ||
      accounted.has(key) ||
      !['imported', 'existing', 'removed'].includes(item.status) ||
      !['none', 'ready', 'unavailable'].includes(item.mediaStatus)
    )
      throw new LegacyFavoritesFailure('import_failed');
    accounted.add(key);
    counts[item.status]++;
    if (item.status !== 'removed' && item.mediaStatus === 'unavailable') counts.unavailableMedia++;
  }
  if (
    counts.imported !== receipt.imported ||
    counts.existing !== receipt.existing ||
    counts.removed !== receipt.removed
  )
    throw new LegacyFavoritesFailure('import_failed');
  return counts;
}

/** Import each owner-scoped page before acknowledging the unchanged complete native snapshot. */
export async function transferLegacyFavorites<T extends LegacyTransferItemKey>(
  auth: AuthResponse,
  native: LegacyFavoritesNative,
  services: LegacyTransferServices<T>,
  signal: AbortSignal,
): Promise<LegacyTransferProgress> {
  const owner = `${auth.user.userId}:${auth.session.sessionId}`;
  const live = () => {
    if (signal.aborted || !services.current()) throw aborted();
  };
  const progress: LegacyTransferProgress = {
    phase: 'checking',
    processed: 0,
    total: 0,
    imported: 0,
    existing: 0,
    removed: 0,
    unavailableMedia: 0,
    unscopedPresent: false,
  };
  const publish = () => {
    live();
    services.progress({ ...progress });
  };
  publish();
  const source = await services.source(signal);
  live();
  if (source.userId !== auth.user.userId) throw new LegacyFavoritesFailure('source_changed');
  if (!source.available) {
    progress.phase = 'unavailable';
    publish();
    return progress;
  }
  const keys = new Set(source.legacyAccountKeys);
  if (!keys.size || [...keys].some((key) => !key))
    throw new LegacyFavoritesFailure('source_changed');
  const bound = await native.request('bind', owner, { auth }, signal);
  live();
  if (bound.userId !== auth.user.userId || typeof bound.available !== 'boolean')
    throw new LegacyFavoritesFailure('invalid_reply');
  if (!bound.available) {
    progress.phase = 'unavailable';
    publish();
    return progress;
  }
  let offset = 0,
    snapshotDigest: string | null = null,
    total: number | null = null;
  const seen = new Set<string>();
  for (;;) {
    live();
    const page = await native.request(
      'read',
      owner,
      { offset, limit: LEGACY_FAVORITES_PAGE_LIMIT, snapshotDigest },
      signal,
    );
    live();
    if (
      page.userId !== auth.user.userId ||
      page.available !== true ||
      page.offset !== offset ||
      !Number.isSafeInteger(page.total) ||
      (page.total as number) < 0 ||
      typeof page.snapshotDigest !== 'string' ||
      !DIGEST.test(page.snapshotDigest) ||
      !Array.isArray(page.items) ||
      page.items.length > LEGACY_FAVORITES_PAGE_LIMIT ||
      typeof page.unscopedPresent !== 'boolean'
    )
      throw new LegacyFavoritesFailure('invalid_reply');
    if (
      (snapshotDigest !== null && snapshotDigest !== page.snapshotDigest) ||
      (total !== null && total !== page.total)
    )
      throw new LegacyFavoritesFailure('snapshot_changed');
    snapshotDigest = page.snapshotDigest;
    total = page.total as number;
    const next = offset + page.items.length;
    if (
      next > total ||
      (next < total && (!page.items.length || page.nextOffset !== next)) ||
      (next === total && page.nextOffset !== null)
    )
      throw new LegacyFavoritesFailure('invalid_reply');
    let items: T[];
    try {
      items = services.parseItems(page.items);
    } catch {
      throw new LegacyFavoritesFailure('invalid_reply');
    }
    if (items.length !== page.items.length) throw new LegacyFavoritesFailure('invalid_reply');
    const pageKeys = new Set<string>();
    for (const item of items) {
      const key = JSON.stringify([item.accountKey, item.itemKey]);
      if (
        !keys.has(item.accountKey) ||
        !DIGEST.test(item.itemKey) ||
        seen.has(key) ||
        pageKeys.has(key)
      )
        throw new LegacyFavoritesFailure('invalid_reply');
      pageKeys.add(key);
    }
    progress.phase = 'importing';
    progress.total = total;
    progress.unscopedPresent ||= page.unscopedPresent;
    publish();
    if (items.length) {
      live();
      let receipt: LegacyTransferReceipt;
      try {
        receipt = await services.importItems(items, signal, { snapshotDigest, owner });
      } catch (error) {
        live();
        if (
          (error instanceof DOMException && error.name === 'AbortError') ||
          error instanceof LegacyFavoritesFailure
        )
          throw error;
        throw new LegacyFavoritesFailure('import_failed');
      }
      live();
      const counts = validateLegacyFavoriteReceipt(items, receipt);
      progress.unavailableMedia += counts.unavailableMedia;
      progress.imported += counts.imported;
      progress.existing += counts.existing;
      progress.removed += counts.removed;
      for (const key of pageKeys) seen.add(key);
    }
    offset = next;
    progress.processed = offset;
    publish();
    if (page.nextOffset === null) break;
  }
  live();
  if (progress.unavailableMedia > 0) {
    progress.phase = 'incomplete';
    publish();
    return progress;
  }
  const acknowledgment = await native.request('ack', owner, { snapshotDigest }, signal);
  live();
  if (
    acknowledgment.userId !== auth.user.userId ||
    acknowledgment.snapshotDigest !== snapshotDigest ||
    acknowledgment.acknowledged !== true
  )
    throw new LegacyFavoritesFailure('invalid_reply');
  progress.phase = 'complete';
  publish();
  return progress;
}
