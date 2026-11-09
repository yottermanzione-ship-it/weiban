import { useSyncExternalStore } from 'react';
import {
  LegacyFavoriteImportItem,
  LegacyFavoritesEndpoints,
  type AuthResponse,
} from '@weiban/contracts';
import { api } from './client.js';
import { attachLegacyFavoriteMedia } from './legacy-favorites-media.js';
import {
  LegacyFavoritesFailure,
  LegacyFavoritesNative,
  transferLegacyFavorites,
  legacyFavoriteKey,
  validateLegacyFavoriteReceipt,
  type LegacyTransferProgress,
} from './legacy-favorites-native.js';

export type LegacyFavoritesTransferState = Omit<LegacyTransferProgress, 'phase'> & {
  owner: string | null;
  phase: LegacyTransferProgress['phase'] | 'idle' | 'failed';
  error: string;
  retryable: boolean;
};
const empty: LegacyFavoritesTransferState = {
  owner: null,
  phase: 'idle',
  processed: 0,
  total: 0,
  imported: 0,
  existing: 0,
  removed: 0,
  unavailableMedia: 0,
  unscopedPresent: false,
  error: '',
  retryable: true,
};
let state = empty;
const listeners = new Set<() => void>();
let bound: { owner: string; auth: AuthResponse } | null = null;
let running: { owner: string; controller: AbortController; native: LegacyFavoritesNative } | null =
  null;
function publish(value: LegacyFavoritesTransferState) {
  state = value;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useLegacyFavoritesTransfer() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => empty,
  );
}

function stopRun() {
  const old = running;
  running = null;
  if (old) {
    old.controller.abort();
    old.native.dispose(old.owner);
  }
}

export function cancelLegacyFavoritesTransfer(owner: { userId: string; sessionId: string }): void {
  const key = `${owner.userId}:${owner.sessionId}`;
  if (bound?.owner !== key) return;
  bound = null;
  stopRun();
  publish(empty);
}

export function startLegacyFavoritesTransfer(auth: AuthResponse): () => void {
  const owner = { userId: auth.user.userId, sessionId: auth.session.sessionId };
  stopRun();
  bound = { owner: `${owner.userId}:${owner.sessionId}`, auth };
  publish({ ...empty, owner: bound.owner });
  retryLegacyFavoritesTransfer();
  return () => cancelLegacyFavoritesTransfer(owner);
}

export function retryLegacyFavoritesTransfer(): void {
  const session = bound;
  if (!session || !window.weibanLegacyFavorites) return;
  const owner = { userId: session.auth.user.userId, sessionId: session.auth.session.sessionId };
  if (!api.owns(owner)) return;
  stopRun();
  const job = {
    owner: session.owner,
    controller: new AbortController(),
    native: new LegacyFavoritesNative(window.weibanLegacyFavorites),
  };
  running = job;
  const current = () =>
    bound === session && running === job && !job.controller.signal.aborted && api.owns(owner);
  publish({ ...empty, owner: session.owner, phase: 'checking' });
  void transferLegacyFavorites(
    session.auth,
    job.native,
    {
      current,
      source: (signal) => api.call(LegacyFavoritesEndpoints.source, { networkOnly: true, signal }),
      parseItems: (items) => items.map((item) => LegacyFavoriteImportItem.parse(item)),
      importItems: async (items, signal, context) => {
        // Save every complete snapshot before attempting its attachment.
        const receipt = await api.call(LegacyFavoritesEndpoints.import, {
          body: { items },
          networkOnly: true,
          signal,
        });
        if (!current()) throw new DOMException('Legacy favorites transfer cancelled', 'AbortError');
        validateLegacyFavoriteReceipt(items, receipt);
        window.dispatchEvent(new Event('weiban:legacy-favorites-updated'));
        const results = new Map(receipt.items.map((item) => [legacyFavoriteKey(item), item]));
        for (const item of items) {
          const original = results.get(legacyFavoriteKey(item))!;
          if (original.status === 'removed' || original.mediaStatus === 'ready') continue;
          const attached = await attachLegacyFavoriteMedia({
            auth: session.auth,
            native: job.native,
            snapshotDigest: context.snapshotDigest,
            item,
            signal,
            current,
          });
          if (!current())
            throw new DOMException('Legacy favorites transfer cancelled', 'AbortError');
          if (!attached.item.mediaId && !attached.item.mediaIssue) continue;
          try {
            const update = await api.call(LegacyFavoritesEndpoints.import, {
              body: { items: [attached.item] },
              networkOnly: true,
              signal,
            });
            if (!current())
              throw new DOMException('Legacy favorites transfer cancelled', 'AbortError');
            validateLegacyFavoriteReceipt([item], update);
            const updated = update.items[0]!;
            results.set(legacyFavoriteKey(item), {
              ...updated,
              status: updated.status === 'removed' ? 'removed' : original.status,
            });
          } catch (error) {
            if (!current() || signal.aborted)
              throw new DOMException('Legacy favorites transfer cancelled', 'AbortError');
            if (error instanceof LegacyFavoritesFailure) throw error;
            results.set(legacyFavoriteKey(item), { ...original, mediaStatus: 'unavailable' });
          }
        }
        const finalItems = [...results.values()];
        return {
          imported: finalItems.filter((item) => item.status === 'imported').length,
          existing: finalItems.filter((item) => item.status === 'existing').length,
          removed: finalItems.filter((item) => item.status === 'removed').length,
          items: finalItems,
        };
      },
      progress: (progress) => {
        if (current()) publish({ ...progress, owner: session.owner, error: '', retryable: true });
      },
    },
    job.controller.signal,
  )
    .then(() => {
      if (current()) window.dispatchEvent(new Event('weiban:legacy-favorites-updated'));
    })
    .catch((error: unknown) => {
      if (!current() || (error instanceof DOMException && error.name === 'AbortError')) return;
      const failure =
        error instanceof LegacyFavoritesFailure
          ? error
          : new LegacyFavoritesFailure('import_failed');
      publish({
        ...state,
        owner: session.owner,
        phase: 'failed',
        error: failure.message,
        retryable: failure.retryable,
      });
      // Successful earlier batches remain available even if a later batch/ack fails.
      window.dispatchEvent(new Event('weiban:legacy-favorites-updated'));
    })
    .finally(() => {
      job.native.dispose(job.owner);
      if (running === job) running = null;
    });
}
