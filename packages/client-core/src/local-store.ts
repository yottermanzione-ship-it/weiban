import { AuthResponse } from '@weiban/contracts';
/** 数据按应用和账号隔离；退出登录删除本机令牌、缓存及待发队列。 */
export interface LocalStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}
export interface StoreOwner {
  userId: string;
  sessionId: string;
}
/** 事务失败时带上浏览器原始错误（如 QuotaExceededError），便于上层判断是不是空间不足。 */
function storeError(message: string, tx: IDBTransaction, failure?: unknown): unknown {
  if (failure) return failure;
  const error = tx.error;
  return error ?? new Error(message);
}
export class IndexedLocalStore implements LocalStore {
  private database: Promise<IDBDatabase>;
  constructor(
    private readonly name: string,
    private readonly factory: IDBFactory = indexedDB,
  ) {
    this.database = this.open();
  }
  private open(): Promise<IDBDatabase> {
    const opening: Promise<IDBDatabase> = new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => {
        for (const store of ['records', 'outbox', 'sync']) request.result.createObjectStore(store);
      };
      request.onerror = () => reject(new Error('本机存储不可用，请检查浏览器设置'));
      request.onsuccess = () => {
        const db = request.result;
        // 浏览器可能在后台、清理站点数据或内部出错时关掉连接（Safari 常见），下次用时重开。
        db.onclose = () => {
          if (this.database === opening) this.database = this.open();
        };
        resolve(db);
      };
    });
    return opening;
  }
  /** 连接已被关掉（InvalidStateError）时重开一次再试，不把它当成设备存储故障。 */
  /** 请求必须在建事务的同一拍里发出，所以 body 同步拿到事务。 */
  private async transaction<T>(
    names: string | string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const current = this.database;
    const db = await current;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(names, mode);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'InvalidStateError') throw error;
      if (this.database === current) this.database = this.open();
      tx = (await this.database).transaction(names, mode);
    }
    return body(tx);
  }
  private run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return this.transaction(
      'records',
      mode,
      (tx) =>
        new Promise((resolve, reject) => {
          const request = action(tx.objectStore('records'));
          tx.oncomplete = () => resolve(request.result);
          tx.onabort = tx.onerror = () => reject(storeError('本机存储操作失败', tx));
        }),
    );
  }
  get(key: string): Promise<unknown> {
    return this.run('readonly', (store) => store.get(key));
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.run('readwrite', (store) => store.put(value, key));
  }
  /** 归属检查与写入同一事务：退出清库后，迟到的驱动不能重建旧账号数据。 */
  async setOwned(owner: StoreOwner, key: string, value: unknown): Promise<boolean> {
    return this.setOwnedValues(owner, { [key]: value });
  }
  /** Multiple UI records commit together, with the same account check as a single write. */
  async setOwnedValues(
    owner: StoreOwner,
    values: Record<string, unknown>,
    expected?: { key: string; value: boolean },
  ): Promise<boolean> {
    if (Object.hasOwn(values, 'session')) throw new Error('驱动不能改写登录会话');
    return this.transaction(
      'records',
      'readwrite',
      (tx) =>
        new Promise((resolve, reject) => {
          const records = tx.objectStore('records');
          const request = records.get('session');
          let written = false;
          let failure: unknown;
          const commit = () => {
            try {
              for (const [key, value] of Object.entries(values)) records.put(value, key);
              written = true;
            } catch (error) {
              failure = error;
              tx.abort();
            }
          };
          request.onsuccess = () => {
            const parsed = AuthResponse.safeParse(request.result);
            if (
              !parsed.success ||
              parsed.data.user.userId !== owner.userId ||
              parsed.data.session.sessionId !== owner.sessionId
            )
              return;
            if (!expected) commit();
            else {
              const condition = records.get(expected.key);
              condition.onsuccess = () => {
                if (condition.result === expected.value) commit();
              };
            }
          };
          tx.oncomplete = () => resolve(written);
          tx.onabort = tx.onerror = () => reject(storeError('同步数据保存失败', tx, failure));
        }),
    );
  }
  async clear(): Promise<void> {
    await this.transaction(
      ['records', 'outbox', 'sync'],
      'readwrite',
      (tx) =>
        new Promise<void>((resolve, reject) => {
          for (const name of ['records', 'outbox', 'sync']) tx.objectStore(name).clear();
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(new Error('清理本机数据失败'));
        }),
    );
  }
}
