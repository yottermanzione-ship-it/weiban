import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('入口脚本下载失败仍可重试，旧内核缺少的 API 在启动前补齐', async ({ page }) => {
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.abort(), { times: 1 });
  await page.addInitScript(() => {
    Reflect.deleteProperty(Array.prototype, 'flatMap');
    Reflect.deleteProperty(Object, 'fromEntries');
    Reflect.deleteProperty(Promise, 'allSettled');
    Reflect.deleteProperty(window, 'structuredClone');
  });
  await page.goto('/settings/about?from=boot');
  const retry = page.getByRole('link', { name: '重新加载' });
  await expect(retry).toBeHidden();
  await expect(retry).toBeVisible({ timeout: 16_000 });
  const bar = await page.locator('.boot-bar').boundingBox();
  const hint = await page.locator('.boot-slow').boundingBox();
  expect(hint!.y).toBeGreaterThan(bar!.y + bar!.height);
  await page.evaluate(() => localStorage.setItem('boot-test', 'retained'));
  await retry.click();
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/about\?from=boot$/);
  expect(await page.evaluate(() => localStorage.getItem('boot-test'))).toBe('retained');
});

test('主程序接手后若首页没有画出，仍能看到重试入口', async ({ page }) => {
  await page.addInitScript(() => {
    const mark = performance.mark.bind(performance);
    performance.mark = (...args) => {
      if (args[0] === 'weiban:boot-js') throw new Error('synthetic startup failure');
      return mark(...args);
    };
  });
  await page.goto('/');
  await expect(page.locator('#boot-splash')).toHaveClass(/boot-js/);
  await expect(page.getByRole('link', { name: '重新加载' })).toBeVisible({ timeout: 16_000 });
  await expect(page.locator('#root')).toBeEmpty();
});
