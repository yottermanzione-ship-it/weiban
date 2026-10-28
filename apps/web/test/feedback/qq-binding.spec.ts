import { expect, test } from '@playwright/test';
const fixture = '/test/browser-fixtures/wechat-binding.html?channel=qq';
type TestWindow = {
  wechatFixture: { copied: string; providerStatus(status: 'confirmed'): void; requests: string[] };
};

test('QQ只收新机器人凭据，配对前不显示已绑定，密钥不回填', async ({ page }) => {
  await page.setViewportSize({ width: 351, height: 755 });
  await page.goto(fixture);
  await page.getByRole('button', { name: 'QQ接入', exact: false }).click();
  const secret = page.getByPlaceholder('只在本页填写新密钥，不要发到聊天里');
  await expect(secret).toHaveAttribute('type', 'password');
  await page.getByPlaceholder('QQ官方机器人的AppID').fill('1234567890');
  await secret.fill('QQ-TEST-CANARY-NOT-REAL');
  await page.getByRole('button', { name: '测试角色 01', exact: true }).click();
  await expect(page.getByRole('button', { name: '连接QQ并生成绑定码' })).toBeInViewport({
    ratio: 1,
  });
  await page.getByRole('button', { name: '连接QQ并生成绑定码' }).click();
  await expect(page.getByRole('textbox', { name: 'QQ绑定命令' })).toHaveValue('绑定 0000000001');
  await expect(secret).toHaveCount(0);
  await expect(page.getByText('已绑定', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '复制QQ绑定命令' }).click();
  expect(await page.evaluate(() => (window as unknown as TestWindow).wechatFixture.copied)).toBe(
    '绑定 0000000001',
  );
  await page.getByRole('button', { name: '重新生成绑定码' }).click();
  await expect(page.getByRole('textbox', { name: 'QQ绑定命令' })).toHaveValue('绑定 0000000002');
  await page.evaluate(() =>
    (window as unknown as TestWindow).wechatFixture.providerStatus('confirmed'),
  );
  await expect(page.getByRole('button', { name: '解除新站绑定', exact: true })).toBeVisible();
});

test('待配对凭据可由本人确认清除，取消操作不会调用解绑接口', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: 'QQ接入', exact: false }).click();
  await page.getByPlaceholder('QQ官方机器人的AppID').fill('1234567890');
  await page.getByPlaceholder('只在本页填写新密钥，不要发到聊天里').fill('QQ-TEST-CANARY-NOT-REAL');
  await page.getByRole('button', { name: '测试角色 01', exact: true }).click();
  await page.getByRole('button', { name: '连接QQ并生成绑定码' }).click();
  const clear = page.getByRole('button', { name: '清除QQ凭据重填' });
  await clear.click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as TestWindow).wechatFixture.requests.filter((path) =>
          path.endsWith('/:channel/binding'),
        ).length,
    ),
  ).toBe(0);
  await clear.click();
  await page.getByRole('button', { name: '解除绑定', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'QQ接入' })).toHaveCount(0);
  await page.getByRole('button', { name: 'QQ接入', exact: false }).click();
  await expect(page.getByPlaceholder('只在本页填写新密钥，不要发到聊天里')).toHaveValue('');
});
