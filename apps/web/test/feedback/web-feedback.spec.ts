import { expect, test, type Page } from '@playwright/test';
const fixture = '/test/browser-fixtures/web-feedback.html';
async function pull(page: Page, endY: number) {
  await page.mouse.move(180, 100);
  await page.mouse.down();
  await page.mouse.move(180, endY, { steps: 15 });
}
async function offset(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
}
test('服务仅保留积分入口，积分页仍可充值；聊天流水无二级明细请求', async ({ page }) => {
  await page.goto(`${fixture}?page=services`);
  await expect(page.getByRole('link', { name: '充值', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: /积分/ }).first().click();
  await expect(page.getByRole('button', { name: '充值', exact: true })).toBeVisible();
  await page.goto(`${fixture}?page=ledger`);
  await expect(page.locator('.ledger-row-old')).toHaveCount(1);
  await expect(page.locator('.ledger-row-old')).toContainText('共 2 次消耗');
  await expect(page.locator('button.ledger-row-old')).toHaveCount(0);
  await page.locator('.ledger-row-old').click();
  await expect(page.getByText('积分明细', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { feedbackCalls: string[] }).feedbackCalls.some((s) =>
        s.includes('charged-messages'),
      ),
    ),
  ).toBe(false);
});
test('排行榜保持默认顺序和唯一列表，不再提供搜索或反向排序', async ({ page }) => {
  await page.goto(`${fixture}?page=rank`);
  await expect(page.getByText('全部可选模型')).toHaveCount(0);
  await expect(page.getByText('已排名模型', { exact: false })).toHaveCount(1);
  await expect(page.getByText('无数据模型', { exact: false })).toHaveCount(1);
  await expect(page.getByText(/暂无排名/)).toBeVisible();
  await expect(page.getByText('受限模型', { exact: false })).toHaveCount(0);
  await expect(page.locator('.rank-no')).toHaveText('1');
  await expect(page.getByLabel('搜索模型', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /反向排序|恢复默认排序/ })).toHaveCount(0);
  await expect(page.locator('.menu-row').filter({ hasText: /已排名模型|无数据模型/ })).toHaveText([
    /已排名模型/,
    /无数据模型/,
  ]);
  await page.getByRole('tab', { name: '热门榜' }).click();
  await expect(page.getByText(/12 人选用/)).toBeVisible();
  await expect(page.getByText(/0 人选用/)).toBeVisible();
  await page.getByRole('button').filter({ hasText: '无数据模型' }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await page.goto(`${fixture}?page=models`);
  await expect(page.getByText('发照片', { exact: true })).toHaveCount(0);
});
test('半下拉连续浅灰空白，标题搜索列表整体下移，轻甩不足阈值回弹', async ({ page }) => {
  await page.goto(fixture);
  const selectors = ['.chat-list-head', '.search-strip', '.virtual-list'];
  const before = await Promise.all(selectors.map((s) => offset(page, s)));
  await pull(page, 330);
  const after = await Promise.all(selectors.map((s) => offset(page, s)));
  const delta = after[0]! - before[0]!;
  expect(delta).toBeGreaterThan(30);
  expect(delta).toBeLessThan(140);
  for (let i = 1; i < 3; i++) expect(Math.abs(after[i]! - before[i]! - delta)).toBeLessThan(1);
  await expect(page.locator('.pull-panel')).toBeHidden();
  expect(
    await page.locator('.chat-list-page').evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(
    await page.locator('.chat-list-head').evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  await page.screenshot({ path: 'apps/web/test-results/feedback-pull-before-threshold.png' });
  await page.mouse.up();
  await expect.poll(() => offset(page, '.chat-list-head')).toBeLessThan(1);
  await expect(page.getByRole('dialog', { name: '小程序' })).toBeHidden();
});
test('达到阈值面板从顶部出现，松手展开，Esc及上滑收起', async ({ page }) => {
  await page.goto(fixture);
  await pull(page, 650);
  await expect(page.locator('.pull-panel')).toBeVisible();
  expect(await offset(page, '.pull-panel')).toBe(0);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '小程序' })).toBeVisible();
  await expect.poll(() => offset(page, '.chat-list-head')).toBeGreaterThan(700);
  await page.screenshot({ path: 'apps/web/test-results/feedback-pull-open.png' });
  await page.keyboard.press('Escape');
  await expect.poll(() => offset(page, '.chat-list-head')).toBeLessThan(1);
  await pull(page, 650);
  await page.mouse.up();
  await expect.poll(() => offset(page, '.chat-list-head')).toBeGreaterThan(700);
  await page.mouse.move(180, 750);
  await page.mouse.down();
  await page.mouse.move(180, 550, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => offset(page, '.chat-list-head')).toBeLessThan(1);
});

test('移动触屏安全区同层下移，取消手势不展开，列表未到顶部不接管', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 44, bottom: 34, left: 0, right: 0 },
  });
  await page.goto(fixture);
  expect(
    await page.locator('.chat-list-head').evaluate((el) => getComputedStyle(el).paddingTop),
  ).toBe('44px');
  const headBefore = await offset(page, '.chat-list-head');
  const searchBefore = await offset(page, '.search-strip');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 180, y: 160, id: 1 }],
  });
  for (let y = 180; y <= 360; y += 20)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 180, y, id: 1 }],
    });
  const delta = (await offset(page, '.chat-list-head')) - headBefore;
  expect(delta).toBeGreaterThan(20);
  expect(Math.abs((await offset(page, '.search-strip')) - searchBefore - delta)).toBeLessThan(1);
  await expect(page.locator('.pull-panel')).toBeHidden();
  await page.screenshot({ path: 'apps/web/test-results/feedback-pull-safe-area.png' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect.poll(() => offset(page, '.chat-list-head')).toBeLessThan(1);
  await page.locator('.virtual-list').evaluate((el) => {
    el.scrollTop = 150;
  });
  await page.mouse.move(180, 400);
  await page.mouse.down();
  await page.mouse.move(180, 650, { steps: 8 });
  await page.mouse.up();
  expect(await offset(page, '.chat-list-head')).toBe(0);
  await expect(page.locator('.pull-panel')).toBeHidden();
});
