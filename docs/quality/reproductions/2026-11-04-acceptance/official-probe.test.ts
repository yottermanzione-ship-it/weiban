import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AnnouncementService,
  ReleaseService,
} from '../../../../apps/server/src/modules/identity/application/announcements.js';
import { makeQaApp } from './qa-app.js';
let qa: Awaited<ReturnType<typeof makeQaApp>>, a: Awaited<ReturnType<typeof qa.user>>, b: typeof a;
beforeAll(async () => {
  qa = await makeQaApp();
  a = await qa.user('qa_announcement_a');
  b = await qa.user('qa_announcement_b');
}, 120_000);
afterAll(async () => qa?.close());
it('公告：草稿不可见，发布后按平台展示，已读跨请求保留但不串账号，撤回即时隐藏', async () => {
  const svc = qa.app.get(AnnouncementService);
  const draft = await svc.create(a.id, {
    title: '合成公告',
    body: '本地测试正文',
    platforms: ['web'],
    startsAt: null,
    endsAt: null,
    popup: true,
    pinned: false,
    publish: false,
  });
  expect((await svc.listForUser(b.id, 'web')).items).toHaveLength(0);
  await svc.publish(a.id, draft.announcementId);
  expect((await svc.listForUser(b.id, 'web')).unreadCount).toBe(1);
  expect((await svc.listForUser(b.id, 'android')).items).toHaveLength(0);
  await svc.markRead(b.id, [draft.announcementId]);
  expect((await svc.listForUser(b.id, 'web')).unreadCount).toBe(0);
  expect((await svc.listForUser(a.id, 'web')).unreadCount).toBe(1);
  await svc.update(a.id, draft.announcementId, { body: '合成修订', resetReads: true });
  expect((await svc.listForUser(b.id, 'web')).unreadCount).toBe(1);
  await svc.withdraw(a.id, draft.announcementId);
  expect((await svc.listForUser(b.id, 'web')).items).toHaveLength(0);
  expect((await qa.http(b.token, '/admin/announcements')).status).toBe(403);
});
it('版本策略：不允许最低版本高于最新版；强制与可选更新边界一致', async () => {
  const svc = qa.app.get(ReleaseService);
  const policy = {
    latestVersion: '3.0',
    latestVersionCode: 3,
    minSupportedVersionCode: 2,
    downloadUrl: null,
    forceUpdateMessage: null,
  };
  await expect(
    svc.updatePolicy(a.id, 'web', { ...policy, minSupportedVersionCode: 4 }),
  ).rejects.toThrow();
  await svc.updatePolicy(a.id, 'web', policy);
  expect(await svc.checkVersion('web', 1)).toMatchObject({
    updateRequired: true,
    updateAvailable: true,
  });
  expect(await svc.checkVersion('web', 2)).toMatchObject({
    updateRequired: false,
    updateAvailable: true,
  });
  expect(await svc.checkVersion('web', 3)).toMatchObject({
    updateRequired: false,
    updateAvailable: false,
  });
});
