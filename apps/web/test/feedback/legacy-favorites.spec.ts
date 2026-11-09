import { expect, test } from '@playwright/test';
const base = '/test/browser-fixtures/legacy-favorites.html';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/fixture-media/pixel.svg')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#82b6bd"/></svg>',
      });
    if (url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
});
test('browser sees independent legacy snapshots, normal favorites, media status and escaped text', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByText('新版普通收藏继续保留')).toBeVisible();
  const legacy = page.getByRole('region', { name: '旧版收藏' });
  await expect(legacy.getByText('旧版独立收藏仍然可见')).toBeVisible();
  await expect(
    legacy.getByText(
      '<img src="https://outside.invalid/private" onerror="window.fixtureXss=true">',
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { fixtureXss?: boolean }).fixtureXss),
  ).toBeUndefined();
  await legacy.getByRole('button', { name: '加载更多旧版收藏' }).click();
  await expect(legacy.getByText('旧设备未找到原附件，收藏快照已保留。')).toBeVisible();
  await expect(legacy.locator('img[src*="fixture-media/pixel.svg"]')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('legacy-visible.png'),
    fullPage: true,
  });
});
test('removing a legacy favorite preserves its tombstone after refresh and leaves ordinary favorites alone', async ({
  page,
}) => {
  await page.goto(base);
  const legacy = page.getByRole('region', { name: '旧版收藏' });
  await legacy.getByRole('button', { name: '取消旧版收藏' }).first().click();
  await expect(legacy.getByText('旧版独立收藏仍然可见')).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { legacyFixture: { refresh(): void } }).legacyFixture.refresh(),
  );
  await expect(legacy.getByText('旧版独立收藏仍然可见')).toHaveCount(0);
  await expect(page.getByText('新版普通收藏继续保留')).toBeVisible();
});
test('automatic native transfer retries safely and acknowledges only after both pages are saved', async ({
  page,
}) => {
  await page.goto(`${base}?native=1&fail=once`);
  await page.getByRole('button', { name: '重试保存旧收藏' }).click();
  await expect(page.getByText('从原手机保存的文字')).toBeVisible();
  await expect(page.getByText('第二条原手机收藏')).toBeVisible();
  await expect(page.getByText('旧收藏已保存，旧设备中的原始数据仍保留。')).toBeVisible();
  const events = await page.evaluate(
    () => (window as unknown as { legacyFixture: { events: string[] } }).legacyFixture.events,
  );
  expect(events.filter((value) => value === 'native-ack')).toHaveLength(1);
  expect(events.indexOf('native-ack')).toBeGreaterThan(events.lastIndexOf('import-saved'));
});
test('missing native media still exposes every snapshot with a reason and does not acknowledge completion', async ({
  page,
}) => {
  await page.goto(`${base}?native=1&media=missing`);
  await expect(page.getByText('从原手机保存的文字')).toBeVisible();
  await expect(page.getByText('旧设备未找到原附件，收藏快照已保留。')).toBeVisible();
  await expect(page.getByText(/另有 1 条附件尚未完成/)).toBeVisible();
  const events = await page.evaluate(
    () => (window as unknown as { legacyFixture: { events: string[] } }).legacyFixture.events,
  );
  expect(events).not.toContain('native-ack');
});
test('switching accounts cancels old work and late success cannot expose old snapshots to the new account', async ({
  page,
}) => {
  await page.goto(`${base}?native=1&hold=1`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { legacyFixture: { events: string[] } }
        ).legacyFixture.events.includes('import-start'),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '切换合成账号' }).click();
  await page.getByRole('button', { name: '完成迟到请求' }).click();
  await expect(page.getByText('从原手机保存的文字')).toHaveCount(0);
  await expect(page.getByText('第二条原手机收藏')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: '旧版收藏' }).getByText('暂无已迁入的旧版收藏。'),
  ).toBeVisible();
  const events = await page.evaluate(
    () => (window as unknown as { legacyFixture: { events: string[] } }).legacyFixture.events,
  );
  expect(events).not.toContain('native-ack');
});
