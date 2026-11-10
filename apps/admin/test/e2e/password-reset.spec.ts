import { expect, test, type Page } from '@playwright/test';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test.describe('用户详情密码重置', () => {
  // 输入只保留测试进程内存，失败时也不保存含输入内容的跟踪或截图。
  test('普通用户详情可重置，确认一致才提交，取消与成功后清空', async ({ page }) => {
    await login(page);
    const username = `reset_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const oldPassword = crypto.randomUUID();
    const password = crypto.randomUUID();
    const device = {
      platform: 'web',
      name: 'reset-ui',
      appVersion: '1',
      timeZone: 'Asia/Shanghai',
    };
    const registration = await page.request.post('/api/v1/auth/register', {
      data: { username, password: oldPassword, device },
    });
    expect(registration.status()).toBe(201);
    const user = (await registration.json()).user;
    await page.goto(`/accounts?userId=${user.userId}`);
    await page.getByRole('button', { name: '重置密码', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '重置密码', exact: true });
    await expect(dialog).toContainText(username);
    await dialog.getByLabel('新密码', { exact: true }).fill(password);
    await dialog.getByLabel('再次输入新密码', { exact: true }).fill(oldPassword);
    await dialog.getByRole('button', { name: '确认重置', exact: true }).click();
    await expect(dialog.getByText('两次密码不一致', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '重置密码', exact: true }).click();
    expect(await dialog.getByLabel('新密码', { exact: true }).inputValue()).toBe('');
    await dialog.getByLabel('新密码', { exact: true }).fill(password);
    await dialog.getByLabel('再次输入新密码', { exact: true }).fill(password);
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/admin/users/${user.userId}/password`) && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '确认重置', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog).toBeHidden();
    const loggedIn = await page.request.post('/api/v1/auth/login', {
      data: { username, password, device },
    });
    expect(loggedIn.status()).toBe(200);
    const oldLogin = await page.request.post('/api/v1/auth/login', {
      data: { username, password: oldPassword, device },
    });
    expect(oldLogin.status()).toBe(401);
    const leaked = await page.evaluate(async (value) => {
      if (
        JSON.stringify(localStorage).includes(value) ||
        JSON.stringify(sessionStorage).includes(value)
      )
        return true;
      return new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('weiban-admin', 1);
        open.onerror = () => reject(new Error('无法检查本地存储'));
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction('records').objectStore('records').getAll();
          read.onsuccess = () => {
            resolve(JSON.stringify(read.result).includes(value));
            db.close();
          };
          read.onerror = () => {
            reject(new Error('无法读取本地存储'));
            db.close();
          };
        };
      });
    }, password);
    expect(leaked).toBe(false);
    await page.getByRole('button', { name: '重置密码', exact: true }).click();
    expect(await dialog.getByLabel('新密码', { exact: true }).inputValue()).toBe('');
  });
});

async function login(page: Page, username = 'browser_admin') {
  await page.goto('/');
  await page.getByLabel('管理员账号').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  if (username === 'browser_admin') await expect(page.locator('.admin-avatar')).toBeVisible();
}
