import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../app/auth.js';

/**
 * 「看过了」记录（卡册、成就宫格红点用）：只存本机，读写失败时当作没有红点。
 * 第一次使用时把当前状态记为基线，已有的卡片 / 成就不亮红点。
 */
const EVENT = 'weiban:seen-changed';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式等情况下不记，红点不显示即可。 */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useSeenRecord<T>(name: string) {
  const { session } = useAuth();
  const key = `wb.seen.${name}.${session?.user.userId ?? 'anon'}`;
  const [value, setValue] = useState<T | null>(() => read<T>(key));
  useEffect(() => {
    const refresh = () => setValue(read<T>(key));
    refresh();
    window.addEventListener(EVENT, refresh);
    return () => window.removeEventListener(EVENT, refresh);
  }, [key]);
  const save = useCallback((next: T) => write(key, next), [key]);
  return [value, save] as const;
}
