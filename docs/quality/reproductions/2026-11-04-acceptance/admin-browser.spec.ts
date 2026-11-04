import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function login(page: Page) {
  // 只复用原浏览器夹具的合成管理员；不复制凭据到质量文档。
  const source = await readFile(
    new URL('../../../../apps/admin/test/e2e/admin.spec.ts', import.meta.url),
    'utf8',
  );
  const password = source.match(/getByLabel\('密码', \{ exact: true \}\)\.fill\('([^']+)'\)/)?.[1];
  if (!password) throw new Error('Synthetic browser fixture changed');
  await page.goto('/');
  await page.getByLabel('管理员账号').fill('browser_admin');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.admin-avatar')).toBeVisible();
}

test('当前用户抽屉从甲切乙后，积分请求只指向乙', async ({ page }) => {
  await login(page);
  await page.goto('/accounts');
  await page.getByRole('row').filter({ hasText: 'browser_other' }).click();
  const a = await page.locator('.detail-grid .mono').innerText();
  await page.locator('.ant-drawer-close').last().click();
  await page.getByRole('row').filter({ hasText: 'browser_user' }).click();
  const b = await page.locator('.detail-grid .mono').innerText();
  expect(a).not.toBe(b);
  await page.getByRole('tab', { name: '积分', exact: true }).click();
  await page.getByRole('button', { name: '加 / 扣积分', exact: true }).click();
  await page.getByLabel('积分数', { exact: true }).fill('1');
  await page.getByLabel('原因', { exact: true }).fill('合成目标切换检查');
  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes('/adjustments'),
  );
  await page.getByRole('button', { name: '确认加积分', exact: true }).click();
  expect((await request).url()).toContain(`/accounts/${b}/adjustments`);
  await expect(page.getByText('已加 1 积分', { exact: true })).toBeVisible();
});

test('新增情景模式应能保存：原 Q-014 现行页面复核', async ({ page }) => {
  await login(page);
  await page.goto('/scenario-modes');
  await page.getByRole('button', { name: /新增情景模式$/ }).click();
  await page.getByLabel('名称', { exact: true }).fill('合成质量情景');
  await page.getByLabel('说明', { exact: true }).fill('仅本地合成数据');
  const pending = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/admin/scenario-modes'),
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const response = await pending;
  const body = response.request().postDataJSON() as Record<string, unknown>;
  const headers = await response.request().allHeaders();
  const control = await page.request.post('/api/v1/admin/scenario-modes', {
    headers: { Authorization: headers.authorization! },
    data: { ...body, id: 'qa_scenario_control' },
  });
  expect(control.status()).toBe(201);
  console.info(
    'QA_SCENARIO',
    JSON.stringify({
      status: response.status(),
      hasId: typeof body.id === 'string',
      withIdStatus: control.status(),
    }),
  );
  expect(response.status()).toBe(201);
});
