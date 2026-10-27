import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { EndpointDef } from '@weiban/contracts';
import { ApiFailure, type RequestOptions } from '@weiban/client-core';
import { api } from './client.js';
export function friendlyError(error: unknown): string {
  return error instanceof ApiFailure ? error.message : '请检查填写的内容，稍后再试';
}
type Result<T> = { key: string; data?: T; error: string; loading: boolean };
const STALE_OK = { allowStale: true } as const;
/**
 * enabled = false 时不请求（同一组件里按条件二选一的接口）。
 * 上次的结果先同步画出来（api.peek），再在后台回源更新，所以切回页面不会先清空成占位或空列表；
 * U8：超过 4 分钟的内存结果、启动时从本机库 prime 进来的结果也先画（allowStale），不再先闪一帧骨架屏；
 * 同一个资源的并发请求由 api-client 合并，组件卸载也不会取消别的组件还在等的那次请求。
 */
export function useRemote<E extends EndpointDef>(
  endpoint: E,
  options: RequestOptions<E> = {},
  enabled = true,
) {
  const key = JSON.stringify(options);
  const [state, setState] = useState<Result<z.output<E['response']>>>(() => seed());
  const [revision, setRevision] = useState(0);
  function seed(): Result<z.output<E['response']>> {
    if (!enabled) return { key, error: '', loading: false };
    const hit = api.peek(endpoint, options, STALE_OK);
    return { key, data: hit?.value, error: '', loading: !hit };
  }
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('weiban:settings-updated', refresh);
    return () => window.removeEventListener('weiban:settings-updated', refresh);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    // 换账号后旧请求迟到返回，不能写进新账号的页面。
    const owner = api.ownerKey();
    const live = () => active && api.ownerKey() === owner;
    const request = JSON.parse(key) as RequestOptions<E>;
    const hit = api.peek(endpoint, request, STALE_OK);
    setState((previous) => {
      const data = hit?.value ?? (previous.key === key ? previous.data : undefined);
      return { key, data, error: '', loading: data === undefined };
    });
    void (async () => {
      try {
        if (!hit && !request.networkOnly) {
          const cached = await api.cached(endpoint, request).catch(() => undefined);
          if (!live()) return;
          if (cached !== undefined) setState({ key, data: cached, error: '', loading: false });
        }
        if (!live()) return;
        const result = await api.call(endpoint, request);
        if (live()) setState({ key, data: result, error: '', loading: false });
      } catch (error) {
        if (!live()) return;
        setState((previous) => ({
          key,
          data: previous.key === key ? previous.data : undefined,
          error: friendlyError(error),
          loading: false,
        }));
      }
    })();
    return () => {
      active = false;
    };
  }, [endpoint, key, revision, enabled]);
  const current = state.key === key ? state : seed();
  return {
    data: current.data,
    error: current.error,
    loading: current.loading,
    refresh: () => setRevision((value) => value + 1),
  };
}
