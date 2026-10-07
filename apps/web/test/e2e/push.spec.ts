import { expect, test, type Page, type Worker } from '@playwright/test';
import { AuthResponse, NotificationEnvelope } from '@weiban/contracts';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
}
async function deliver(worker: Worker, raw: unknown) {
  await worker.evaluate(async (value) => {
    const pending: Promise<unknown>[] = [];
    const event = new Event('push');
    Object.defineProperties(event, {
      data: { value: { json: () => value } },
      waitUntil: { value: (work: Promise<unknown>) => pending.push(work) },
    });
    globalThis.dispatchEvent(event);
    await Promise.all(pending);
  }, raw);
}
async function notices(worker: Worker) {
  return worker.evaluate(async () =>
    (
      await (
        globalThis as unknown as { registration: ServiceWorkerRegistration }
      ).registration.getNotifications()
    ).map((notification) => ({
      title: notification.title,
      body: notification.body,
      tag: notification.tag,
    })),
  );
}
test('未配置通道时明确失败，不向系统请求通知权限', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: '开启此设备通知' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => Notification.permission)).not.toBe('granted');
});
test('实际Service Worker与通知系统夹具：归属/时效、去重、点击与退出清理', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['notifications'], { origin: 'http://127.0.0.1:5173' });
  await login(page);
  const auth = AuthResponse.parse(
    await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const request = indexedDB.open('weiban-app', 1);
          request.onsuccess = () => {
            const tx = request.result.transaction('records', 'readwrite');
            const records = tx.objectStore('records');
            const query = records.get('session');
            query.onsuccess = () => {
              const value = query.result as {
                user: { userId: string };
                session: { sessionId: string };
              };
              records.put(
                { userId: value.user.userId, sessionId: value.session.sessionId, enabled: true },
                'push-owner',
              );
            };
            tx.oncomplete = () => resolve(query.result);
          };
        }),
    ),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // 该无头环境的Notification.permission固定denied；仅系统展示层替身，SW/IDB/页面跳转真实。
  await worker.evaluate(() => {
    const scope = globalThis as unknown as {
      registration: ServiceWorkerRegistration;
      failNextNotice: boolean;
    };
    let notices: Notification[] = [];
    Object.defineProperty(scope.registration, 'showNotification', {
      value: async (title: string, options: NotificationOptions) => {
        if (scope.failNextNotice) {
          scope.failNextNotice = false;
          throw new DOMException('permission denied', 'NotAllowedError');
        }
        notices = notices.filter((item) => item.tag !== options.tag);
        const notice = {
          title,
          body: options.body ?? '',
          tag: options.tag ?? '',
          data: options.data,
          close: () => {
            notices = notices.filter((item) => item !== notice);
          },
        } as unknown as Notification;
        notices.push(notice);
      },
    });
    Object.defineProperty(scope.registration, 'getNotifications', {
      value: async (options?: GetNotificationOptions) =>
        notices.filter((item) => !options?.tag || item.tag === options.tag),
    });
  });
  const payload = NotificationEnvelope.parse({
    v: 1,
    recipientUserId: auth.user.userId,
    recipientSessionId: auth.session.sessionId,
    notificationId: crypto.randomUUID(),
    kind: 'message',
    collapseKey: 'browser-push',
    title: '归属通知',
    body: '正确账号私密正文',
    count: 1,
    deepLink: '/wallet',
    conversationId: null,
    sound: false,
    sentAt: new Date().toISOString(),
  });
  await deliver(worker, { ...payload, recipientSessionId: crypto.randomUUID() });
  await deliver(worker, { ...payload, recipientUserId: crypto.randomUUID() });
  const legacy = { ...payload };
  delete (legacy as Partial<typeof payload>).recipientSessionId;
  await deliver(worker, legacy);
  await deliver(worker, { ...payload, sentAt: new Date(Date.now() - 601_000).toISOString() });
  expect(await notices(worker)).toEqual([]);
  await worker.evaluate(() => {
    (globalThis as unknown as { failNextNotice: boolean }).failNextNotice = true;
  });
  await deliver(worker, payload);
  expect(await notices(worker)).toEqual([]);
  await deliver(worker, payload);
  await deliver(worker, payload);
  expect(await notices(worker)).toEqual([
    { title: '归属通知', body: '正确账号私密正文', tag: `${auth.session.sessionId}:browser-push` },
  ]);
  await worker.evaluate(async () => {
    const scope = globalThis as unknown as {
      registration: ServiceWorkerRegistration;
      dispatchEvent(event: Event): boolean;
    };
    const notification = (await scope.registration.getNotifications())[0];
    const pending: Promise<unknown>[] = [];
    const event = new Event('notificationclick');
    Object.defineProperties(event, {
      notification: { value: notification },
      waitUntil: { value: (work: Promise<unknown>) => pending.push(work) },
    });
    scope.dispatchEvent(event);
    await Promise.all(pending);
  });
  await expect(page).toHaveURL(/\/wallet$/);
  await deliver(worker, { ...payload, notificationId: crypto.randomUUID() });
  expect((await notices(worker)).length).toBe(1);
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect(await notices(worker)).toEqual([]);
  await deliver(worker, { ...payload, notificationId: crypto.randomUUID() });
  expect(await notices(worker)).toEqual([]);
});
