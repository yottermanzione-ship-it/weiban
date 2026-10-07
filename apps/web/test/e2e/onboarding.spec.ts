import { expect, test } from '@playwright/test';
test('首次昵称和选择角色在四步内；真实添加保持待通过状态，不编造会话', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_first');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'TA 该怎么称呼你？' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await expect(page.getByLabel('生日', { exact: true })).toBeHidden();
  await page.getByLabel('昵称', { exact: true }).fill('第一次来');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page).toHaveURL(/\/discover\?onboarding=1$/);
  await expect(page.getByText('先加一个你喜欢的 TA 吧')).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/discover\?onboarding=1$/);
  await expect(page.getByText('先加一个你喜欢的 TA 吧')).toBeVisible();
  await page.reload();
  await expect(page.getByText('先加一个你喜欢的 TA 吧')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await page.getByRole('button', { name: '选择测试陪伴角色', exact: true }).click();
  await expect(page).toHaveURL(/\/discover\?onboarding=1$/);
  await page.getByLabel('打招呼', { exact: true }).fill('很高兴认识你');
  const added = page.waitForResponse(
    (response) => response.url().endsWith('/contacts') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '添加到通讯录', exact: true }).click();
  const response = await added;
  expect(response.status()).toBe(200);
  const contact = await response.json();
  expect(contact.status).toBe('pending');
  expect(contact.conversationId).toBeNull();
  await expect(page.getByText('等待通过好友申请', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '发消息', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/discover\?onboarding=1$/);
  await page.getByRole('button', { name: '重新选择角色', exact: true }).click();
  await page.getByRole('button', { name: '选择测试陪伴角色', exact: true }).click();
  await expect(page.getByText('等待通过好友申请', { exact: true })).toBeVisible();
});
