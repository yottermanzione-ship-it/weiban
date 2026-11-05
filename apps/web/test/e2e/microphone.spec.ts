import { expect, test, type Page } from './fixtures.js';

/** Real app/recorder, synthetic audio source instead of physical hardware; no paid provider. */
async function microphone(page: Page, error: string | null = null) {
  await page.addInitScript((initialError) => {
    const state = { calls: 0, stopped: 0, error: initialError, delay: false, release: () => {} };
    Object.assign(window, { microphoneTest: state });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        state.calls++;
        if (state.error) throw new DOMException('synthetic device failure', state.error);
        if (state.delay)
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        const context = new AudioContext();
        const stream = context.createMediaStreamDestination().stream;
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            if (track.readyState !== 'ended') state.stopped++;
            stop();
            void context.close();
          };
        }
        return stream;
      },
    });
  }, error);
}
const counts = (page: Page) =>
  page.evaluate(() => {
    const state = (window as unknown as { microphoneTest: { calls: number; stopped: number } })
      .microphoneTest;
    return { calls: state.calls, stopped: state.stopped };
  });
async function allow(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { microphoneTest: { error: string | null } }).microphoneTest.error = null;
  });
}
async function openChat(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  const onboarding = page.getByRole('heading', { name: 'TA 该怎么称呼你？', exact: true });
  await expect(page.getByRole('navigation', { name: '主导航' }).or(onboarding)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page.getByLabel('昵称', { exact: true }).fill('录音测试用户');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: /测试陪伴角色/ }).click();
    await expect(page).toHaveURL(/\/chat\//);
  }
  await page.goto('/chat');
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('permissions-onboarded'))).toBe('1');
}

test('旧引导完成后仍可申请麦克风，拒绝后重试成功且取消录音关闭设备', async ({ page }) => {
  await microphone(page, 'NotAllowedError');
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  const dialog = page.getByRole('dialog', { name: '麦克风尚未获准使用' });
  await expect(dialog).toContainText('更新网页不会重置已拒绝的权限');
  expect(await counts(page)).toEqual({ calls: 1, stopped: 0 });
  await allow(page);
  await dialog.getByRole('button', { name: '重新尝试' }).click();
  const hold = page.getByRole('button', { name: '按住说话' });
  await expect(hold).toBeVisible();
  expect(await counts(page)).toEqual({ calls: 2, stopped: 1 });
  await hold.dispatchEvent('pointerdown', { pointerId: 1, clientY: 800 });
  await expect(page.getByText('手指上滑，取消发送')).toBeVisible();
  await page
    .getByRole('button', { name: '松开发送' })
    .dispatchEvent('pointercancel', { pointerId: 1 });
  await expect(hold).toBeVisible();
  await expect.poll(() => counts(page)).toEqual({ calls: 3, stopped: 2 });
});

test('设备占用不会误说权限拒绝，设置里可以重新检查并释放设备', async ({ page }) => {
  await microphone(page, 'NotReadableError');
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  await expect(page.getByRole('dialog', { name: '麦克风暂时无法使用' })).toContainText('占用');
  await page.goto('/settings');
  await allow(page);
  await page.getByRole('button', { name: /麦克风权限/ }).click();
  await expect(page.getByRole('dialog', { name: '麦克风可以使用' })).toContainText(
    '不会每次都弹授权框',
  );
  expect(await counts(page)).toEqual({ calls: 1, stopped: 1 });
});

test('等待设备时离开聊天，迟到的录音流也会关闭', async ({ page }) => {
  await microphone(page);
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  await expect(page.getByRole('button', { name: '按住说话' })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { microphoneTest: { delay: boolean } }).microphoneTest.delay = true;
  });
  await page
    .getByRole('button', { name: '按住说话' })
    .dispatchEvent('pointerdown', { pointerId: 1, clientY: 800 });
  await expect.poll(() => counts(page)).toEqual({ calls: 2, stopped: 1 });
  await page.getByRole('link', { name: '聊天信息', exact: true }).click();
  await expect(page.getByRole('button', { name: '按住说话' })).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { microphoneTest: { release(): void } }).microphoneTest.release();
  });
  await expect.poll(() => counts(page)).toEqual({ calls: 2, stopped: 2 });
});

test('通话按钮先申请麦克风；拒绝时不创建通话', async ({ page }) => {
  let starts = 0;
  await microphone(page, 'NotFoundError');
  await page.route('**/calls/availability?*', (route) =>
    route.fulfill({ json: { available: true, reason: null } }),
  );
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/calls')) starts++;
  });
  await openChat(page);
  await page.getByRole('button', { name: '更多功能' }).click();
  await page.getByRole('button', { name: '语音通话', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '没有找到麦克风' })).toBeVisible();
  expect(await counts(page)).toEqual({ calls: 1, stopped: 0 });
  expect(starts).toBe(0);
});
