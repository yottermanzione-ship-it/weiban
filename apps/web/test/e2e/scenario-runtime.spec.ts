import { expect, test } from './fixtures.js';

test('管理员预设可选择、显示名称并保存；切回日常清除自定义预设', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_avatar');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await page.getByRole('button', { name: '更多功能', exact: true }).click();
  await page.getByRole('button', { name: /情景预设/ }).click();
  await page.getByRole('switch', { name: '显示情景模式' }).click();
  const changed = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith('/companion-settings'),
  );
  await page.getByRole('button', { name: '合成倾听情景', exact: true }).click();
  const response = await changed;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    scenarioMode: 'daily',
    scenarioPresetId: 'browser_gentle_scene',
  });
  await expect(page.locator('.scenario-mode-badge')).toHaveText('合成倾听情景');
  await expect(page.getByText('已切换到 合成倾听情景', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更多功能', exact: true }).click();
  await page.getByRole('button', { name: /情景预设/ }).click();
  await expect(
    page.getByRole('button', { name: '合成倾听情景', exact: true }).locator('.ink-brand'),
  ).toHaveCount(1);
  const cleared = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith('/companion-settings'),
  );
  await page.getByRole('button', { name: /日常聊天/ }).click();
  expect(await (await cleared).json()).toMatchObject({
    scenarioMode: 'daily',
    scenarioPresetId: null,
  });
  await expect(page.locator('.scenario-mode-badge')).toHaveText('日常');
});
