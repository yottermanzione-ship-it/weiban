import { expect, test } from '@playwright/test';

test('保存前试聊走真实接口，关闭清理后继续保存同一份编辑字段', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_other');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/characters/custom/new');
  await page.getByRole('textbox', { name: '名字', exact: true }).fill('保存前试聊测试');
  const description =
    '这是一个喜欢观察日常生活的原创成年角色，性格温柔而耐心，喜欢晴天散步和阅读，说话自然简洁，尊重他人边界，不编造真实经历。';
  await page.getByLabel(/人设描述/).fill(description);
  const started = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1/characters/custom/trial' &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存前试聊', exact: true }).click();
  const response = await started;
  expect(response.status()).toBe(200);
  const trial = (await response.json()) as { characterId: string; conversationId: string };
  const dialog = page.getByRole('dialog', { name: '角色试聊' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('试聊消息').fill('试聊消息只在这次会话里');
  const sent = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/v1/conversations/${trial.conversationId}/messages` &&
      r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '发送', exact: true }).click();
  expect((await sent).status()).toBe(200);
  await expect(dialog.getByText('试聊消息只在这次会话里', { exact: false })).toBeVisible();
  const ended = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/v1/characters/custom/trial/${trial.conversationId}` &&
      r.request().method() === 'DELETE',
  );
  await dialog.getByRole('button', { name: '结束试聊，返回编辑' }).click();
  expect((await ended).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '名字', exact: true })).toHaveValue(
    '保存前试聊测试',
  );
  await expect(page.getByLabel(/人设描述/)).toHaveValue(description);
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1/characters/custom' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  const role = (await savedResponse.json()) as { characterId: string };
  expect(role.characterId).not.toBe(trial.characterId);
  await expect(page).toHaveURL(new RegExp(`/characters/${role.characterId}$`));
});
