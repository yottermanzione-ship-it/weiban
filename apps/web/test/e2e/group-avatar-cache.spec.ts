import { expect, test, type Page } from './fixtures.js';

async function login(page: Page, name: string) {
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill(name);
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

test('自定义群头像启动预载与页面共用同一张图片，切页不重复取图，换账号清掉群头像', async ({
  page,
}) => {
  const transfers: string[] = [];
  page.on('request', (req) => {
    if (/\/media\/[^/]+\/content\?/.test(req.url())) transfers.push(req.url());
  });
  await page.goto('/');
  await login(page, 'browser_layout');
  const group = page.getByRole('link', { name: /头像加载测试群/ });
  const picture = group.getByRole('img', { name: '群头像', exact: true }).locator('img');
  await expect(picture).toHaveJSProperty('naturalWidth', 96);
  await expect(picture).toHaveAttribute('src', /^blob:/);
  expect(transfers).toHaveLength(1);
  await page.reload();
  await expect(picture).toHaveJSProperty('naturalWidth', 96);
  await expect(picture).toHaveAttribute('src', /^blob:/);
  // 私有字节不写磁盘，每次冷启动取一次；启动预载和列表挂载不能各取一遍。
  expect(transfers).toHaveLength(2);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '通讯录', exact: true })
    .click();
  await page.getByRole('navigation', { name: '主导航' }).locator('a[href="/chat"]').click();
  await expect(picture).toHaveJSProperty('naturalWidth', 96);
  expect(transfers).toHaveLength(2);
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '退出登录？', exact: true })
    .getByRole('button', { name: '退出登录', exact: true })
    .click();
  await login(page, 'browser_other');
  await expect(page.getByRole('link', { name: /头像加载测试群/ })).toHaveCount(0);
  await expect(page.getByRole('img', { name: '群头像', exact: true })).toHaveCount(0);
});
