import { expect, test } from '@playwright/test';
test('角色默认头像不随备注改变；实际私有头像裁剪、失败回退和恢复', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/contacts');
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  const profilePath = new URL(page.url()).pathname;
  const sources = page.getByRole('dialog', { name: '选择头像来源' });
  const avatar = page.getByRole('img', { name: '测试陪伴角色头像', exact: true });
  await expect(avatar).toBeVisible();
  await expect(avatar).toContainText('测试');
  const originalColor = await avatar.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.getByRole('link', { name: '设置备注和头像', exact: true }).click();
  await page.getByLabel('备注名').fill('王一博');
  await page.getByRole('button', { name: '保存称呼', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('已保存');
  await page.goto(profilePath);
  await expect(avatar).toBeVisible();
  await page.getByRole('button', { name: '选择头像', exact: true }).click();
  await expect(sources.getByRole('button', { name: '恢复默认头像', exact: true })).toHaveCount(0);
  await sources.getByRole('button', { name: '取消', exact: true }).click();
  await expect(avatar).toContainText('测试');
  expect(await avatar.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    originalColor,
  );
  const purposes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/media?'))
      purposes.push(new URL(request.url()).searchParams.get('purpose')!);
  });
  await page.getByLabel('头像', { exact: true }).setInputFiles({
    name: 'private-avatar.png',
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
  await expect(page.getByRole('status')).toHaveText('已设置，只有你能看到');
  expect(purposes).toEqual(['contact_avatar']);
  await expect(avatar.locator('img')).toHaveJSProperty('naturalWidth', 512);
  let blockedPictures = 0;
  await page.route('**/api/v1/media/*/content?**', (route) => {
    blockedPictures++;
    return route.abort('failed');
  });
  await page.reload();
  await expect.poll(() => blockedPictures).toBeGreaterThan(0);
  await expect(avatar).toContainText('测试');
  await expect(avatar.locator('img')).toHaveCount(0);
  await page.unroute('**/api/v1/media/*/content?**');
  await page.getByRole('button', { name: '选择头像', exact: true }).click();
  await expect(sources.getByRole('button', { name: '从相册选择', exact: true })).toBeVisible();
  await expect(sources.getByRole('button', { name: '拍照', exact: true })).toBeVisible();
  await sources.getByRole('button', { name: '恢复默认头像', exact: true }).click();
  await expect(sources).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('已恢复默认头像');
  await expect(page.getByRole('button', { name: '恢复默认头像', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '选择头像', exact: true }).click();
  await expect(sources.getByRole('button', { name: '恢复默认头像', exact: true })).toHaveCount(0);
  await sources.getByRole('button', { name: '取消', exact: true }).click();
  await expect(avatar).toContainText('测试');
  expect(await avatar.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    originalColor,
  );
  await page.getByRole('link', { name: '设置备注和头像', exact: true }).click();
  await page.getByLabel('备注名').fill('');
  await page.getByRole('button', { name: '保存称呼', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('已保存');
});
