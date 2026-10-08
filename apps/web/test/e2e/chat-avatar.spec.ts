import { expect, test, type Page } from '@playwright/test';
async function upload(page: Page) {
  await page.getByLabel('头像', { exact: true }).setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqoAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.getContext('2d')?.getImageData(250, 250, 1, 1).data[3] ===
      255,
  );
  await page.getByRole('button', { name: '完成裁剪并上传', exact: true }).click();
}
test('私聊双方40px头像：真实私有图片、失败默认回退和深色文字对比', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_guide');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/profile');
  await upload(page);
  await expect(page.getByRole('status')).toHaveText('头像已保存');
  await page.goto('/contacts');
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await upload(page);
  await expect(page.getByRole('status')).toHaveText('已设置，只有你能看到');
  await page.getByRole('link', { name: '发消息', exact: true }).click();
  const role = page.getByRole('img', { name: '测试陪伴角色头像' }).first();
  await expect(role.locator('img')).toHaveJSProperty('naturalWidth', 512);
  await expect
    .poll(() => role.evaluate((element) => element.getBoundingClientRect().width))
    .toBe(40);
  await page.getByLabel('消息', { exact: true }).fill('检查我的聊天头像');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const mine = page.locator('.message-row.mine').filter({ hasText: '检查我的聊天头像' });
  await expect(mine.getByRole('img', { name: '我的头像' }).locator('img')).toHaveJSProperty(
    'naturalWidth',
    512,
  );
  await expect
    .poll(() =>
      mine
        .getByRole('img', { name: '我的头像' })
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBe(40);
  await page.route('**/api/v1/media/*/content?**', (route) => route.abort('failed'));
  await page.reload();
  await expect(role).toContainText('测试');
  await expect(role.locator('img')).toHaveCount(0);
  await expect(mine.getByRole('img', { name: '我的头像' })).toContainText('其他');
  await expect(mine.locator('img')).toHaveCount(0);
  await page.evaluate(() => (document.documentElement.dataset.scheme = 'dark'));
  await expect
    .poll(() =>
      mine.getByRole('img', { name: '我的头像' }).evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, foreground: style.color };
      }),
    )
    .toEqual({ background: 'rgb(217, 217, 217)', foreground: 'rgb(26, 26, 26)' });
  await page.screenshot({ path: 'apps/web/test-results/chat-avatars.png', fullPage: true });
});
