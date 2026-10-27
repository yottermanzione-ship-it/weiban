import { expect, test } from '@playwright/test';
test('首次昵称、选角与申请草稿可恢复；真实添加保持待通过状态，不编造会话', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_first');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'TA 该怎么称呼你？' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await expect(page.getByLabel('昵称', { exact: true })).toHaveAttribute('required', '');
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
  await page.getByRole('button', { name: /测试陪伴角色/ }).click();
  await expect(page).toHaveURL(/\/discover\?onboarding=1$/);
  await page.getByRole('button', { name: '添加到通讯录', exact: true }).click();
  await page.getByLabel('发送添加朋友申请', { exact: true }).fill('很高兴认识你');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open('weiban-app');
          request.onsuccess = () => resolve(request.result);
        });
        const value = await new Promise<unknown>((resolve) => {
          const request = db
            .transaction('records')
            .objectStore('records')
            .get('ui:onboardingDraft');
          request.onsuccess = () => resolve(request.result);
        });
        db.close();
        return value;
      }),
    )
    .toMatchObject({ greeting: '很高兴认识你' });
  await page.goto('/');
  await page.getByRole('button', { name: '添加到通讯录', exact: true }).click();
  await expect(page.getByLabel('发送添加朋友申请', { exact: true })).toHaveValue('很高兴认识你');
  await expect(
    page.getByRole('heading', { name: '测试陪伴角色', exact: true, level: 2 }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '添加到通讯录', exact: true }).click();
  await expect(page.getByLabel('发送添加朋友申请', { exact: true })).toHaveValue('很高兴认识你');
  const added = page.waitForResponse(
    (response) => response.url().endsWith('/contacts') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const response = await added;
  expect(response.status()).toBe(200);
  const contact = await response.json();
  expect(contact.status).toBe('pending');
  expect(contact.conversationId).toBeNull();
  await expect(page.getByText('等待通过…', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '发消息', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/discover\?onboarding=1$/);
  await page.getByRole('button', { name: '重新选择角色', exact: true }).click();
  await page.getByRole('button', { name: /测试陪伴角色/ }).click();
  await expect(page.getByText('等待通过…', { exact: true })).toBeVisible();
});
