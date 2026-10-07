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
async function installNotificationSystem(worker: Worker) {
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
}
async function clickFirstNotice(worker: Worker) {
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
  await installNotificationSystem(worker);
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
  await deliver(worker, { ...payload, kind: 'admin_alert', deepLink: '/admin/alerts' });
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
  await clickFirstNotice(worker);
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

test('管理员通知放行用户SW，跨源跳转后台并使用独立管理会话', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_admin');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'TA 该怎么称呼你？' })).toBeVisible();
  const auth = AuthResponse.parse(
    await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const open = indexedDB.open('weiban-app', 1);
          open.onsuccess = () => {
            const tx = open.result.transaction('records', 'readwrite');
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
  expect(auth.user.role).toBe('admin');
  expect(auth.session.kind).toBe('app');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await installNotificationSystem(worker);
  let redirects = 0;
  // 浏览器里仅HTTP重定向采用夹具；生产Caddy的实际302/后台HTML由容器演练验证。
  await page.route('http://127.0.0.1:5173/admin/alerts', async (route) => {
    redirects++;
    await route.fulfill({
      status: 302,
      headers: { location: 'http://127.0.0.1:5174/admin/alerts' },
    });
  });
  const payload = NotificationEnvelope.parse({
    v: 1,
    recipientUserId: auth.user.userId,
    recipientSessionId: auth.session.sessionId,
    notificationId: crypto.randomUUID(),
    kind: 'admin_alert',
    collapseKey: 'admin-alert-test',
    title: '运行提醒',
    body: '上游暂不可用',
    count: 1,
    deepLink: '/admin/alerts',
    conversationId: null,
    sound: false,
    sentAt: new Date().toISOString(),
  });
  const before = page.url();
  await deliver(worker, { ...payload, kind: 'message', notificationId: crypto.randomUUID() });
  await clickFirstNotice(worker);
  await expect(page).toHaveURL(before);
  expect(redirects).toBe(0);
  await deliver(worker, payload);
  expect((await notices(worker)).length).toBe(1);
  await clickFirstNotice(worker);
  await expect(page).toHaveURL('http://127.0.0.1:5174/admin/alerts');
  expect(redirects).toBe(1);
  await expect(page.getByRole('heading', { name: '微伴管理后台', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '管理导航' })).toHaveCount(0);
  await page.getByLabel('管理员账号').fill('browser_admin');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '运行提醒', exact: true })).toBeVisible();
  await expect(page.getByText('浏览器运行提醒 52', { exact: true })).toBeVisible();
  const management = AuthResponse.parse(
    await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const open = indexedDB.open('weiban-admin', 1);
          open.onsuccess = () => {
            const query = open.result.transaction('records').objectStore('records').get('session');
            query.onsuccess = () => resolve(query.result);
          };
        }),
    ),
  );
  expect(management.session.kind).toBe('admin');
  expect(management.session.sessionId).not.toBe(auth.session.sessionId);
  await page.reload();
  await expect(page.getByRole('heading', { name: '运行提醒', exact: true })).toBeVisible();
  await page.goto('http://127.0.0.1:5173/profile');
  const original = AuthResponse.parse(
    await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const open = indexedDB.open('weiban-app', 1);
          open.onsuccess = () => {
            const query = open.result.transaction('records').objectStore('records').get('session');
            query.onsuccess = () => resolve(query.result);
          };
        }),
    ),
  );
  expect(original.session.kind).toBe('app');
  expect(original.session.sessionId).toBe(auth.session.sessionId);
});
