import { expect, test, type Page } from '@playwright/test';
const fixture = '/test/browser-fixtures/onboarding-live.html?page=tabs';
const content = (page: Page) => page.locator('.route-frame > .route-content');
async function ready(page: Page) {
  await page.goto(fixture);
  await expect(content(page).locator('.contacts-count')).toHaveText('80 个朋友');
}
async function top(page: Page, value: number) {
  return page.evaluate((y) => {
    window.scrollTo({ top: y, behavior: 'instant' });
    return window.scrollY;
  }, value);
}
async function expectTop(page: Page, value: number) {
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(value, 0);
}
function tab(page: Page, name: string) {
  return page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name, exact: true });
}

test('通讯录下滑后切到发现：朋友圈从顶部完整显示，不继承通讯录偏移', async ({ page }) => {
  await ready(page);
  expect(await top(page, 1200)).toBeGreaterThan(1100);
  await tab(page, '发现').click();
  await expectTop(page, 0);
  await expect(content(page).getByRole('link', { name: '朋友圈', exact: true })).toBeInViewport({
    ratio: 1,
  });
});
test('通讯录和发现分别记住本页位置，来回切换互不污染', async ({ page }) => {
  await ready(page);
  await top(page, 950);
  await tab(page, '发现').click();
  await expectTop(page, 0);
  const own = await top(page, 60);
  expect(own).toBeGreaterThan(10);
  await tab(page, '通讯录').click();
  await expectTop(page, 950);
  await tab(page, '发现').click();
  await expectTop(page, own);
});
test('切到微伴仍固定标题栏，聊天虚拟列表保持自己的滚动', async ({ page }) => {
  await ready(page);
  await top(page, 1400);
  await tab(page, '微伴').click();
  await expectTop(page, 0);
  await expect(content(page).locator('.chat-list-head')).toBeInViewport({ ratio: 1 });
  const list = content(page).locator('.virtual-list');
  await expect(list).toBeVisible();
  await list.evaluate((element) => {
    element.scrollTop = 600;
  });
  await tab(page, '发现').click();
  await expectTop(page, 0);
  await tab(page, '微伴').click();
  await expectTop(page, 0);
  // Route restoration only writes window coordinates, never the inner message/conversation list.
  await expect(content(page).locator('.chat-list-head')).toBeInViewport({ ratio: 1 });
});
test('从通讯录打开二级页后返回，恢复通讯录原位置', async ({ page }) => {
  await ready(page);
  await top(page, 900);
  const visible = await content(page)
    .locator('.contact-row')
    .evaluateAll((rows) =>
      rows.findIndex((row) => {
        const box = row.getBoundingClientRect();
        return box.top > 90 && box.bottom < window.innerHeight - 80;
      }),
    );
  expect(visible).toBeGreaterThanOrEqual(0);
  const before = await page.evaluate(() => window.scrollY);
  await content(page).locator('.contact-row').nth(visible).click();
  await expect(content(page).getByRole('heading', { name: '角色资料' })).toBeVisible();
  await expectTop(page, 0);
  await top(page, 350);
  await page.evaluate(() => (window as unknown as { tabFixtureBack(): void }).tabFixtureBack());
  await expect(content(page).locator('.contacts-count')).toHaveText('80 个朋友');
  await expectTop(page, before);
});
test('桌面宽屏切换Tab也隔离窗口滚动，页面刷新不沿用上一页偏移', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await ready(page);
  await top(page, 1700);
  await tab(page, '发现').click();
  await expectTop(page, 0);
  await expect(content(page).getByRole('link', { name: '朋友圈', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await ready(page);
  await expectTop(page, 0);
});
