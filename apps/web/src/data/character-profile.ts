import { useEffect, useRef, useState } from 'react';
import { CharacterEndpoints, type CharacterProfile } from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { api } from './client.js';

type Owner = { userId: string; sessionId: string };
const pending = new Map<string, Promise<CharacterProfile>>();
/** 资料只用来显示名字和头像，一分钟内重复读取直接用刚拿到的结果，切页面不再重新生成图片链接。 */
const FRESH_MS = 60_000;
const profileRequest = (id: string) => ({ params: { characterId: id } });
const STALE_OK = { allowStale: true } as const;

/** A name and avatar share one request; never share requests between login sessions. */
export function loadCharacterProfile(
  id: string,
  owner: Owner,
  force = false,
): Promise<CharacterProfile> {
  if (!api.owns(owner))
    return Promise.reject(new ApiFailure('session_changed', '登录状态已改变', 0));
  const key = `${owner.userId}:${owner.sessionId}:${id}`;
  const existing = pending.get(key);
  if (existing) return existing;
  if (!force) {
    const fresh = api.peek(CharacterEndpoints.getProfile, profileRequest(id));
    if (fresh && fresh.ageMs < FRESH_MS) return Promise.resolve(fresh.value);
  }
  const started = api.call(CharacterEndpoints.getProfile, profileRequest(id));
  pending.set(key, started);
  void started
    .finally(() => {
      if (pending.get(key) === started) pending.delete(key);
    })
    .catch(() => {});
  return started;
}

type Result = { key: string; data?: CharacterProfile; loading: boolean; errorCode?: string };
export function useCharacterProfile(id: string) {
  const { session } = useAuth();
  const userId = session?.user.userId;
  const sessionId = session?.session.sessionId;
  const key = `${userId}:${sessionId}:${id}`;
  const [state, setState] = useState<Result>(() => seed());
  const [revision, setRevision] = useState(0);
  /** 设置更新（weiban:settings-updated）时跳过一次「刚读过就直接用」。 */
  const forced = useRef(false);
  function seed(): Result {
    if (!userId || !sessionId || !id) return { key, loading: true };
    // U8：旧结果（含启动时从本机库 prime 进来的）也先画，随后照常回源刷新。
    const hit = api.peek(CharacterEndpoints.getProfile, profileRequest(id), STALE_OK);
    return hit ? { key, data: hit.value, loading: false } : { key, loading: true };
  }
  useEffect(() => {
    const refresh = () => {
      forced.current = true;
      setRevision((value) => value + 1);
    };
    window.addEventListener('weiban:settings-updated', refresh);
    return () => window.removeEventListener('weiban:settings-updated', refresh);
  }, []);
  useEffect(() => {
    if (!userId || !sessionId || !id) return;
    const owner = { userId, sessionId };
    const force = forced.current;
    forced.current = false;
    let active = true;
    const hit = api.peek(CharacterEndpoints.getProfile, profileRequest(id), STALE_OK);
    if (hit) setState({ key, data: hit.value, loading: false });
    else
      setState((previous) => ({
        key,
        loading: true,
        data: previous.key === key ? previous.data : undefined,
      }));
    void (async () => {
      try {
        if (!hit) {
          const cached = await api
            .cached(CharacterEndpoints.getProfile, profileRequest(id))
            .catch(() => undefined);
          if (!active || !api.owns(owner)) return;
          if (cached) setState({ key, data: cached, loading: false });
        }
        const data = await loadCharacterProfile(id, owner, force);
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
  /**
   * 资料请求因网络失败停在占位后：网络恢复 / 页面重新可见时只重试一次，不轮询、
   * 不做全局重试；成功或换账号后监听自动卸载。4xx/5xx 等非网络错误不在此列。
   */
  useEffect(() => {
    if (state.errorCode !== 'network_error') return;
    const retry = () => setRevision((value) => value + 1);
    const visible = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [state.errorCode]);
  return state.key === key ? state : seed();
}
