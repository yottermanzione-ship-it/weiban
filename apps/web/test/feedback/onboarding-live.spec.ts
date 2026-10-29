import { expect, test, type Page } from '@playwright/test';
const fixture = '/test/browser-fixtures/onboarding-live.html';
const layer = (page: Page) => page.locator('.guided-tour-layer');
async function at(page: Page, id: string) {
  await expect(layer(page)).toHaveAttribute('data-tour-step', id);
  await expect(page.locator('.guided-tour-card')).toBeInViewport({ ratio: 1 });
}
async function noWrites(page: Page) {
  const calls = await page.evaluate(
    () =>
      (window as unknown as { onboardingLiveCalls: Array<{ method: string }> }).onboardingLiveCalls,
  );
  expect(calls.filter((entry) => entry.method !== 'GET')).toEqual([]);
}
test('真实小程序页面与导航：不套手机框，真实点击后才前进并回到原入口', async ({ page }) => {
  await page.goto(fixture);
  await expect(page.locator('.preview-phone,.preview-sidebar')).toHaveCount(0);
  await page.getByRole('button', { name: /小程序 认识|小程序 找到/ }).click();
  await at(page, 'live-miniapps-discover');
  await page.locator('[data-guide="nav-discover"]').click();
  await at(page, 'live-miniapps-entry');
  const width = await page
    .locator('[data-guide="miniapps-entry"]')
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(300);
  await page.locator('[data-guide="miniapps-entry"]').click();
  await at(page, 'live-miniapps-cards');
  await page.locator('[data-guide="miniapp-cards"]').first().click();
  await at(page, 'live-miniapps-close');
  await page.locator('[data-guide="miniapp-close"]').click();
  await expect(page.getByRole('dialog', { name: '这一节完成了' })).toBeVisible();
  await noWrites(page);
});
test('真实生态页面：免费用户可以完成了解，全程不改变开关或收费设置', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: /角色生态 认识入口/ }).click();
  await page.locator('[data-guide="nav-me"]').click();
  await at(page, 'live-ecology-services');
  await page.locator('[data-guide="services-entry"]').click();
  await page.locator('[data-guide="ecology-entry"]').click();
  await at(page, 'live-ecology-master');
  await expect(page.getByRole('switch', { name: '角色生态', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '继续' }).click();
  await at(page, 'live-ecology-cost');
  await page.getByRole('button', { name: '了解了' }).click();
  await expect(page.getByRole('dialog', { name: '这一节完成了' })).toBeVisible();
  await expect(page.getByRole('switch', { name: '角色生态', exact: true })).not.toBeChecked();
  await noWrites(page);
});
test('真实私聊与情景面板：本人选择会话，不发送消息也不切换模式', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: /情景预设 认识聊天/ }).click();
  await page.getByRole('button', { name: /引导测试角色 打开聊天/ }).click();
  await at(page, 'live-scenario-plus');
  await page.locator('[data-guide="chat-plus"]').click();
  await at(page, 'live-scenario-open');
  await page.locator('[data-guide="scenario-entry"]').click();
  await at(page, 'live-scenario-options');
  await expect(page.getByRole('button', { name: /日常聊天/ })).toBeVisible();
  await page.getByRole('button', { name: '了解了' }).click();
  await at(page, 'live-scenario-close');
  await page
    .getByRole('dialog', { name: '情景预设', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '这一节完成了' })).toBeVisible();
  await noWrites(page);
});
test('退出、进度和必要弹窗：不锁死页面，数据按账号命名隔离', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: /角色生态 认识入口/ }).click();
  await page.getByRole('button', { name: '返回目录' }).click();
  await expect(page.getByRole('heading', { name: '新手引导' })).toBeVisible();
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('weiban:guided-tour:')),
  );
  expect(keys).toEqual(['weiban:guided-tour:v1:01920000-0000-7000-8000-000000000014']);
  await page.getByRole('button', { name: /小程序 找到各种/ }).click();
  await page.evaluate(() => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.textContent = '配置确认';
    document.body.append(dialog);
  });
  await expect(layer(page)).toHaveCount(0);
});
test('真实桌面尺寸与窄屏：提示不遮目标，页面没有演示壳并留存截图', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.goto(fixture);
  await page.getByRole('button', { name: /小程序 找到各种/ }).click();
  await at(page, 'live-miniapps-discover');
  await page.screenshot({ path: '.ci-onboarding-live-desktop.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 351, height: 755 });
  await page.goto(fixture);
  await page.getByRole('button', { name: /角色生态 认识入口/ }).click();
  await at(page, 'live-ecology-me');
  await page.screenshot({ path: '.ci-onboarding-live-mobile.png', animations: 'disabled' });
});
