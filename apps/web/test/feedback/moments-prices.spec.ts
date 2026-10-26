import { expect, test } from '@playwright/test';
const fixture = '/test/browser-fixtures/moments-prices.html';
test('点赞名字可进资料；评论名字与回复正文是不同命中区域', async ({ page }) => {
  await page.goto(fixture);
  const name = page.locator('.moment-comment').getByRole('link', { name: '角色甲' });
  await expect(name).toHaveAttribute('href', '/characters/33333333-3333-4333-8333-333333333333');
  await page.getByTestId('likes').getByRole('link', { name: '角色甲' }).click();
  await expect(page.getByTestId('route')).toHaveText(
    '/characters/33333333-3333-4333-8333-333333333333',
  );
  await expect(page.getByTestId('replies')).toHaveText('0');
  await name.click();
  await expect(page.getByTestId('replies')).toHaveText('0');
  await page.locator('.moment-comment').getByRole('link', { name: '角色乙' }).click();
  await expect(page.getByTestId('route')).toHaveText(
    '/characters/44444444-4444-4444-8444-444444444444',
  );
  await expect(page.getByTestId('replies')).toHaveText('0');
  await page.getByRole('button', { name: '回复角色甲的评论' }).click();
  await expect(page.getByTestId('replies')).toHaveText('1');
  await expect(page.getByTestId('route')).toHaveText(
    '/characters/44444444-4444-4444-8444-444444444444',
  );
});
test('用户价目表隐藏内部用途，通话只标分钟估价且不把旧每条数值当分钟价', async ({ page }) => {
  await page.goto(fixture);
  await expect(page.getByTestId('public-prices')).not.toContainText('Jev');
  await expect(page.getByTestId('public-prices')).not.toContainText('联网搜索');
  await expect(page.getByTestId('public-prices')).toContainText('正常聊天模型');
  await expect(page.getByTestId('public-prices')).toContainText('通话模型');
  await expect(page.getByTestId('minute')).toHaveText('约每分钟 3.25 积分');
  await expect(page.getByTestId('minute')).not.toContainText('每条');
  await expect(page.getByTestId('old-server')).toHaveText('分钟价格待估算');
});
