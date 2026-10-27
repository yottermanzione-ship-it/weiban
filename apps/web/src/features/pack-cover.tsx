import { useEffect, useState } from 'react';
import { memoryCover, preloadCover } from './sticker-cache.js';

/**
 * 系列封面：优先用本地缓存的 Blob，只有版本变化或首次才真正下载。
 * U8：本次打开里读过 / 启动时预加载过的封面首帧就用内存里的地址，不再先闪网络图；
 * 地址由 sticker-cache 统一保管（有上限），组件卸载不回收。
 * 缓存失败/隐私模式下一律退回普通 img，不影响显示。
 */
export function PackCover({
  packId,
  url,
  updatedAt,
  alt = '',
  className,
}: {
  packId: string;
  url: string | null;
  updatedAt: string;
  alt?: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState<{ key: string; src: string } | null>(null);
  const key = `${packId}|${updatedAt}`;
  const src = memoryCover(packId, updatedAt) ?? (loaded?.key === key ? loaded.src : null);
  useEffect(() => {
    if (!url || memoryCover(packId, updatedAt)) return;
    let alive = true;
    void preloadCover(packId, updatedAt, url).then((ready) => {
      const local = ready ? memoryCover(packId, updatedAt) : undefined;
      if (alive && local) setLoaded({ key: `${packId}|${updatedAt}`, src: local });
    });
    return () => {
      alive = false;
    };
  }, [packId, url, updatedAt]);
  if (!url) return null;
  return <img className={className} src={src ?? url} alt={alt} loading="lazy" />;
}
