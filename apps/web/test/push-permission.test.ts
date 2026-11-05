import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), call: vi.fn() }));
vi.mock('../src/data/client.js', () => ({
  localStore: { get: mocks.get },
  api: { call: mocks.call },
}));
import { enableWebPush } from '../src/notifications/client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function browser(permission: NotificationPermission) {
  const notification = {
    permission,
    requestPermission: vi.fn(async () => {
      notification.permission = 'granted';
      return 'granted' as const;
    }),
  };
  const requestPermission = notification.requestPermission;
  vi.stubGlobal('window', {
    Notification: {},
    PushManager: {},
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal('navigator', { userAgent: 'desktop test browser', serviceWorker: {} });
  vi.stubGlobal('Notification', notification);
  return requestPermission;
}
it('asks in the original click stack before any storage or network read', async () => {
  const request = browser('default');
  mocks.get.mockRejectedValue(new Error('synthetic storage failure'));
  const work = enableWebPush();
  expect(request).toHaveBeenCalledTimes(1);
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.call).not.toHaveBeenCalled();
  await expect(work).rejects.toThrow();
  expect(mocks.get).toHaveBeenCalledTimes(1);
});
it('an existing denial gives recovery advice without making a fake prompt request', async () => {
  const request = browser('denied');
  await expect(enableWebPush()).rejects.toThrow('网站或系统设置');
  expect(request).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalled();
});

it('a fresh denial immediately explains recovery and does not attempt a subscription', async () => {
  browser('default');
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: async () => 'denied' });
  await expect(enableWebPush()).rejects.toThrow('网站或系统设置');
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.call).not.toHaveBeenCalled();
});
