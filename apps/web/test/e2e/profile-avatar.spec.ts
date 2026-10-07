import { expect, test } from '@playwright/test';
test('我和资料页统一64px昵称头像，私有图片失败后保持主题对比与圆角', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_guide');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/profile');
  await page.getByLabel('头像', { exact: true }).setInputFiles({
    name: 'self.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqoAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.getContext('2d')?.getImageData(256, 256, 1, 1).data[3] ===
      255,
  );
  await page.getByRole('button', { name: '完成裁剪并上传', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('头像已保存');
  const avatar = page.getByRole('img', { name: '我的头像', exact: true });
  await expect(avatar.locator('img')).toHaveJSProperty('naturalWidth', 512);
  expect(await avatar.evaluate((element) => element.getBoundingClientRect().width)).toBe(64);
  await page.goto('/me');
  await expect(avatar.locator('img')).toHaveJSProperty('naturalWidth', 512);
  await page.route('**/api/v1/media/*/content?**', (route) => route.abort('failed'));
  await page.reload();
  await expect(avatar).toContainText('其他');
  await expect(avatar.locator('img')).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'pink';
    document.documentElement.dataset.scheme = 'dark';
  });
  expect(
    await avatar.evaluate((element) => {
      const style = getComputedStyle(element);
      return { bg: style.backgroundColor, fg: style.color, radius: style.borderRadius };
    }),
  ).toEqual({ bg: 'rgb(226, 221, 224)', fg: 'rgb(31, 26, 29)', radius: '7.68px' });
  await page.goto('/profile');
  await expect(avatar).toContainText('其他');
  expect(await avatar.evaluate((element) => element.getBoundingClientRect().width)).toBe(64);
});
