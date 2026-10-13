/*
 * 星标朋友（docs/refactor/06-old-ui-spec.md 4.6、4.12）：契约里没有星标字段，先存本机（不跨设备同步）。
 */
import { useEffect, useState } from 'react';
const KEY = 'weiban:starred-characters';
const EVENT = 'weiban:stars-changed';
function read(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
export function useStars() {
  const [stars, setStars] = useState(read);
  useEffect(() => {
    const update = () => setStars(read());
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return {
    stars,
    isStarred: (id: string) => stars.includes(id),
    toggle(id: string) {
      const next = stars.includes(id) ? stars.filter((s) => s !== id) : [...stars, id];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // 无痕模式：只在本次打开时生效
      }
      window.dispatchEvent(new Event(EVENT));
    },
  };
}
