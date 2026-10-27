import { expect, test } from '@playwright/test';
test.use({ hasTouch: true });
test('拍照选图裁剪支持真实鼠标拖动、双指缩放和512px私有上传', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_guide');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/profile');
  await page.getByRole('button', { name: /^头像 / }).click();
  await expect(page.getByLabel('拍照', { exact: true })).toHaveAttribute('capture', 'user');
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 200;
    image.height = 100;
    const context = image.getContext('2d')!;
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 100, 100);
    context.fillStyle = '#0000ff';
    context.fillRect(100, 0, 100, 100);
    return image.toDataURL('image/png').split(',')[1]!;
  });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: /^头像 / }).click();
  const [picker] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: '拍照', exact: true }).click(),
  ]);
  await picker.setFiles({
    name: 'camera.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  const preview = page.getByLabel('头像裁剪预览');
  await expect(preview).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')!.getContext('2d')!.getImageData(256, 256, 1, 1).data[3] ===
      255,
  );
  const bounds = (await preview.boundingBox())!;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + bounds.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.2, y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() =>
      preview.evaluate((canvas: HTMLCanvasElement) =>
        Array.from(canvas.getContext('2d')!.getImageData(256, 256, 1, 1).data),
      ),
    )
    .toEqual([0, 0, 255, 255]);
  const cdp = await page.context().newCDPSession(page);
  const cx = bounds.x + bounds.width / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - 20, y, id: 1 },
      { x: cx + 20, y, id: 2 },
    ],
  });
  for (let delta = 25; delta <= 50; delta += 5) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - delta, y, id: 1 },
        { x: cx + delta, y, id: 2 },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect
    .poll(() => page.getByLabel('缩放', { exact: true }).inputValue().then(Number))
    .toBeGreaterThan(2);
  const fine = page.getByText('精细调整', { exact: true });
  await fine.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('缩放', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('缩放', { exact: true })).toBeHidden();
  await page.screenshot({ path: 'apps/web/test-results/avatar-crop-gestures.png', fullPage: true });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('头像已保存');
  await expect(page.locator('.user-avatar')).toHaveJSProperty('naturalWidth', 512);
  await expect(preview).toHaveCount(0);
});
