import { expect, test } from '@playwright/test';
const url = '/test/browser-fixtures/service-model.html';
test('曾误配 token 零价的旧搜索服务编辑时也自动进入按次模式', async ({ page }) => {
  await page.goto(`${url}?legacy=1`);
  await expect(page.getByLabel('输入（元）', { exact: true })).toBeHidden();
  await expect(page.getByLabel('上下文长度（token）')).toHaveCount(0);
  await page.getByLabel('售价（元 / 该单位）').fill('0.005');
  await page.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(page.getByLabel('保存数据')).not.toBeEmpty();
  const body = JSON.parse((await page.getByLabel('保存数据').textContent())!);
  expect(body.rates).toBeNull();
  expect(body.serviceRates).toEqual([{ unit: 'search_call', price: 0.005, cost: null }]);
  expect(body.routes[0].billingBounds.text).toBeUndefined();
  expect(body.routes[0].billingBounds.search.billableCalls).toBe(1);
});
test('DeepSeek 按成功次数填价格，不要求 token 参数或 JSON，保存符合真实契约', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.getByText('搜索按成功请求次数计费，不按输入/输出 token 计价。')).toBeVisible();
  await expect(page.getByLabel('上下文长度（token）')).toHaveCount(0);
  await expect(page.getByLabel('输入（元）', { exact: true })).toBeHidden();
  await page.getByLabel('单次最多返回条数').fill('3');
  await page.getByLabel('售价（元 / 该单位）').fill('0.005');
  await page.getByRole('button', { name: '保存并上架', exact: true }).click();
  await expect(page.getByLabel('保存数据')).not.toBeEmpty();
  const body = JSON.parse((await page.getByLabel('保存数据').textContent())!);
  expect(body.rates).toBeNull();
  expect(body.serviceRates).toEqual([{ unit: 'search_call', price: 0.005, cost: null }]);
  expect(body.billingBounds.search).toEqual({ maxResults: 3, billableCalls: 1 });
  expect(body.billingBounds.text).toBeUndefined();
  expect(body.capabilities).toEqual(['web_search']);
  expect(body.scenarios).toEqual([]);
  expect(body.routes[0].upstreamModelId).toBe('deepseek-search');
  expect(errors).toEqual([]);
  await page.screenshot({
    path: 'apps/admin/test-results/service-model-search.png',
    fullPage: true,
  });
});
test('免费须显式填零，重复单位不得保存', async ({ page }) => {
  await page.goto(url);
  await page.getByRole('button', { name: '保存并上架', exact: true }).click();
  await expect(page.locator('#serviceRates_0_price_help')).toContainText(
    '填写非负单价；免费请明确填 0',
  );
  await page.getByLabel('售价（元 / 该单位）').fill('0');
  await page.getByRole('button', { name: /添加服务单价/ }).click();
  await page.getByLabel('售价（元 / 该单位）').nth(1).fill('0.005');
  await page.getByRole('button', { name: '保存并上架', exact: true }).click();
  await expect(page.getByText('同一个计费单位只填一次').first()).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { serviceSaved: unknown[] }).serviceSaved.length,
    ),
  ).toBe(0);
});
