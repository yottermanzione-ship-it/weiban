import { expect, test, type Page } from '@playwright/test';
const fixture = '/test/browser-fixtures/onboarding-tour.html';
async function begin(page: Page, title: string) {
  await page.goto(fixture);
  await page.getByRole('button', { name: `开始${title}`, exact: true }).click();
}
async function step(page: Page, id: string) {
  await expect(page.locator('.guided-tour-layer')).toHaveAttribute('data-tour-step', id);
  await expect(page.locator('.guided-tour-card')).toBeInViewport({ ratio: 1 });
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    await route.abort();
    throw new Error('The local preview must not call a real API');
  });
});
test('情景预设：真实点击才前进，其他区域不可误操作，了解后不改变模式', async ({ page }) => {
  await begin(page, '换一种聊天情景');
  await step(page, 'scenario-chat');
  await page.getByRole('button', { name: '发现', exact: true }).click({ force: true });
  await step(page, 'scenario-chat');
  await page.locator('[data-tour-target="conversation"]').click();
  await step(page, 'scenario-plus');
  await page.getByRole('button', { name: '更多聊天功能' }).click();
  await step(page, 'scenario-entry');
  await page.locator('[data-tour-target="scenario-entry"]').click();
  await step(page, 'scenario-options');
  await page.getByRole('button', { name: '明白了，保持原设置' }).click();
  await step(page, 'scenario-close');
  await page.getByRole('button', { name: '关闭情景预设' }).click();
  await expect(page.getByRole('dialog', { name: '这节学会啦' })).toBeVisible();
  await expect(page.locator('.guided-tour-layer')).toHaveCount(0);
});
test('小程序：从发现进入卡册，圆形关闭按钮回到小程序列表', async ({ page }) => {
  await begin(page, '发现一起玩的地方');
  await page.getByRole('button', { name: '发现', exact: true }).click();
  await step(page, 'miniapps-entry');
  await page.locator('[data-tour-target="miniapps-entry"] button').click();
  await step(page, 'miniapps-cards');
  await page.locator('[data-tour-target="cards-entry"]').click();
  await step(page, 'miniapps-close');
  await page.getByRole('button', { name: '关闭小程序' }).click();
  await expect(page.getByRole('dialog', { name: '这节学会啦' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '小程序', exact: true })).toBeVisible();
});
test('角色生态：教程不启用功能，模拟确认可取消，主动开启后才教后续设置', async ({ page }) => {
  await begin(page, '认识 TA 的角色生态');
  await page.getByRole('button', { name: '我', exact: true }).click();
  await page.locator('[data-tour-target="services-entry"] button').click();
  await page.locator('[data-tour-target="ecology-entry"] button').click();
  await step(page, 'ecology-master');
  await page.getByRole('button', { name: '知道了，继续', exact: true }).click();
  await step(page, 'ecology-cost');
  await page.getByRole('button', { name: '了解了，暂不开启' }).click();
  await page.getByRole('button', { name: '自己逛逛', exact: true }).click();
  await expect(page.getByRole('switch', { name: '角色生态', exact: true })).not.toBeChecked();
  await page.getByRole('switch', { name: '角色生态', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('switch', { name: '角色生态', exact: true })).not.toBeChecked();
  await page.getByRole('switch', { name: '角色生态', exact: true }).click();
  await page.getByRole('button', { name: '仅在演示中开启' }).click();
  await step(page, 'ecology-levels');
  await page.getByRole('button', { name: '知道了，继续', exact: true }).click();
  await step(page, 'ecology-estimate');
  await page.getByRole('button', { name: '知道了，继续', exact: true }).click();
  await step(page, 'ecology-characters');
  await page.getByRole('button', { name: '学会了，自己试试' }).click();
  await expect(page.getByRole('dialog', { name: '这节学会啦' })).toBeVisible();
});
test('暂停和刷新保留本地进度，继续后可返回上一步或按Esc退出', async ({ page }) => {
  await begin(page, '换一种聊天情景');
  await page.locator('[data-tour-target="conversation"]').click();
  await page.getByRole('button', { name: '稍后再学，退出引导' }).click();
  await expect(page.locator('.guided-tour-layer')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /继续上次：换一种聊天情景/ }).click();
  await step(page, 'scenario-plus');
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await step(page, 'scenario-chat');
  await page.keyboard.press('Escape');
  await expect(page.locator('.guided-tour-layer')).toHaveCount(0);
});
test('窄屏深色及桌面预览：卡片可见、高亮跟随控件并生成预览截图', async ({ page }) => {
  await page.setViewportSize({ width: 351, height: 755 });
  await page.goto(fixture);
  await page.getByRole('button', { name: '切换深色模式' }).click();
  await page.getByRole('button', { name: '开始换一种聊天情景', exact: true }).click();
  await page.locator('[data-tour-target="conversation"]').click();
  await step(page, 'scenario-plus');
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'dark');
  const target = await page.locator('[data-tour-target="chat-plus"]').boundingBox();
  const ring = await page.locator('.guided-tour-ring').boundingBox();
  expect(target).not.toBeNull();
  expect(ring).not.toBeNull();
  expect(Math.abs(ring!.x - target!.x)).toBeLessThanOrEqual(7);
  await page.screenshot({ path: '.ci-onboarding-tour-mobile.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.getByRole('button', { name: '切换浅色模式' }).click();
  await page.goto(fixture);
  await expect(page.getByRole('heading', { name: '不是看说明， 是带你走一遍。' })).toBeVisible();
  await page.screenshot({ path: '.ci-onboarding-tour-desktop.png' });
});
test('找不到目标时保留明确出口，不锁死整页', async ({ page }) => {
  await begin(page, '换一种聊天情景');
  await page.locator('[data-tour-target="conversation"]').evaluate((element) => element.remove());
  await expect(page.getByText('正在寻找当前控件，你也可以先退出。')).toBeVisible();
  await page.getByRole('button', { name: '稍后再学，退出引导' }).click();
  await expect(page.locator('.guided-tour-layer')).toHaveCount(0);
});
