/// <reference lib="webworker" />
import { z } from 'zod';
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { IndexedLocalStore } from '@weiban/client-core';
import {
  ownedNotification,
  notificationRoute,
  PushControl,
  PushOwner,
} from './notifications/owner.js';
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/admin(?:\/|$)/],
  }),
);
const store = new IndexedLocalStore('weiban-app', self.indexedDB);
const seenSchema = z.array(z.object({ id: z.string(), sent: z.number() })).max(200);
let serial: Promise<void> = Promise.resolve();
function enqueue(operation: () => Promise<void>) {
  const pending = serial.then(operation);
  serial = pending.catch(() => {});
  return pending;
}
async function current(raw: unknown) {
  return ownedNotification(
    raw,
    await store.get('push-owner'),
    await store.get('session'),
    Date.now(),
  );
}
self.addEventListener('push', (event) => {
  event.waitUntil(
    enqueue(async () => {
      let raw: unknown;
      try {
        raw = event.data?.json();
      } catch {
        return;
      }
      const notice = await current(raw);
      if (!notice) return;
      const owner = { userId: notice.recipientUserId, sessionId: notice.recipientSessionId };
      const seenKey = `push-seen:${owner.sessionId}`;
      const parsed = seenSchema.safeParse(await store.get(seenKey));
      const seen = parsed.success
        ? parsed.data.filter((item) => Date.now() - item.sent <= 600_000)
        : [];
      if (seen.some((item) => item.id === notice.notificationId)) return;
      if (!(await current(raw))) return;
      const tag = `${owner.sessionId}:${notice.collapseKey}`;
      try {
        await self.registration.showNotification(notice.title, {
          body: notice.body,
          tag,
          silent: !notice.sound,
          icon: '/generated/icon-192.png',
          data: notice,
        });
      } catch {
        // 系统拒绝展示时不记为已展示，允许稍后使用相同notificationId重试。
        return;
      }
      await store.setOwned(
        owner,
        seenKey,
        [...seen, { id: notice.notificationId, sent: Date.now() }].slice(-200),
      );
      // 失效或跨账号请求也可能由HTTP清库触发；展示后再次复核并清理迟到通知。
      if (!(await current(raw)))
        for (const notification of await self.registration.getNotifications({ tag }))
          notification.close();
    }),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }
  const control = PushControl.safeParse(event.data);
  if (!control.success) return;
  event.waitUntil(
    enqueue(async () => {
      const parsed = PushOwner.safeParse(await store.get('push-owner'));
      if (
        parsed.success &&
        parsed.data.userId === control.data.userId &&
        parsed.data.sessionId === control.data.sessionId
      )
        await store.setOwned(parsed.data, 'push-owner', { ...parsed.data, enabled: false });
      for (const notification of await self.registration.getNotifications())
        if (notification.data?.recipientSessionId === control.data.sessionId) notification.close();
      event.ports[0]?.postMessage({ paused: true });
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    enqueue(async () => {
      const notice = await current(event.notification.data);
      const route = notice && notificationRoute(notice.deepLink, notice.kind);
      if (!notice || !route) return;
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const url = new URL(route, self.location.origin).href;
      const client = clients.find((item) => new URL(item.url).origin === self.location.origin);
      if (client) {
        await client.navigate(url);
        await client.focus().catch(() => {});
      } else await self.clients.openWindow(url);
    }),
  );
});
