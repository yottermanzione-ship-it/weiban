import { expect, test, type Page } from '@playwright/test';
const base = '/test/browser-fixtures/legacy-personas.html';
type Fixture = {
  events: Array<{ type: string; clientCommandId?: string; expectedVersion?: number }>;
  switchAccount(): Promise<void>;
  logout(): Promise<void>;
  release(): void;
};
const events = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { legacyPersonaFixture?: Fixture }).legacyPersonaFixture?.events ?? [],
  );
const confirm = async (page: Page) => {
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('聊天记录、记忆和积分不受影响');
  await expect(dialog).toContainText('不能在这里撤销');
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
};
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')
      ? route.abort()
      : route.continue();
  });
});
test('phone page renders every safe text section, escapes markup and stays within the viewport', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByText('正在生效', { exact: true })).toBeVisible();
  for (const title of [
    '性格与相处',
    '说话方式',
    '我们的关系',
    '一起聊天时',
    '记在心里的故事',
    '对话示例',
  ])
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(
    page.getByText('<img src="https://outside.invalid/private" onerror="window.personaXss=true">', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/长句开始.*长句结束/)).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { personaXss?: boolean }).personaXss),
  ).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('legacy-persona-phone.png'),
    fullPage: true,
  });
});
test('network ambiguity retries the same reset command then hides cleared content', async ({
  page,
}) => {
  await page.goto(`${base}?fail=lost`);
  await confirm(page);
  await expect(page.getByText(/请求结果暂未确认/)).toBeVisible();
  await page.getByRole('button', { name: '重试恢复默认' }).click();
  await expect(page.getByText('已恢复默认', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '性格与相处' })).toHaveCount(0);
  const calls = (await events(page)).filter((item) => item.type === 'reset');
  expect(calls).toHaveLength(2);
  expect(calls[1]?.clientCommandId).toBe(calls[0]?.clientCommandId);
  expect(calls.map((item) => item.expectedVersion)).toEqual([3, 3]);
});
test('409 rereads and asks for a fresh confirmation, without automatically repeating the destructive command', async ({
  page,
}) => {
  await page.goto(`${base}?fail=conflict`);
  await confirm(page);
  await expect(page.getByText(/这份设定已更新，已重新读取/)).toBeVisible();
  expect((await events(page)).filter((item) => item.type === 'reset')).toHaveLength(1);
  await confirm(page);
  const calls = (await events(page)).filter((item) => item.type === 'reset');
  expect(calls.map((item) => item.expectedVersion)).toEqual([3, 4]);
  expect(calls[0]?.clientCommandId).not.toBe(calls[1]?.clientCommandId);
});
test('account switch discards late read data and logout clears already-visible sensitive sections', async ({
  page,
}) => {
  await page.goto(`${base}?hold=get`);
  await expect
    .poll(async () => (await events(page)).some((item) => item.type === 'get'))
    .toBe(true);
  await page.evaluate(() =>
    (window as unknown as { legacyPersonaFixture: Fixture }).legacyPersonaFixture.switchAccount(),
  );
  await page.evaluate(() =>
    (window as unknown as { legacyPersonaFixture: Fixture }).legacyPersonaFixture.release(),
  );
  await expect(page.getByRole('heading', { name: '林间来信' })).toHaveCount(0);
  await expect(page.getByText('当前没有可查看的旧版设定。')).toBeVisible();
  await page.goto(base);
  await expect(page.getByRole('heading', { name: '林间来信' })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { legacyPersonaFixture: Fixture }).legacyPersonaFixture.logout(),
  );
  await expect(page.getByText('请登录后查看自己的旧版设定。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '性格与相处' })).toHaveCount(0);
});
test('a late reset response cannot overwrite the next account page or display a success toast', async ({
  page,
}) => {
  await page.goto(`${base}?hold=reset`);
  await confirm(page);
  await expect
    .poll(async () => (await events(page)).some((item) => item.type === 'reset'))
    .toBe(true);
  await page.evaluate(() =>
    (window as unknown as { legacyPersonaFixture: Fixture }).legacyPersonaFixture.switchAccount(),
  );
  await page.evaluate(() =>
    (window as unknown as { legacyPersonaFixture: Fixture }).legacyPersonaFixture.release(),
  );
  await expect(page.getByText('当前没有可查看的旧版设定。')).toBeVisible();
  await expect(page.getByText('已恢复默认', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('list/conditional entries expose only actual records; blocked content is never called active', async ({
  page,
}) => {
  await page.goto(`${base}?page=list`);
  await expect(page.getByRole('link', { name: /林间来信/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /岛屿笔记.*已保留但未生效/ })).toBeVisible();
  await page.getByRole('link', { name: /岛屿笔记/ }).click();
  await expect(page.getByText('已保留但未生效', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复默认', exact: true })).toHaveCount(0);
  await page.goto(`${base}?page=entry`);
  await expect(page.getByRole('link', { name: /我的旧版设定/ })).toHaveCount(2);
  await page.goto(`${base}?page=entry&empty=1`);
  await expect(page.getByRole('link', { name: /我的旧版设定/ })).toHaveCount(0);
  await page.goto(`${base}?page=entry&unsupported=1`);
  await expect(page.getByText('既有设置仍可使用')).toBeVisible();
  await expect(page.getByRole('link', { name: /我的旧版设定/ })).toHaveCount(0);
});
test('unknown 403/404 responses remain retryable without claiming lost data or showing server internals', async ({
  page,
}) => {
  for (const status of [403, 404]) {
    await page.goto(`${base}?status=${status}`);
    await expect(page.getByText('暂时无法读取这份旧版设定，请稍后重试。')).toBeVisible();
    await expect(page.getByRole('button', { name: '重试读取' })).toBeVisible();
    await expect(page.getByText(/private-should-not-render|数据丢失/)).toHaveCount(0);
  }
});
