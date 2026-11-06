import { afterEach, expect, it, vi } from 'vitest';
import {
  addRefreshGuard,
  readDeployedWebBuild,
  refreshToLatestWeb,
  consumeWebRefreshResult,
} from '../src/app/manual-update.js';
afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(build = 101) {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ version: '0.1.0', versionCode: build })),
  );
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('navigator', {});
  const events = new EventTarget();
  const reload = vi.fn();
  vi.stubGlobal('window', Object.assign(events, { location: { reload } }));
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  return { fetcher, events, reload };
}
it('checks deployed build without the cache and without refreshing or erasing stored user data', async () => {
  const { fetcher, reload } = setup();
  expect(await readDeployedWebBuild()).toEqual({ version: '0.1.0', versionCode: 101 });
  expect(fetcher.mock.calls[0]).toEqual([
    expect.stringContaining('/build-info.json?check='),
    expect.objectContaining({ cache: 'no-store' }),
  ]);
  expect(reload).not.toHaveBeenCalled();
});
it('offline or invalid build metadata never reports the user is up to date', async () => {
  const { fetcher } = setup();
  fetcher.mockRejectedValueOnce(new TypeError('network'));
  await expect(readDeployedWebBuild()).rejects.toThrow('检查更新失败');
  fetcher.mockResolvedValueOnce(new Response('{"version":"0.1.0"}'));
  await expect(readDeployedWebBuild()).rejects.toThrow('版本信息不完整');
});
it('a live call or recording blocks before a network request and can be released later', async () => {
  const { fetcher, reload } = setup();
  const remove = addRefreshGuard(() => '请先结束通话，再刷新网页');
  try {
    await expect(refreshToLatestWeb()).rejects.toThrow('请先结束通话');
    expect(fetcher).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  } finally {
    remove();
  }
});
it('a failed update download leaves the current chat connection alone', async () => {
  const { fetcher, events, reload } = setup();
  const paused = vi.fn();
  const resumed = vi.fn();
  events.addEventListener('weiban:before-update', paused);
  events.addEventListener('weiban:update-failed', resumed);
  fetcher.mockRejectedValueOnce(new TypeError('offline'));
  await expect(refreshToLatestWeb()).rejects.toThrow('检查更新失败');
  expect(paused).not.toHaveBeenCalled();
  expect(resumed).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
it('waits for pending local writes; failed writes resume chat instead of reloading', async () => {
  const { events, reload } = setup();
  let release!: () => void;
  const saving = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failed = vi.fn();
  const preparing = vi.fn();
  events.addEventListener('weiban:update-failed', failed);
  events.addEventListener('weiban:before-update', (event) => {
    preparing();
    (event as CustomEvent<{ waitUntil(work: Promise<void>): void }>).detail.waitUntil(saving);
    (event as CustomEvent<{ waitUntil(work: Promise<void>): void }>).detail.waitUntil(
      Promise.reject(new Error('local write failed')),
    );
  });
  const pending = refreshToLatestWeb();
  await vi.waitFor(() => expect(preparing).toHaveBeenCalledOnce());
  expect(reload).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
  release();
  await expect(pending).rejects.toThrow('本机消息尚未保存完成');
  expect(reload).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledOnce();
});
it('records the expected build and checks the actual loaded build, including rollback', async () => {
  const { reload } = setup(99);
  await refreshToLatestWeb();
  expect(reload).toHaveBeenCalledOnce();
  expect(consumeWebRefreshResult(100)).toContain('尚未切换');
  await refreshToLatestWeb();
  expect(consumeWebRefreshResult(99)).toContain('已刷新');
  expect(consumeWebRefreshResult(99)).toBeNull();
});
