import { expect, test } from './fixtures.js';

test('四个主页顶部对齐且我页同步白色系统栏', async ({ page }) => {
  await page.addInitScript(() => {
    const messages: unknown[] = [];
    Object.assign(window, {
      nativeThemes: messages,
      weibanDevice: {
        onmessage: null,
        postMessage(raw: string) {
          messages.push(JSON.parse(raw));
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  const welcome = page.getByRole('heading', { name: 'TA 该怎么称呼你？' });
  await expect(welcome.or(page.getByRole('navigation', { name: '主导航' }))).toBeVisible();
  if (await welcome.isVisible()) {
    await page.getByLabel('昵称', { exact: true }).fill('布局检查');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: /测试陪伴角色/ }).click();
    await expect(page).toHaveURL(/\/chat\//);
  }
  await page.goto('/chat');
  await expect(page.locator('.chat-list-head')).toBeVisible();
  await expect.poll(async () => (await page.locator('.chat-list-head').boundingBox())?.y).toBe(0);
  await page.getByRole('link', { name: '通讯录', exact: true }).click();
  await expect(page).toHaveURL(/\/contacts$/);
  await expect(page.getByRole('heading', { name: '通讯录', exact: true })).toBeVisible();
  await expect.poll(async () => (await page.locator('.nav-bar').boundingBox())?.y).toBe(0);
  await page.getByRole('link', { name: '发现', exact: true }).click();
  // Both pages have .nav-bar: wait for the destination before measuring, not the old header.
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole('heading', { name: '发现', exact: true })).toBeVisible();
  await expect.poll(async () => (await page.locator('.nav-bar').boundingBox())?.y).toBe(0);
  await page.getByRole('link', { name: '我', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'me');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((x) =>
          x.getAttribute('content'),
        ),
      ),
    )
    .toContain('#FFFFFF');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { nativeThemes: { type: string; surface?: string }[] }).nativeThemes
            .filter((x) => x.type === 'theme')
            .at(-1)?.surface,
      ),
    )
    .toBe('white');
  await page.getByRole('link', { name: '通讯录', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
      ),
    )
    .toBe('#EDEDED');
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: '检查更新', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更新版本', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '更新版本', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
});
