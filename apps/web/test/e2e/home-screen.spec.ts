import { expect, test, type Page } from '@playwright/test';
const safari = (version: string) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${version} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1`;
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_guide');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}
async function openChat(page: Page) {
  await page.goto('/chat');
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await expect(page.getByRole('heading', { name: '测试陪伴角色', exact: true })).toBeVisible();
}
test.describe('iPhone安装状态夹具与真实角色消息/本机一次性记录', () => {
  test.use({ userAgent: safari('16_4') });
  test('登录不打断；收到角色消息后只自动提示一次，设置可再次查看且支持键盘关闭', async ({
    page,
  }) => {
    await login(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await openChat(page);
    const guide = page.getByRole('dialog', { name: '添加到主屏幕，才能收到 TA 的消息提醒' });
    await expect(guide).toBeVisible();
    await expect(guide.getByRole('listitem')).toHaveCount(3);
    await expect(guide.getByRole('img', { name: /Safari 底部工具栏示意/ })).toBeVisible();
    await page.screenshot({ path: 'apps/web/test-results/home-screen-guide.png', fullPage: true });
    await guide.getByRole('button', { name: '知道了' }).click();
    await expect(guide).toBeHidden();
    await page.reload();
    await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
    await expect(guide).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('weiban:home-screen-guide-seen'))).toBe(
      '1',
    );
    await page.goto('/settings');
    const entry = page.getByRole('button', { name: '添加到主屏幕', exact: true });
    await entry.click();
    await expect(guide).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(guide).toBeHidden();
    await expect(entry).toBeFocused();
  });
  test('主屏幕启动不自动提示、不写首次标记；设置说明已安装', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true });
      Object.defineProperty(navigator, 'userAgent', {
        value: navigator.userAgent.replace(' Safari/604.1', ''),
      });
    });
    await login(page);
    await openChat(page);
    await expect(page.getByText(/浏览器历史消息/).first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem('weiban:home-screen-guide-seen')),
    ).toBeNull();
    await page.goto('/settings');
    await page.getByRole('button', { name: '添加到主屏幕', exact: true }).click();
    await expect(page.getByText('你已从主屏幕打开微伴，可在新消息通知中开启提醒。')).toBeVisible();
  });
});
test.describe('旧iOS版本夹具', () => {
  test.use({ userAgent: safari('16_3') });
  test('旧系统只说明限制，不承诺安装即可推送', async ({ page }) => {
    await login(page);
    await openChat(page);
    const guide = page.getByRole('dialog');
    await expect(guide.getByText('当前系统版本收不到推送，消息会在打开微伴时显示')).toBeVisible();
    await expect(guide.getByRole('listitem')).toHaveCount(0);
    await guide.getByRole('button', { name: '知道了' }).click();
    await expect(guide).toBeHidden();
  });
  test('缺少原生dialog API时仍能阅读并关闭说明', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: undefined });
      Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: undefined });
    });
    await login(page);
    await openChat(page);
    const guide = page.getByRole('dialog');
    await expect(guide.getByText('当前系统版本收不到推送，消息会在打开微伴时显示')).toBeVisible();
    await guide.getByRole('button', { name: '知道了' }).click();
    await expect(guide).toBeHidden();
  });
});
