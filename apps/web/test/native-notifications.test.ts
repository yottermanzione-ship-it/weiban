import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/data/client.js', () => ({
  api: { owns: vi.fn(() => true) },
  localStore: { get: vi.fn(), setOwned: vi.fn() },
}));
import { nativeNoticeRequest } from '../src/notifications/native.js';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function bridge() {
  const native = {
    postMessage: vi.fn(),
    onmessage: null as ((event: { data: string }) => void) | null,
  };
  vi.stubGlobal('window', { weibanNotifications: native, setTimeout, clearTimeout });
  return native;
}
it('routes concurrent out-of-order replies by request ID and ignores malformed replies', async () => {
  const native = bridge();
  const first = nativeNoticeRequest('status');
  const second = nativeNoticeRequest('check');
  const ids = native.postMessage.mock.calls.map(
    ([body]) => (JSON.parse(body as string) as { id: string }).id,
  );
  native.onmessage?.({ data: 'null' });
  native.onmessage?.({ data: JSON.stringify({ id: ids[1], ok: true, enabled: false }) });
  native.onmessage?.({ data: JSON.stringify({ id: ids[0], ok: true, enabled: true }) });
  expect((await first).enabled).toBe(true);
  expect((await second).enabled).toBe(false);
});
it('permission denial and old native packages never report notification enabled', async () => {
  const native = bridge();
  const work = nativeNoticeRequest('enable');
  const id = (JSON.parse(native.postMessage.mock.calls[0]![0] as string) as { id: string }).id;
  native.onmessage?.({
    data: JSON.stringify({ id, ok: false, enabled: false, reason: 'permission' }),
  });
  await expect(work).rejects.toThrow('系统通知尚未允许');
  vi.stubGlobal('window', {});
  await expect(nativeNoticeRequest('enable')).rejects.toThrow('覆盖安装');
});
