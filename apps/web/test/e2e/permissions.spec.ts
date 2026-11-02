import { expect, test, type Page } from './fixtures.js';

/**
 * 首次权限逐个申请（T-20261103 第 1 项）：真实页面、真实登录；只把浏览器的系统权限接口换成记录调用的替身
 * （无头浏览器弹不出真实的系统权限框）。配置层预置的 permissions-onboarded 标记在这里清掉，让流程真正开始。
 */
test.use({ storageState: { cookies: [], origins: [] } });

interface PermissionMock {
  /** 开始时的通知权限。 */
  notification: NotificationPermission;
  /** 用户在通知系统框里的选择。 */
  answer: NotificationPermission;
  /** 开始时的麦克风权限（permissions.query 的结果）。 */
  microphone: PermissionState;
}

async function mockPermissions(page: Page, mock: PermissionMock) {
  await page.addInitScript((m: PermissionMock) => {
    const calls: string[] = [];
    Object.assign(window, { permissionCalls: calls });
    let permission = m.notification;
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => permission,
    });
    Object.defineProperty(Notification, 'requestPermission', {
      configurable: true,
      value: async () => {
        calls.push('notification');
        permission = m.answer;
        return permission;
      },
    });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        calls.push('microphone');
        return { getTracks: () => [{ stop() {} }] };
      },
    });
    const query = navigator.permissions.query.bind(navigator.permissions);
    Object.defineProperty(navigator.permissions, 'query', {
      configurable: true,
      value: async (descriptor: PermissionDescriptor) =>
        descriptor.name === 'microphone' ? { state: m.microphone } : query(descriptor),
    });
  }, mock);
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { permissionCalls: string[] }).permissionCalls);

async function loginAndTap(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_guide');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  // 登录后的第一次点击才开始，页面加载时不会自动弹。
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('[data-guide="nav-me"]').click();
}

test('逐步顺序：第一步只申请通知，点第二个说明框才申请麦克风', async ({ page }) => {
  await mockPermissions(page, { notification: 'default', answer: 'granted', microphone: 'prompt' });
  await loginAndTap(page);
  const first = page.getByRole('dialog', { name: '开启消息通知' });
  await expect(first).toBeVisible();
  await expect(first).toContainText('第 1 步，共 2 步');
  // 说明框出现时还没有发任何系统申请
  expect(await calls(page)).toEqual([]);
  await first.getByRole('button', { name: '开启通知', exact: true }).click();
  const second = page.getByRole('dialog', { name: '开启麦克风' });
  await expect(second).toBeVisible();
  await expect(second).toContainText('第 2 步，共 2 步');
  // 一次点击只发一个申请：第二步等用户再点
  expect(await calls(page)).toEqual(['notification']);
  await second.getByRole('button', { name: '开启麦克风', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => calls(page)).toEqual(['notification', 'microphone']);
  expect(await page.evaluate(() => localStorage.getItem('permissions-onboarded'))).toBe('1');
  // 流程走完后不再触发
  await page.locator('[data-guide="nav-me"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('第一步被拒绝后仍能进入第二步', async ({ page }) => {
  await mockPermissions(page, { notification: 'default', answer: 'denied', microphone: 'prompt' });
  await loginAndTap(page);
  await page
    .getByRole('dialog', { name: '开启消息通知' })
    .getByRole('button', { name: '开启通知', exact: true })
    .click();
  const second = page.getByRole('dialog', { name: '开启麦克风' });
  await expect(second).toBeVisible();
  expect(await calls(page)).toEqual(['notification']);
  expect(await page.evaluate(() => localStorage.getItem('permissions-denied:notification'))).toBe(
    '1',
  );
  await second.getByRole('button', { name: '开启麦克风', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual(['notification', 'microphone']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('permissions-onboarded'))).toBe('1');
});

test('已授权的权限跳过对应那一步', async ({ page }) => {
  await mockPermissions(page, { notification: 'granted', answer: 'granted', microphone: 'prompt' });
  await loginAndTap(page);
  // 通知已授权：直接是麦克风这一步，且只有一步
  const only = page.getByRole('dialog', { name: '开启麦克风' });
  await expect(only).toBeVisible();
  await expect(only).not.toContainText('共 2 步');
  await expect(page.getByRole('dialog', { name: '开启消息通知' })).toHaveCount(0);
  await only.getByRole('button', { name: '开启麦克风', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual(['microphone']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('两项都已授权时不弹任何说明框，直接记为完成', async ({ page }) => {
  await mockPermissions(page, {
    notification: 'granted',
    answer: 'granted',
    microphone: 'granted',
  });
  await loginAndTap(page);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('permissions-onboarded')))
    .toBe('1');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
});
