/** 数据按应用和账号隔离；退出登录删除本机令牌、缓存及待发队列。 */
export interface LocalStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}
export class IndexedLocalStore implements LocalStore {
  private readonly database: Promise<IDBDatabase>;
  constructor(name: string, factory: IDBFactory = indexedDB) {
    this.database = new Promise((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        for (const store of ['records', 'outbox', 'sync']) request.result.createObjectStore(store);
      };
      request.onerror = () => reject(new Error('本机存储不可用，请检查浏览器设置'));
      request.onsuccess = () => resolve(request.result);
    });
  }
  private async run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', mode);
      const request = action(tx.objectStore('records'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(new Error('本机存储操作失败'));
    });
  }
  get(key: string): Promise<unknown> {
    return this.run('readonly', (store) => store.get(key));
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.run('readwrite', (store) => store.put(value, key));
  }
  async clear(): Promise<void> {
    const db = await this.database;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['records', 'outbox', 'sync'], 'readwrite');
      for (const name of ['records', 'outbox', 'sync']) tx.objectStore(name).clear();
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error('清理本机数据失败'));
    });
  }
}
