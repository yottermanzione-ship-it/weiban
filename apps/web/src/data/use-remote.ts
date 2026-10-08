import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { EndpointDef } from '@weiban/contracts';
import { ApiFailure, type RequestOptions } from '@weiban/client-core';
import { api } from './client.js';
export function friendlyError(error: unknown): string {
  return error instanceof ApiFailure ? error.message : '请检查填写的内容，稍后再试';
}
export function useRemote<E extends EndpointDef>(endpoint: E, options: RequestOptions<E> = {}) {
  const key = JSON.stringify(options);
  const [data, setData] = useState<z.output<E['response']>>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('weiban:settings-updated', refresh);
    return () => window.removeEventListener('weiban:settings-updated', refresh);
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const request = JSON.parse(key) as RequestOptions<E>;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const cached = request.networkOnly ? undefined : await api.cached(endpoint, request);
        if (active && cached !== undefined) setData(cached);
        const result = await api.call(endpoint, { ...request, signal: controller.signal });
        if (active) setData(result);
      } catch (e) {
        if (active) setError(friendlyError(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [endpoint, key, revision]);
  return { data, error, loading, refresh: () => setRevision((v) => v + 1) };
}
