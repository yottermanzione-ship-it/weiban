import { expect, test, type Page } from './fixtures.js';

async function pinnedNavigation(page: Page) {
  const position = await page.getByRole('navigation', { name: '主导航' }).evaluate((nav) => ({
    bottom: nav.getBoundingClientRect().bottom,
    viewport: window.innerHeight,
    windowTop: window.scrollY,
  }));
  expect(Math.abs(position.bottom - position.viewport)).toBeLessThanOrEqual(1);
  expect(position.windowTop).toBe(0);
}

test('长通讯录字母跳转、三个主页滑动、缩小视口和返回时底栏留在屏幕底部', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_layout');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('link', { name: '通讯录', exact: true }).click();
  await expect(page.locator('#letter-Z a')).toHaveCount(16);
  await page
    .getByRole('navigation', { name: '字母索引' })
    .getByRole('button', { name: 'Z', exact: true })
    .click();
  const scroller = page.locator('.route-content');
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(700);
  await pinnedNavigation(page);
  const contactPosition = await scroller.evaluate((element) => element.scrollTop);
  const sectionTop = await page
    .locator('#letter-Z')
    .evaluate((element) => element.getBoundingClientRect().top);
  const headerBottom = await page
    .locator('.contacts-page .nav-bar')
    .evaluate((element) => element.getBoundingClientRect().bottom);
  expect(Math.abs(sectionTop - headerBottom)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath('contacts-letter-bottom-nav.png') });

  await page.setViewportSize({ width: 390, height: 520 });
  for (const [label, selector] of [
    ['发现', '.discover-page'],
    ['我', '.me-page'],
  ] as const) {
    await navigation.getByRole('link', { name: label, exact: true }).click();
    await expect(page.locator(selector)).toBeVisible();
    await page.mouse.move(170, 290);
    await page.mouse.wheel(0, 1800);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await pinnedNavigation(page);
    if (label === '我')
      await page.screenshot({ path: testInfo.outputPath('me-scrolled-bottom-nav.png') });
    await page.mouse.wheel(0, -150);
    await pinnedNavigation(page);
  }
  await navigation.getByRole('link', { name: '通讯录', exact: true }).click();
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeCloseTo(contactPosition, 0);
  await page.locator('#letter-Z a').first().click();
  await expect(page).toHaveURL(/\/characters\//);
  await page.goBack();
  await expect(page.locator('.contacts-page')).toBeVisible();
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeCloseTo(contactPosition, 0);
  await page
    .getByRole('navigation', { name: '字母索引' })
    .getByRole('button', { name: '回到顶部', exact: true })
    .click();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
  await pinnedNavigation(page);
  await navigation.locator('a[href="/chat"]').click();
  await expect(page.locator('.chat-list-page')).toBeVisible();
  await pinnedNavigation(page);
  const listBottom = await page
    .locator('.virtual-list')
    .evaluate((element) => element.getBoundingClientRect().bottom);
  const navTop = await navigation.evaluate((element) => element.getBoundingClientRect().top);
  expect(listBottom).toBeLessThanOrEqual(navTop + 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await pinnedNavigation(page);
});
