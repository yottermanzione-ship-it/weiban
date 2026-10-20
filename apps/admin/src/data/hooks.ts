import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { EndpointDef } from '@weiban/contracts';
import { ApiFailure, type RequestOptions } from '@weiban/client-core';
import { api } from './client.js';
import { describeIssues, issuesOf, isZodError } from './issues.js';
/**
 * 把任意错误变成一句给人看的话。
 * 字段校验失败（发请求前的契约校验 / 服务器 bad_request）会具体到哪一项、怎么改。
 */
export function errorText(value: unknown): string {
  const issues = issuesOf(value);
  if (isZodError(value)) return issues?.length ? describeIssues(issues) : '请检查填写内容';
  if (value instanceof ApiFailure) return issues?.length ? describeIssues(issues) : value.message;
  return '操作未完成，请检查填写内容';
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
