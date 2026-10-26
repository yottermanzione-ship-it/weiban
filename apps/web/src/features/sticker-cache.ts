/**
 * 表情商店的本地缓存。
 *
 * 为什么不能只靠浏览器：封面/预览用的是按用户签发、几分钟过期的访问链接，响应头是
 * `private,no-store`（媒体删除后旧链接必须立刻失效），所以浏览器每次都重新下载。
 * 这里用应用自己的缓存：封面按「系列ID+更新时间」存成 Blob，列表存一份快照，
 * 只在数据真的变化时重下，既不会长期缓存已删除的包，也不改媒体接口的安全头。
 */
const DB_NAME = 'weiban-stickers';
const DB_VERSION = 1;
const STORE = 'covers';
const LIST_KEY = 'weiban:sticker-store:v1';
/** 列表快照只用于首屏立即显示，超过这个时间仍会后台刷新。 */
const LIST_MAX_AGE_MS = 30 * 60 * 1000;

export interface CachedPack {
  packId: string;
  name: string;
  intro: string;
  coverUrl: string | null;
  stickerCount: number;
  added: boolean;
  builtIn: boolean;
  enabled: boolean;
  inStore: boolean;
  updatedAt: string;
}

function idb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'packId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

interface CoverRow {
  packId: string;
  updatedAt: string;
  blob: Blob;
}

/** 取仍对得上当前版本号的封面；版本变化就当作没有缓存。 */
export async function readCover(packId: string, updatedAt: string): Promise<Blob | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const get = tx.objectStore(STORE).get(packId);
      get.onsuccess = () => {
        const row = get.result as CoverRow | undefined;
        resolve(row && row.updatedAt === updatedAt && row.blob instanceof Blob ? row.blob : null);
      };
      get.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
}

export async function writeCover(packId: string, updatedAt: string, blob: Blob): Promise<void> {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ packId, updatedAt, blob } satisfies CoverRow);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    } finally {
      db.close();
    }
  });
}

/** 上次成功拿到的列表快照；过旧或结构不符就忽略。 */
export function readStoreSnapshot(): CachedPack[] | null {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; items?: unknown };
    if (!parsed?.at || Date.now() - parsed.at > LIST_MAX_AGE_MS || !Array.isArray(parsed.items))
      return null;
    return parsed.items as CachedPack[];
  } catch {
    return null;
  }
}

export function saveStoreSnapshot(items: CachedPack[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify({ at: Date.now(), items }));
  } catch {
    // 存储满了或被禁用：只是下次要多加载一次，不影响使用。
  }
}
