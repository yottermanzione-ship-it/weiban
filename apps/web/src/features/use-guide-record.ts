import { useCallback, useEffect, useRef, useState } from 'react';
import { IdentityEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { type ChapterId, type GuideRecord } from './guide-triggers.js';
import {
  guideStorageKey,
  mergeGuideSeen,
  readGuideRecord,
  seenChapters,
  writeGuideRecord,
} from './guide-record.js';

/** 账号端是已见记录的正本；离线/未知时不自动打扰，手动学习仍可使用。 */
export function useGuideRecord(userId: string) {
  const key = guideStorageKey(userId);
  const [saved, setSaved] = useState(() => readGuideRecord(key));
  const recordRef = useRef(saved);
  const [ready, setReady] = useState(false);
  const [revision, refresh] = useState(0);
  const owner = useRef(api.ownerKey());
  const mounted = useRef(true);
  const current = useCallback(
    () =>
      mounted.current && owner.current === api.ownerKey() && owner.current.startsWith(`${userId}:`),
    [userId],
  );
  const update = useCallback(
    (change: (record: GuideRecord) => GuideRecord) => {
      if (!current()) return;
      const next = writeGuideRecord(key, change(recordRef.current));
      recordRef.current = next;
      setSaved(next);
    },
    [key, current],
  );
  const seenKey = seenChapters(saved).slice().sort().join(',');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    let retry: number | undefined;
    const valid = () => active && current();
    void (async () => {
      try {
        const remote = await api.call(IdentityEndpoints.getOnboardingGuides, { networkOnly: true });
        if (!valid()) return;
        const local = seenChapters(recordRef.current);
        const result = local.some((chapter) => !remote.seen.includes(chapter))
          ? await api.call(IdentityEndpoints.syncOnboardingGuides, { body: { seen: local } })
          : remote;
        if (!valid()) return;
        update((record) => mergeGuideSeen(record, result.seen));
        setReady(true);
      } catch {
        // 不把读取失败解释为新用户；恢复网络/返回前台时重新核对，不弹错误框。
        if (valid()) retry = window.setTimeout(() => refresh((n) => n + 1), 30_000);
      }
    })();
    return () => {
      active = false;
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [current, update, seenKey, revision]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== key || !current()) return;
      const next = mergeGuideSeen(recordRef.current, seenChapters(readGuideRecord(key)));
      recordRef.current = next;
      setSaved(next);
    };
    const retry = () => {
      if (document.visibilityState === 'visible') refresh((n) => n + 1);
    };
    window.addEventListener('storage', changed);
    window.addEventListener('online', retry);
    window.addEventListener('weiban:settings-updated', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('online', retry);
      window.removeEventListener('weiban:settings-updated', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [key, current]);
  const claim = useCallback(
    async (chapter: ChapterId): Promise<boolean> => {
      if (!current()) return false;
      try {
        const result = await api.call(IdentityEndpoints.syncOnboardingGuides, {
          body: { seen: seenChapters(recordRef.current), claim: chapter },
        });
        if (!current()) return false;
        update((record) => mergeGuideSeen(record, result.seen));
        return result.claimed;
      } catch {
        return false;
      }
    },
    [current, update],
  );
  return { saved, recordRef, update, ready, claim };
}
