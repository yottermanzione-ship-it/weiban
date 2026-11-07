import { afterEach, expect, it, vi } from 'vitest';
import {
  addRefreshGuard,
  readDeployedWebBuild,
  refreshToLatestWeb,
  consumeWebRefreshResult,
} from '../src/app/manual-update.js';
afterEach(() => {
  vi.useRealTimers();
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
  expect(consumeWebRefreshResult(99)).toContain('已更新');
  expect(consumeWebRefreshResult(99)).toBeNull();
});

it('a transport that ignores abort cannot leave the update button waiting forever', async () => {
  vi.useFakeTimers();
  const { fetcher, reload } = setup();
  fetcher.mockImplementationOnce(() => new Promise<Response>(() => {}));
  const checking = expect(readDeployedWebBuild()).rejects.toThrow('检查更新超时');
  await vi.advanceTimersByTimeAsync(15_001);
  await checking;
  expect(reload).not.toHaveBeenCalled();
  expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
});

it('a response body that stalls and an unavailable version service give actionable failures', async () => {
  vi.useFakeTimers();
  const { fetcher } = setup();
  const response = new Response('{}');
  vi.spyOn(response, 'json').mockImplementationOnce(() => new Promise(() => {}));
  fetcher.mockResolvedValueOnce(response);
  const checking = expect(readDeployedWebBuild()).rejects.toThrow('版本信息读取超时');
  await vi.advanceTimersByTimeAsync(10_001);
  await checking;
  expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
  fetcher.mockResolvedValueOnce(new Response('', { status: 503 }));
  await expect(readDeployedWebBuild()).rejects.toThrow('版本服务暂时不可用（503）');
});

it('a call that starts while local writes drain prevents the final reload and resumes chat', async () => {
  const { events, reload } = setup();
  let talking = false;
  const remove = addRefreshGuard(() => (talking ? '请先结束通话' : null));
  const resumed = vi.fn();
  events.addEventListener('weiban:update-failed', resumed);
  events.addEventListener('weiban:before-update', (event) => {
    (event as CustomEvent<{ waitUntil(work: Promise<void>): void }>).detail.waitUntil(
      Promise.resolve().then(() => {
        talking = true;
      }),
    );
  });
  try {
    await expect(refreshToLatestWeb()).rejects.toThrow('请先结束通话');
    expect(reload).not.toHaveBeenCalled();
    expect(resumed).toHaveBeenCalledOnce();
  } finally {
    remove();
  }
});

function waitingWorker() {
  const worker = Object.assign(new EventTarget(), { state: 'installed', postMessage: vi.fn() });
  const registration = { installing: null, waiting: worker, update: vi.fn(async () => {}) };
  vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => registration) } });
  return worker;
}
it('does not reload until the downloaded worker is activated, even beyond the old four-second wait', async () => {
  vi.useFakeTimers();
  const { reload, events } = setup();
  const worker = waitingWorker();
  const saved = vi.fn();
  events.addEventListener('weiban:before-update', saved);
  const updating = refreshToLatestWeb();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(saved).toHaveBeenCalledOnce();
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING', reloadClient: false });
  expect(reload).not.toHaveBeenCalled();
  worker.state = 'activated';
  worker.dispatchEvent(new Event('statechange'));
  await updating;
  expect(reload).toHaveBeenCalledOnce();
});
it('activation timeout restores chat and never reports a successful update', async () => {
  vi.useFakeTimers();
  const { reload, events } = setup();
  waitingWorker();
  const resumed = vi.fn();
  events.addEventListener('weiban:update-failed', resumed);
  const updating = expect(refreshToLatestWeb()).rejects.toThrow('新版尚未接管');
  await vi.advanceTimersByTimeAsync(15_001);
  await updating;
  expect(reload).not.toHaveBeenCalled();
  expect(resumed).toHaveBeenCalledOnce();
  expect(consumeWebRefreshResult(101)).toBeNull();
});
