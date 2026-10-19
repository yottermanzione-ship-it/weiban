import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './hooks.js';

/**
 * 轻量异步加载：key 变化时重新请求，loader 用 ref 保存避免闭包陷阱。
 * 返回的 refresh 用于「保存后刷新列表」。
 */
export function useAsync<T>(key: string, loader: () => Promise<T>) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void loaderRef
      .current()
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
  }, [key, revision]);

  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  return { data, error, loading, refresh };
}

/** 逐个执行，失败不影响其它项（工作台一次拉多个统计用）。 */
export async function settle<T>(work: Promise<T>): Promise<T | undefined> {
  try {
    return await work;
  } catch {
    return undefined;
  }
}
