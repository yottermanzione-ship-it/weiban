import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Id } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { api, localStore } from './client.js';
const Draft = z.object({ characterId: Id, greeting: z.string().max(50) }).strict();
type Draft = z.infer<typeof Draft>;
export function useOnboardingDraft(enabled: boolean) {
  const { session } = useAuth();
  const owner = session
    ? { userId: session.user.userId, sessionId: session.session.sessionId }
    : null;
  const ownerKey = owner ? `${owner.userId}:${owner.sessionId}` : '';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    setReady(false);
    setDraft(null);
    if (!enabled || !owner) {
      setReady(true);
      return;
    }
    void localStore
      .get('ui:onboardingDraft')
      .then((value) => {
        if (!active || !api.owns(owner)) return;
        const parsed = Draft.safeParse(value);
        setDraft(parsed.success ? parsed.data : null);
        setError('');
        setReady(true);
      })
      .catch(() => {
        if (active) setError('无法读取引导进度，请重试');
      });
    return () => {
      active = false;
    };
    // The immutable account/session key owns this read; profile refresh keeps it stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ownerKey, revision]);
  function persist(value: Draft | null) {
    const write = writes.current.then(async () => {
      if (!owner || !api.owns(owner)) throw new ApiFailure('session_changed', '登录状态已改变', 0);
      if (
        !(await localStore.setOwnedValues(
          owner,
          { 'ui:onboardingDraft': value },
          { key: 'ui:onboarding', value: true },
        )) ||
        !api.owns(owner)
      )
        throw new ApiFailure('session_changed', '登录状态已改变', 0);
    });
    writes.current = write.catch(() => {});
    return write;
  }
  async function choose(characterId: string | null) {
    if (!ready || saving) return;
    setSaving(true);
    setError('');
    const next = characterId ? { characterId, greeting: '' } : null;
    try {
      await persist(next);
      setDraft(next);
    } catch {
      setError('无法保存引导进度，请稍后重试');
    } finally {
      setSaving(false);
    }
  }
  function greet(greeting: string) {
    if (!draft || !ready || saving) return;
    const next = { ...draft, greeting: greeting.slice(0, 50) };
    setDraft(next);
    setError('');
    void persist(next).catch(() => setError('无法保存招呼草稿，请稍后重试'));
  }
  return { draft, ready, saving, error, choose, greet, retry: () => setRevision((v) => v + 1) };
}
