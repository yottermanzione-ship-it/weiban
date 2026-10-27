import { expect, test, type Page } from '@playwright/test';
import { AuthResponse } from '@weiban/contracts';
import { readFile, writeFile } from 'node:fs/promises';
async function login(page: Page, name = 'browser_user') {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill(name);
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: '主导航' })
      .or(page.getByRole('heading', { name: 'TA 该怎么称呼你？' })),
  ).toBeVisible();
}

test('真实API：登录、资料、积分提醒、主题、刷新与退出清本地数据', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await expect(page.getByRole('heading', { name: 'TA 该怎么称呼你？' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await page.getByLabel('昵称', { exact: true }).fill('浏览器用户');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByText('先加一个你喜欢的 TA 吧')).toBeVisible();
  await page.getByRole('button', { name: /测试陪伴角色/ }).click();
  await expect(page).toHaveURL(/\/chat\//);
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/me');
  await page.getByRole('link', { name: '我', exact: true }).click();
  await page.goto('/wallet');
  await expect(page.locator('.wallet-number')).toHaveText('5,000');
  await page.screenshot({ path: 'apps/web/test-results/wallet.png', fullPage: true });
  // The current wallet uses points; the user-editable reminder lives under Usage.
  await page.goto('/usage');
  await page.getByRole('button', { name: /^积分提醒线/ }).click();
  await page
    .getByRole('dialog', { name: '积分提醒线', exact: true })
    .getByRole('textbox')
    .fill('500.0001');
  const updated = page.waitForResponse(
    (r) => r.url().endsWith('/billing/wallet/settings') && r.request().method() === 'PATCH',
  );
  await page
    .getByRole('dialog', { name: '积分提醒线', exact: true })
    .getByRole('button', { name: '完成', exact: true })
    .click();
  const wallet = await (await updated).json();
  expect(wallet.lowBalanceThresholdPoints).toBe(500.0001);
  expect(wallet.lowBalanceThresholdMicros).toBe(5_000_001);
  await page.goto('/settings/general');
  await page.getByRole('button', { name: /^深色模式/ }).click();
  await page.getByRole('radio', { name: '深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'dark');
  await expect(page.getByRole('heading', { name: '通用', exact: true })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '退出登录？', exact: true })
    .getByRole('button', { name: '退出登录', exact: true })
    .click();
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
  await expect(page.locator('.wallet-number')).toHaveText('5,000');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.wallet-number')).toHaveText('5,000');
  await expect(page.getByText('网络暂不可用，正在显示本机保存的内容')).toBeVisible();
  await context.setOffline(false);
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '退出登录？', exact: true })
    .getByRole('button', { name: '退出登录', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await login(page, 'browser_other');
  await page.goto('/wallet');
  await expect(page.locator('.wallet-number')).toHaveText('100');
});

test('实际头像裁剪、multipart上传和私有凭证展示', async ({ page }) => {
  await login(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: /^头像 / }).click();
  await page.getByLabel('头像', { exact: true }).setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqoAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByRole('button', { name: '完成' })).toBeVisible();
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return c?.getContext('2d')?.getImageData(250, 250, 1, 1).data[3] === 255;
  });
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('status')).toContainText('头像已保存');
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

test('真实Service Worker升级不打断使用，明确刷新后接续新版且保持登录', async ({ page }) => {
  // Exercise the safe idle-refresh branch; live WS close/drain behavior has separate coverage.
  await page.routeWebSocket('**/api/v1/ws', (socket) =>
    socket.close({ code: 1000, reason: 'idle upgrade fixture' }),
  );
  await page.addInitScript(() => {
    const events: string[] = [];
    Object.assign(window, { weibanSwEvents: events });
    for (const name of ['weiban:before-update', 'weiban:update-failed'])
      window.addEventListener(name, () => events.push(`${name}:${Math.round(performance.now())}`));
    navigator.serviceWorker.addEventListener('controllerchange', () =>
      events.push('controllerchange'),
    );
  });
  await login(page, 'browser_guide');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const file = new URL('../../dist/sw.js', import.meta.url);
  const original = await readFile(file, 'utf8');
  try {
    await writeFile(file, original + '\nself.weibanBrowserUpgrade = true;\n');
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect
      .poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)))
      .toBe(true);
    await expect(page.getByText('新版本已准备好')).toHaveCount(0);
    await page.reload();
    await expect
      .poll(async () => {
        const workers = page.context().serviceWorkers();
        return (
          await Promise.all(
            workers.map((worker) =>
              worker.evaluate(() => 'weibanBrowserUpgrade' in globalThis).catch(() => false),
            ),
          )
        ).some(Boolean);
      })
      .toBe(true);
    await expect
      .poll(
        () =>
          page
            .evaluate(async () =>
              JSON.stringify({
                waiting: Boolean((await navigator.serviceWorker.ready).waiting),
                visibility: document.visibilityState,
                navigation: (
                  performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
                ).type,
                events: (window as unknown as { weibanSwEvents: string[] }).weibanSwEvents,
              }),
            )
            .catch((error: unknown) => {
              // Accept only the expected execution-context replacement during the automatic reload.
              if (
                error instanceof Error &&
                error.message.includes('Execution context was destroyed')
              )
                return 'reloading';
              throw error;
            }),
        { timeout: 15_000 },
      )
      .toContain('"waiting":false');
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  } finally {
    await writeFile(file, original);
  }
});
