import { expect, test } from '@playwright/test';
const fixture = '/test/browser-fixtures/batch-operations.html';
test('列表默认多选但不新增只读记录删除权限，勾选不会误开抽屉', async ({ page }) => {
  await page.goto(`${fixture}?readonly=1`);
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await page.getByRole('checkbox').nth(1).check();
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
  await expect(page.getByTestId('opened')).toHaveText('');
  await expect(page.getByRole('button', { name: /批量启用|批量停用|批量删除/ })).toHaveCount(0);
  await page.getByRole('checkbox').first().check();
  await expect(page.getByRole('checkbox').nth(2)).toBeChecked();
  await page.getByRole('checkbox').first().uncheck();
  await expect(page.getByRole('checkbox').nth(1)).not.toBeChecked();
  await page.getByText('记录A', { exact: true }).click();
  await expect(page.getByTestId('opened')).toHaveText('a');
});
test('批量操作只确认一次、顺序处理，失败项保留且不自动重试', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '批量停用', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('停用所选 2 项测试记录');
  expect(
    await page.evaluate(() => (window as unknown as { batchCalls: unknown[] }).batchCalls),
  ).toEqual([]);
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByTestId('selected')).toHaveText('b');
  await expect(page.getByRole('checkbox').nth(1)).not.toBeChecked();
  await expect(page.getByRole('checkbox').nth(2)).toBeChecked();
  await expect(page.getByText('部分记录未完成，未自动重试', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { batchCalls: unknown[] }).batchCalls),
  ).toEqual([
    { id: 'a', enabled: false },
    { id: 'b', enabled: false },
  ]);
});
