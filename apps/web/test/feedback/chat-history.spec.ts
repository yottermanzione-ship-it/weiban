import { expect, test, type Page } from '@playwright/test';

const fixture = '/test/browser-fixtures/chat-history.html';
const list = '.wx-chat-body .virtual-list';

/** 夹具里记录的历史分页请求次数（每次点击最多 +1）。 */
function historyCalls(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { historyHarness: { calls: number[] } }).historyHarness.calls.length,
  );
}

/** 普通上滑到顶：只滚列表，不派发任何历史请求。 */
async function scrollToTop(page: Page) {
  await page.locator(list).evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(300);
}

async function openChat(page: Page) {
  await page.goto(fixture);
  await expect(page.getByText('消息 150', { exact: true })).toBeVisible();
  // 等同步连上，避免离线提示条影响布局测量。
  await expect(page.getByText('网络暂不可用，消息保存在本机，联网后继续发送')).toHaveCount(0);
}

test('上滑到顶不自动拉历史；点一次只取一批，加载中不能重复点击', async ({ page }) => {
  await openChat(page);
  expect(await historyCalls(page)).toBe(0);
  await expect(page.locator('.wx-older')).toHaveCount(0);

  await scrollToTop(page);
  expect(await historyCalls(page)).toBe(0);
  const button = page.getByRole('button', { name: '加载更多消息' });
  await expect(button).toBeVisible();
  // 按钮是消息列表里的一行，不是盖在消息上的浮层。
  await expect(page.locator(`${list} [data-row-key]`).first()).toHaveAttribute(
    'data-row-key',
    '__older__',
  );

  await button.click();
  await expect(page.locator('.wx-older-status')).toContainText('正在加载…');
  await expect(page.getByRole('button', { name: '加载更多消息' })).toHaveCount(0);
  expect(await historyCalls(page)).toBe(1);
  // 在途时点按钮原来的位置（此刻是转圈状态）不会再发一批。
  await page.locator('.wx-older-status').click();
  await page.waitForTimeout(150);
  expect(await historyCalls(page)).toBe(1);

  await expect(page.getByText('消息 100', { exact: true })).toBeVisible({ timeout: 5000 });
  expect(await historyCalls(page)).toBe(1);
  // 回到顶部后恢复成按钮（这一批之后还有更早的记录）。
  await scrollToTop(page);
  await expect(page.getByRole('button', { name: '加载更多消息' })).toBeVisible();
});

test('插入上一批后，用户正在看的那条消息不跳位', async ({ page }) => {
  await openChat(page);
  await scrollToTop(page);
  const watching = page.getByText('消息 102', { exact: true });
  const before = (await watching.boundingBox())!;
  await page.getByRole('button', { name: '加载更多消息' }).click();
  await expect(page.getByText('消息 100', { exact: true })).toBeVisible({ timeout: 5000 });

  const after = (await watching.boundingBox())!;
  // VirtualList 按锚点行底边钉住：首条消息的时间条在插入更早一条后消失，用户正在看的这一条不动
  // （实测 0 像素漂移，这里只留 2 像素余量防回归）。点击加载本身不写 scrollTop，也不把视图移到最上/最下。
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  const position = await page.locator(list).evaluate((el) => ({
    top: el.scrollTop,
    bottomGap: el.scrollHeight - el.scrollTop - el.clientHeight,
  }));
  // 既没有被顶到最上面（scrollTop 仍是 0），也没有跳到最下面。
  expect(position.top).toBeGreaterThan(100);
  expect(position.bottomGap).toBeGreaterThan(100);
});

test('取到最早一条显示没有更多消息；失败可点击重试', async ({ page }) => {
  await openChat(page);
  await scrollToTop(page);
  await page.getByRole('button', { name: '加载更多消息' }).click();
  await expect(page.getByText('消息 100', { exact: true })).toBeVisible({ timeout: 5000 });
  await scrollToTop(page);
  await page.getByRole('button', { name: '加载更多消息' }).click();
  await expect(page.getByText('消息 50', { exact: true })).toBeVisible({ timeout: 5000 });
  expect(await historyCalls(page)).toBe(2);
  // 到最早一条后，顶端那一行变成不可点的说明文字。
  await scrollToTop(page);
  await expect(page.getByText('没有更多消息')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: '加载更多消息' })).toHaveCount(0);

  await openChat(page);
  await page.evaluate(() => {
    (window as unknown as { historyHarness: { failNext: boolean } }).historyHarness.failNext = true;
  });
  await scrollToTop(page);
  await page.getByRole('button', { name: '加载更多消息' }).click();
  const retry = page.getByRole('button', { name: '加载失败，点击重试' });
  await expect(retry).toBeVisible({ timeout: 5000 });
  expect(await historyCalls(page)).toBe(1);
  await retry.click();
  await expect(page.getByText('消息 100', { exact: true })).toBeVisible({ timeout: 5000 });
  expect(await historyCalls(page)).toBe(2);
  await scrollToTop(page);
  await expect(page.getByRole('button', { name: '加载更多消息' })).toBeVisible();
});
