import { useEffect, useState } from 'react';
import { readCover, writeCover } from './sticker-cache.js';

/**
 * 系列封面：优先用本地缓存的 Blob，只有版本变化或首次才真正下载。
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
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let created: string | null = null;
    void (async () => {
      const cached = await readCover(packId, updatedAt);
      if (!alive) return;
      if (cached) {
        created = URL.createObjectURL(cached);
        setSrc(created);
        return;
      }
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const blob = await response.blob();
        if (!alive) return;
        void writeCover(packId, updatedAt, blob);
        created = URL.createObjectURL(blob);
        setSrc(created);
      } catch {
        // 取不到就走原始链接。
      }
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [packId, url, updatedAt]);
  if (!url) return null;
  return <img className={className} src={src ?? url} alt={alt} loading="lazy" />;
}
