import { expect, test, type Page } from './fixtures.js';

async function chat(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const ctx = new AudioContext();
        const destination = ctx.createMediaStreamDestination();
        const track = destination.stream.getAudioTracks()[0]!;
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          void ctx.close();
        };
        return destination.stream;
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_avatar');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await expect(page).toHaveURL(/\/chat\//);
}

async function dial(page: Page) {
  await page.getByRole('button', { name: '更多功能', exact: true }).click();
  await page.getByRole('button', { name: '语音通话', exact: true }).click();
}

async function observeDial(page: Page) {
  let requests = 0;
  // Stop at our local call endpoint: no paid provider, live account, or real microphone.
  await page.route('**/api/v1/calls', async (route) => {
    requests++;
    await route.fulfill({
      status: 422,
      json: { error: { code: 'service_disabled', message: '测试拨号已到达服务器' } },
    });
  });
  return () => requests;
}

test('状态预读挂起时，点击通话独立重新核对并进入拨号', async ({ page }) => {
  let reads = 0;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/calls/availability?*', async (route) => {
    if (++reads === 1) {
      await hold;
      await route.abort().catch(() => {});
    } else await route.fulfill({ json: { available: true, reason: null } });
  });
  const requests = await observeDial(page);
  try {
    await chat(page);
    await expect.poll(() => reads).toBe(1);
    await dial(page);
    await expect.poll(requests).toBe(1);
    expect(reads).toBe(2);
    await expect(page.getByText(/需先开通语音服务/)).toHaveCount(0);
  } finally {
    release();
  }
});

test('通话状态读取失败提示网络，再次点击可以恢复拨号', async ({ page }) => {
  let reads = 0;
  await page.route('**/calls/availability?*', async (route) => {
    if (++reads <= 2) await route.abort('failed');
    else await route.fulfill({ json: { available: true, reason: null } });
  });
  const requests = await observeDial(page);
  const failed = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().includes('/calls/availability?'),
  });
  await chat(page);
  await failed;
  await dial(page);
  await expect(page.getByText('网络暂不可用，请稍后重试', { exact: true })).toBeVisible();
  expect(requests()).toBe(0);
  await dial(page);
  await expect.poll(requests).toBe(1);
  expect(reads).toBe(3);
  await expect(page.getByText(/需先开通语音服务/)).toHaveCount(0);
});

for (const reason of ['service_disabled', 'private_mode'] as const) {
  test(`明确拒绝通话仍拦截拨号：${reason}`, async ({ page }) => {
    let reads = 0;
    await page.route('**/calls/availability?*', async (route) => {
      reads++;
      await route.fulfill({
        json: reads === 1 ? { available: true, reason: null } : { available: false, reason },
      });
    });
    const requests = await observeDial(page);
    await chat(page);
    await expect.poll(() => reads).toBe(1);
    await dial(page);
    await expect(
      page.getByText(
        reason === 'service_disabled'
          ? '语音通话服务暂不可用，请稍后再试'
          : '私密模式只支持文字和图片，切换到其他模式后才能语音通话',
        { exact: true },
      ),
    ).toBeVisible();
    expect(reads).toBe(2);
    expect(requests()).toBe(0);
  });
}

test('服务器明确关闭语音服务时隐藏入口', async ({ page }) => {
  let reads = 0;
  await page.route('**/calls/availability?*', async (route) => {
    reads++;
    await route.fulfill({ json: { available: false, reason: 'service_disabled' } });
  });
  const requests = await observeDial(page);
  await chat(page);
  await expect.poll(() => reads).toBe(1);
  await page.getByRole('button', { name: '更多功能', exact: true }).click();
  await expect(page.getByRole('button', { name: '语音通话', exact: true })).toHaveCount(0);
  expect(requests()).toBe(0);
});
