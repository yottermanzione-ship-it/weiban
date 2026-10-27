import { expect, test } from '@playwright/test';
import { selectWheelDate } from './persona-ui.js';

test('会话图片、链接和日期定位使用真实服务器接口', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: '主导航' });
  const onboarding = page.getByRole('heading', { name: 'TA 该怎么称呼你？' });
  await expect(navigation.or(onboarding)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page.getByLabel('昵称', { exact: true }).fill('搜索测试用户');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: /测试陪伴角色/ }).click();
    await expect(page).toHaveURL(/\/chat\//);
  }
  await page.goto('/chat');
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await expect(page.getByRole('heading', { name: '测试陪伴角色' })).toBeVisible();
  const conversationId = new URL(page.url()).pathname.split('/')[2];
  // 其他流程会真实清空同一账号的历史；本用例自行准备仍可见的消息。
  await page.getByLabel('消息', { exact: true }).fill('日期定位独立测试消息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.wx-bubble').filter({ hasText: '日期定位独立测试消息' })).toHaveCount(
    1,
  );
  await expect(page.getByText('已送达', { exact: true })).toBeVisible();
  await page.goto(`/chat/${conversationId}/search`);
  for (const [label, type] of [
    ['图片', 'image'],
    ['链接', 'link'],
  ] as const) {
    const response = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return (
        url.pathname.endsWith('/messages/by-type') && url.searchParams.get('contentType') === type
      );
    });
    await page.getByRole('button', { name: label, exact: true }).click();
    expect((await response).status()).toBe(200);
    await page.getByRole('button', { name: '‹ 快速查找', exact: true }).click();
  }
  await page.getByRole('button', { name: '日期', exact: true }).click();
  const response = page.waitForResponse((r) =>
    new URL(r.url()).pathname.endsWith('/messages/locate'),
  );
  await page.getByLabel('选择日期').click();
  await selectWheelDate(page, '选择日期', '2026-10-05');
  const result = await response;
  expect(result.status()).toBe(200);
  const target = (await result.json()) as { seq: number | null };
  expect(target.seq).not.toBeNull();
  // 定位参数被聊天页消费后清除，验证实际消息高亮而非短暂的URL。
  await expect(page.locator('.flash-row')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`));
});
