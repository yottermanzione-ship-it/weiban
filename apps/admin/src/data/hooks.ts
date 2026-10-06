import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { EndpointDef } from '@weiban/contracts';
import { ApiFailure, type RequestOptions } from '@weiban/client-core';
import { api } from './client.js';
export function errorText(value: unknown): string {
  return value instanceof ApiFailure
    ? value.message
    : value instanceof z.ZodError
      ? '请检查必填字段和格式'
      : '操作未完成，请检查填写内容';
}
export function useRemote<E extends EndpointDef>(endpoint: E, options: RequestOptions<E> = {}) {
  const signature = JSON.stringify(options);
  const [data, setData] = useState<z.output<E['response']>>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api
      .call(endpoint, JSON.parse(signature) as RequestOptions<E>)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e: unknown) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint, signature, revision]);
  return { data, error, loading, refresh: () => setRevision((v) => v + 1) };
}
