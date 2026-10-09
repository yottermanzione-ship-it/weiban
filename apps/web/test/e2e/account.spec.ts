import { expect, test, type Page } from '@playwright/test';
import { AuthResponse } from '@weiban/contracts';
import { readFile, writeFile } from 'node:fs/promises';
async function login(page: Page, name = 'browser_user') {
  await page.goto('/');
  await page.getByLabel('微伴号').fill(name);
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: '主导航' })
      .or(page.getByRole('heading', { name: 'TA 该怎么称呼你？' })),
  ).toBeVisible();
}

test('真实API：登录、资料、微元预算、主题、刷新与退出清本地数据', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await expect(page.getByRole('heading', { name: 'TA 该怎么称呼你？' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await page.getByLabel('昵称', { exact: true }).fill('浏览器用户');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByText('先加一个你喜欢的 TA 吧')).toBeVisible();
  await page.getByRole('button', { name: '选择测试陪伴角色', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\//);
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/me');
  await page.getByRole('link', { name: '我', exact: true }).click();
  await page.goto('/wallet');
  await expect(page.locator('.balance strong')).toHaveText('¥ 50.00');
  await page.screenshot({ path: 'apps/web/test-results/wallet.png', fullPage: true });
  await page.getByLabel('每日上限（元）').fill('1.234567');
  await page.getByLabel('余额提醒线（元）').fill('5.000001');
  const updated = page.waitForResponse(
    (r) => r.url().endsWith('/billing/wallet/settings') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  expect((await (await updated).json()).backgroundBudget.dailyLimitMicros).toBe(1234567);
  await page.goto('/settings/general');
  await page.getByRole('button', { name: '微伴粉', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pink');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pink');
  await expect(page.getByRole('heading', { name: '通用', exact: true })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  const keys = await page.evaluate(
    () =>
      new Promise<IDBValidKey[]>((resolve, reject) => {
        const r = indexedDB.open('weiban-app', 1);
        r.onsuccess = () => {
          const q = r.result.transaction('records').objectStore('records').getAllKeys();
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(new Error('idb'));
        };
      }),
  );
  expect(keys).toEqual([]);
  expect(errors).toEqual([]);
});
test('断网与账号切换：本机资料可读，旧账号余额不会进入新账号', async ({ page, context }) => {
  await login(page);
  await page.goto('/wallet');
  await expect(page.locator('.balance strong')).toHaveText('¥ 50.00');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.balance strong')).toHaveText('¥ 50.00');
  await expect(page.getByText('网络暂不可用，正在显示本机保存的内容')).toBeVisible();
  await context.setOffline(false);
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await login(page, 'browser_other');
  await page.goto('/wallet');
  await expect(page.locator('.balance strong')).toHaveText('¥ 1.00');
});

test('实际头像裁剪、multipart上传和私有凭证展示', async ({ page }) => {
  await login(page);
  await page.goto('/profile');
  await page.getByLabel('头像', { exact: true }).setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqoAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByRole('button', { name: '完成裁剪并上传' })).toBeVisible();
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return c?.getContext('2d')?.getImageData(250, 250, 1, 1).data[3] === 255;
  });
  await page.getByRole('button', { name: '完成裁剪并上传' }).click();
  await expect(page.getByRole('status')).toHaveText('头像已保存');
  const avatar = page.getByRole('img', { name: '我的头像' });
  await expect(avatar).toBeVisible();
  await expect(avatar.locator('img')).toHaveJSProperty('naturalWidth', 512);
});
test('服务器失效会话后刷新，不能重新恢复旧令牌或显示资料', async ({ page }) => {
  await login(page);
  const auth = AuthResponse.parse(
    await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const open = indexedDB.open('weiban-app', 1);
          open.onsuccess = () => {
            const value = open.result.transaction('records').objectStore('records').get('session');
            value.onsuccess = () => resolve(value.result);
          };
        }),
    ),
  );
  const response = await page.request.post('/api/v1/auth/logout', {
    headers: { Authorization: `Bearer ${auth.session.token}` },
  });
  expect(response.status()).toBe(204);
  await page.reload();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
});

test('真实Service Worker升级等待确认，更新后仍保持登录', async ({ page }) => {
  await login(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const file = new URL('../../dist/sw.js', import.meta.url);
  const original = await readFile(file, 'utf8');
  try {
    await writeFile(file, original + '\n// browser update regression\n');
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect(page.getByText('新版本已准备好')).toBeVisible();
    await page.getByRole('button', { name: '更新', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await expect(page.getByText('新版本已准备好')).toHaveCount(0);
  } finally {
    await writeFile(file, original);
  }
});
