import { expect } from '@playwright/test';
import { test } from '../../../../apps/web/test/e2e/fixtures.js';
import { loginUser } from '../../../../apps/web/test/e2e/persona-ui.js';
test('真实站内联想、非空结果及联网入口可见，不调用外部搜索', async ({ page }) => {
  await loginUser(page);
  await page.goto('/contacts/add');
  const input = page.getByRole('searchbox', { name: '搜索角色', exact: true });
  await input.fill('测试陪');
  await expect(page.locator('[aria-label="站内联想"]')).toContainText('测试陪伴角色');
  await input.press('Enter');
  await expect(page.getByText('测试陪伴角色', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('没有你要找的？可以查找公开人物或作品（同名的另一位也能找）'),
  ).toBeVisible();
});
