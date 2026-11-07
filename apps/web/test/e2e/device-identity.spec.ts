import { expect, test, type Page } from './fixtures.js';

async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  const request = page.waitForRequest((r) => r.url().endsWith('/auth/login'));
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  const body = (await request).postDataJSON() as {
    device: { installationId: string; platform: string; name: string };
  };
  const welcome = page.getByRole('heading', { name: 'TA 该怎么称呼你？' });
  await expect(welcome.or(page.getByRole('navigation', { name: '主导航' }))).toBeVisible();
  if (await welcome.isVisible()) {
    await page.getByLabel('昵称', { exact: true }).fill('设备登记检查');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: /测试陪伴角色/ }).click();
    await expect(page).toHaveURL(/\/chat\//);
  }
  return body.device;
}

test('应用与浏览器正确标识；退出、重开和更新页面保留同一随机设备标识', async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Android Chrome/140 WeibanShell/3.0.0',
    }),
  );
  const first = await login(page);
  expect(first.platform).toBe('android');
  expect(first.name).toBe('微伴安卓应用');
  expect(first.installationId).toMatch(/^[a-f0-9-]{36}$/);
  await page.goto('/settings/security');
  await expect(page.getByText('微伴安卓应用', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('微伴安卓应用', { exact: true })).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '退出登录？' })
    .getByRole('button', { name: '退出登录', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  const second = await login(page);
  expect(second.installationId).toBe(first.installationId);
  const tab = await context.newPage();
  await tab.goto('/settings/security');
  await expect(tab.getByText('微伴安卓应用', { exact: true })).toBeVisible();
  const count = await tab.locator('.inline-danger').count();
  await tab.reload();
  await expect(tab.getByText('微伴安卓应用', { exact: true })).toBeVisible();
  expect(await tab.locator('.inline-danger').count()).toBe(count);
});

test('安卓设置通过原生桥开启和关闭通知，并提供系统设置入口', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Android Chrome/140 WeibanShell/3.0.0',
    });
    let enabled = false;
    const bridge = {
      onmessage: null as ((event: { data: string }) => void) | null,
      postMessage(raw: string) {
        const request = JSON.parse(raw) as { id: string; type: string };
        if (request.type === 'enable') enabled = true;
        if (request.type === 'disable') enabled = false;
        if (request.type === 'settings')
          document.documentElement.dataset.nativeSettingsOpened = 'true';
        queueMicrotask(() =>
          bridge.onmessage?.({ data: JSON.stringify({ id: request.id, ok: true, enabled }) }),
        );
      },
    };
    window.weibanNotifications = bridge;
  });
  await login(page);
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: '新消息通知', exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: /系统通知设置/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-native-settings-opened', 'true');
  await toggle.click();
  await expect(toggle).not.toBeChecked();
});
