import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedLocalStore } from '../src/local-store.js';

function failedOpen(error: DOMException): IDBOpenDBRequest {
  const request = { error, onerror: null as (() => void) | null };
  queueMicrotask(() => request.onerror?.());
  return request as unknown as IDBOpenDBRequest;
}

it('本机数据库首次临时打开失败后，同一页面仍能读写并保存会话', async () => {
  const factory = new IDBFactory();
  const open = vi
    .spyOn(factory, 'open')
    .mockImplementationOnce(() =>
      failedOpen(new DOMException('temporary database failure', 'UnknownError')),
    );
  const store = new IndexedLocalStore('transient-open', factory);
  await expect(store.get('session')).resolves.toBeUndefined();
  await store.set('session', { synthetic: true });
  expect(await store.get('session')).toEqual({ synthetic: true });
  expect(open).toHaveBeenCalledTimes(2);
});

it('持续拒绝存储不无限重试，恢复权限后同一实例可以继续使用', async () => {
  const factory = new IDBFactory();
  const native = factory.open.bind(factory);
  let denied = true;
  const open = vi
    .spyOn(factory, 'open')
    .mockImplementation((...args) =>
      denied ? failedOpen(new DOMException('storage denied', 'SecurityError')) : native(...args),
    );
  const store = new IndexedLocalStore('denied-then-restored', factory);
  await expect(store.get('session')).rejects.toMatchObject({ name: 'SecurityError' });
  expect(open).toHaveBeenCalledTimes(2);
  denied = false;
  await store.set('session', { synthetic: true });
  expect(await store.get('session')).toEqual({ synthetic: true });
  expect(open).toHaveBeenCalledTimes(3);
});

it('并发读取复用一次重开，登录预检不改已有会话和缓存', async () => {
  const factory = new IDBFactory();
  const open = vi
    .spyOn(factory, 'open')
    .mockImplementationOnce(() =>
      failedOpen(new DOMException('temporary database failure', 'UnknownError')),
    );
  const store = new IndexedLocalStore('concurrent-open', factory);
  await Promise.all([store.get('session'), store.get('cache'), store.ensureWritable()]);
  expect(open).toHaveBeenCalledTimes(2);
  await store.set('session', { synthetic: true });
  await store.set('cache', { retained: true });
  await store.ensureWritable();
  expect(await store.get('session')).toEqual({ synthetic: true });
  expect(await store.get('cache')).toEqual({ retained: true });
});
