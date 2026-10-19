import { useEffect, useState } from 'react';
import { CharacterEndpoints, type CharacterProfile } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { api } from './client.js';

type Owner = { userId: string; sessionId: string };
const pending = new Map<string, Promise<CharacterProfile>>();

/** A name and avatar share one request; never share requests between login sessions. */
export function loadCharacterProfile(id: string, owner: Owner): Promise<CharacterProfile> {
  if (!api.owns(owner))
    return Promise.reject(new ApiFailure('session_changed', '登录状态已改变', 0));
  const key = `${owner.userId}:${owner.sessionId}:${id}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = api.call(CharacterEndpoints.getProfile, { params: { characterId: id } });
  pending.set(key, request);
  void request
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    })
    .catch(() => {});
  return request;
}

type Result = { key: string; data?: CharacterProfile; loading: boolean; errorCode?: string };
export function useCharacterProfile(id: string) {
  const { session } = useAuth();
  const userId = session?.user.userId;
  const sessionId = session?.session.sessionId;
  const key = `${userId}:${sessionId}:${id}`;
  const [state, setState] = useState<Result>({ key, loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('weiban:settings-updated', refresh);
    return () => window.removeEventListener('weiban:settings-updated', refresh);
  }, []);
  useEffect(() => {
    let active = true;
    if (!userId || !sessionId || !id) return;
    const owner = { userId, sessionId };
    setState((previous) => ({
      key,
      loading: true,
      data: previous.key === key ? previous.data : undefined,
    }));
    void (async () => {
      try {
        const cached = await api.cached(CharacterEndpoints.getProfile, {
          params: { characterId: id },
        });
        if (!active || !api.owns(owner)) return;
        if (cached) setState({ key, data: cached, loading: true });
        const data = await loadCharacterProfile(id, owner);
        if (active && api.owns(owner)) setState({ key, data, loading: false });
      } catch (error) {
        if (active && api.owns(owner))
          setState((previous) => ({
            key,
            data: previous.key === key ? previous.data : undefined,
            loading: false,
            errorCode: error instanceof ApiFailure ? error.code : 'network_error',
          }));
      }
    })();
    return () => {
      active = false;
    };
  }, [id, userId, sessionId, key, revision]);
  return state.key === key ? state : { key, loading: true, data: undefined, errorCode: undefined };
}
