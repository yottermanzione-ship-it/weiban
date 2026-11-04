import { expect, test, type Page } from '@playwright/test';
const fixture = '/test/browser-fixtures/legacy-card.html';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/media/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  );
});
const saved = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { legacySaved: Array<Record<string, unknown>> }).legacySaved,
  );
test('当前分区入口：正文与昵称的局部修改、清空和读回', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: '人设正文', exact: true }).click();
  await expect(page.getByLabel('说话风格', { exact: true })).toHaveValue('说话风格原文');
  await page.getByLabel('核心人设', { exact: true }).fill('合成新正文');
  await page.getByRole('button', { name: '角色管理首页', exact: true }).click();
  await page.getByRole('textbox', { name: '昵称 留空 = 清空', exact: true }).fill('');
  await page.getByRole('button', { name: '保存角色资料', exact: true }).click();
  await expect(page.getByLabel('保存结果')).toHaveText('已保存角色资料');
  const bodies = await saved(page);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    expectedRevision: 7,
    fields: { corePersona: '合成新正文' },
    clear: ['nickname'],
  });
  expect(Object.keys(bodies[0]!.fields as object)).toEqual(['corePersona']);
  await page.getByRole('button', { name: '人设正文', exact: true }).click();
  await expect(page.getByLabel('核心人设', { exact: true })).toHaveValue('合成新正文');
});
test('冲突拒绝保存，读取最新内容后恢复原正文', async ({ page }) => {
  await page.goto(fixture + '?conflict=1');
  await page.getByRole('button', { name: '人设正文', exact: true }).click();
  await page.getByLabel('核心人设', { exact: true }).fill('合成冲突');
  await page.getByRole('button', { name: '保存角色资料', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('角色已被其他人修改');
  expect(await saved(page)).toHaveLength(0);
  await page.getByRole('button', { name: '读取最新内容', exact: true }).click();
  await expect(page.getByLabel('核心人设', { exact: true })).toHaveValue('核心人设原文');
});
test('当前保存入口：替换头像后按媒体编号保存并读回', async ({ page }) => {
  await page.goto(fixture);
  await page.setInputFiles('input[type=file]', {
    name: 'qa.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.getByRole('button', { name: '保存角色资料', exact: true }).click();
  await expect(page.getByLabel('保存结果')).toHaveText('已保存角色资料');
  expect((await saved(page))[0]).toHaveProperty(
    'avatarMediaId',
    '01a16dd0-9999-7777-8888-000000000001',
  );
  await expect(page.getByRole('img', { name: /头像$/ })).toHaveAttribute('src', /token=new$/);
});
