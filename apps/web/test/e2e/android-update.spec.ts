import { type Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const mobile = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile';
const filename = 'weiban-3.0.0-129-abcdef123456.apk';
const appUrl = `https://app.weiban.online/download-assets/${filename}`;
const browserUrl = `https://weiban.online/download-assets/${filename}`;

test.use({ serviceWorkers: 'block' });

async function settings(page: Page, webVersionCode?: number) {
  if (webVersionCode) {
    await page.route('**/build-info.json?*', (route) =>
      route.fulfill({ json: { version: '下一网页版本', versionCode: webVersionCode } }),
    );
  }
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_avatar');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
}

function androidRelease(page: Page, latestVersionCode: number, downloads: string[] = []) {
  return page.route('**/api/v1/app/version-check?*', async (route) => {
    const url = new URL(route.request().url());
    downloads.push(url.searchParams.get('versionCode') ?? '');
    const installed = Number(url.searchParams.get('versionCode'));
    await route.fulfill({
      json: {
        platform: 'android',
        latestVersion: '3.0.0',
        latestVersionCode,
        downloadUrl: appUrl,
        minSupportedVersionCode: 127,
        updateAvailable: latestVersionCode > installed,
        updateRequired: false,
        forceUpdateMessage: null,
        latestNote: null,
      },
    });
  });
}

test.describe('安卓手机上的普通浏览器', () => {
  test.use({ userAgent: mobile });
  test('检查更新只提供网页更新', async ({ page }) => {
    const queries: string[] = [];
    await androidRelease(page, 129, queries);
    await settings(page, 999_999);
    const dialog = page.getByRole('dialog', { name: '更新提示' });
    await expect(dialog.getByRole('button', { name: '更新网页', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '下载安卓新版', exact: true })).toHaveCount(0);
    expect(queries).toEqual([]);
  });
});

test.describe('首次从现有微伴获取正式安装包', () => {
  test.use({ userAgent: `${mobile} WeibanShell/3.0.0` });
  test('旧包从设置直接打开独立下载地址', async ({ page }) => {
    const queries: string[] = [];
    await androidRelease(page, 129, queries);
    await page.route(browserUrl, (route) =>
      route.fulfill({
        contentType: 'application/vnd.android.package-archive',
        headers: { 'Content-Disposition': `attachment; filename="${filename}"` },
        body: 'synthetic package download fixture',
      }),
    );
    await settings(page);
    const dialog = page.getByRole('dialog', { name: '更新提示' });
    await expect(dialog.getByText('当前网页已是最新版本', { exact: true })).toBeVisible();
    await expect(dialog.getByText('将用手机浏览器直接下载安装包。')).toBeVisible();
    const file = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下载安卓新版', exact: true }).click();
    expect((await file).url()).toBe(browserUrl);
    expect(queries).toEqual(['127']);
  });
});

test.describe('支持应用内下载的微伴', () => {
  test.use({ userAgent: `${mobile} WeibanShell/3.0.0 WeibanBuild/128` });
  test('用安装包构建号检查，在同一弹窗提供两种更新', async ({ page }) => {
    await page.addInitScript(() => {
      const bridge = {
        onmessage: null as ((event: { data: string }) => void) | null,
        postMessage(raw: string) {
          const input = JSON.parse(raw) as { id: string };
          window.sessionStorage.setItem('test-native-update', raw);
          this.onmessage?.({ data: JSON.stringify({ id: input.id, status: 'downloading' }) });
          this.onmessage?.({ data: JSON.stringify({ id: input.id, status: 'installer_opened' }) });
        },
      };
      Object.assign(window, { weibanAppUpdate: bridge });
    });
    const queries: string[] = [];
    await androidRelease(page, 129, queries);
    await settings(page, 999_999);
    const dialog = page.getByRole('dialog', { name: '更新提示' });
    await expect(dialog.getByRole('button', { name: '更新网页', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '下载安卓新版', exact: true }).click();
    await expect(dialog.getByText('安卓安装包已下载，请在系统界面确认安装')).toBeVisible();
    const nativeRequest = await page.evaluate(() =>
      JSON.parse(window.sessionStorage.getItem('test-native-update') ?? '{}'),
    );
    expect(nativeRequest).toMatchObject({ url: appUrl, versionCode: 129 });
    expect(queries).toEqual(['128']);
  });
});
