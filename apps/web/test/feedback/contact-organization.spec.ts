import { expect, test, type Page } from '@playwright/test';
const base = '/test/browser-fixtures/contact-organization.html';
const B = '44444444-4444-4444-8444-444444444444',
  REMOVED = '99999999-9999-4999-8999-999999999999';
type Fixture = {
  events: Array<{
    type: string;
    clientCommandId?: string;
    expectedRevision?: number;
    starredCharacterIds?: string[];
    tags?: Array<{ name: string; characterIds: string[] }>;
  }>;
  cloud(): { starredCharacterIds: string[]; tags: Array<{ name: string; characterIds: string[] }> };
  remote(): void;
  switchAccount(): Promise<void>;
  logout(): Promise<void>;
  release(): void;
};
const events = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { organizationFixture?: Fixture }).organizationFixture?.events ?? [],
  );
const cloud = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { organizationFixture: Fixture }).organizationFixture.cloud(),
  );
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')
      ? route.abort()
      : route.continue();
  });
});
test('phone UI creates, renames, changes members and deletes one tag without changing stars or another tag', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole('button', { name: '新建标签', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '新建标签', exact: true }).click();
  let editor = page.getByRole('dialog', { name: '新建标签', exact: true });
  await editor.getByRole('textbox', { name: '标签名称' }).fill('周末故事');
  await editor.getByRole('checkbox', { name: '林间来信', exact: true }).check();
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: /周末故事/ })).toBeVisible();
  await page.getByRole('button', { name: /周末故事/ }).click();
  editor = page.getByRole('dialog', { name: '编辑标签', exact: true });
  await editor.getByRole('textbox', { name: '标签名称' }).fill('旅行伙伴');
  await editor.getByRole('checkbox', { name: '林间来信', exact: true }).uncheck();
  await editor.getByRole('checkbox', { name: '岛屿笔记', exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('organization-phone.png'),
    fullPage: false,
  });
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  let data = await cloud(page);
  expect(data.tags.find((tag) => tag.name === '旅行伙伴')?.characterIds).toHaveLength(1);
  expect(data.tags.find((tag) => tag.name === '日常聊聊')?.characterIds).toHaveLength(2);
  expect(data.starredCharacterIds).toHaveLength(1);
  await page.getByRole('button', { name: /旅行伙伴/ }).click();
  await page.getByRole('button', { name: '删除这个标签', exact: true }).click();
  await page.getByRole('button', { name: '删除标签', exact: true }).click();
  await expect(page.getByRole('button', { name: /旅行伙伴/ })).toHaveCount(0);
  data = await cloud(page);
  expect(data.tags.map((tag) => tag.name)).toEqual(['日常聊聊']);
});
test('cloud update broadcasts refresh existing useStars consumers and quick toggle preserves tags', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByTestId('stars-probe')).toContainText('岚溪');
  await page.evaluate(() =>
    (window as unknown as { organizationFixture: Fixture }).organizationFixture.remote(),
  );
  await expect(page.getByTestId('stars-probe')).toContainText('岛屿笔记');
  await page.getByRole('button', { name: '切换林间星标' }).click();
  await expect(page.getByTestId('stars-probe')).toContainText('林间来信');
  expect((await cloud(page)).tags[0]?.name).toBe('日常聊聊');
});
test('409 keeps the edited tag and requires confirmation; newly arrived other tags are preserved', async ({
  page,
}) => {
  await page.goto(`${base}?fail=conflict`);
  await page.getByRole('button', { name: /日常聊聊/ }).click();
  const editor = page.getByRole('dialog', { name: '编辑标签', exact: true });
  await editor.getByRole('textbox', { name: '标签名称' }).fill('我的新名称');
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await expect(editor.getByText(/云端已有新的修改/)).toBeVisible();
  await expect(editor.getByRole('textbox', { name: '标签名称' })).toHaveValue('我的新名称');
  expect((await events(page)).filter((event) => event.type === 'save')).toHaveLength(1);
  await editor.getByRole('button', { name: '确认保存这次修改' }).click();
  await expect(page.getByRole('button', { name: /我的新名称/ })).toBeVisible();
  expect((await cloud(page)).tags.map((tag) => tag.name)).toEqual(['我的新名称', '另一台设备']);
});
test('uncertain network result retries exactly one command without dropping other tags', async ({
  page,
}) => {
  await page.goto(`${base}?fail=lost`);
  await page.getByRole('button', { name: '切换林间星标' }).click();
  await expect(page.getByText('保存结果暂未确认，请重试同一项保存。')).toBeVisible();
  await page.getByRole('button', { name: '重试这次保存' }).click();
  await expect(page.getByTestId('stars-probe')).toContainText('林间来信');
  const saves = (await events(page)).filter((event) => event.type === 'save');
  expect(saves).toHaveLength(2);
  expect(saves[1]).toEqual(saves[0]);
  expect((await cloud(page)).tags).toHaveLength(1);
});
test('unowned device stars require explicit account claim; cancel preserves cloud and original, confirmation replaces only stars', async ({
  page,
}) => {
  const raw = JSON.stringify([B, REMOVED]);
  await page.addInitScript(
    (value) => localStorage.setItem('weiban:starred-characters', value),
    raw,
  );
  await page.goto(base);
  await expect(page.getByTestId('stars-probe')).toContainText('岚溪');
  expect((await events(page)).some((event) => event.type === 'save')).toBe(false);
  await page.getByText('此设备有旧星标记录', { exact: true }).click();
  await page.getByRole('button', { name: '查看并确认归属' }).click();
  let dialog = page.getByRole('dialog', { name: '确认旧星标归当前账号？' });
  await expect(dialog).toContainText('1 条记录不可用');
  await expect(dialog).toContainText('synthetic_one');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await cloud(page)).starredCharacterIds).not.toEqual([B]);
  await page.getByRole('button', { name: '查看并确认归属' }).click();
  dialog = page.getByRole('dialog', { name: '确认旧星标归当前账号？' });
  await dialog.getByRole('button', { name: '覆盖云端星标' }).click();
  await expect(page.getByTestId('stars-probe')).toContainText('林间来信');
  expect((await cloud(page)).starredCharacterIds).toEqual([B]);
  expect((await cloud(page)).tags).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('weiban:starred-characters'))).toBe(raw);
});
test('owner changes discard late read/write results and never reuse pending commands for another account', async ({
  page,
}) => {
  await page.goto(`${base}?hold=get`);
  await expect
    .poll(async () => (await events(page)).some((event) => event.type === 'get'))
    .toBe(true);
  await page.evaluate(() =>
    (window as unknown as { organizationFixture: Fixture }).organizationFixture.switchAccount(),
  );
  await page.evaluate(() =>
    (window as unknown as { organizationFixture: Fixture }).organizationFixture.release(),
  );
  await expect(page.getByTestId('stars-probe')).toContainText('暂无');
  await expect(page.getByRole('button', { name: /日常聊聊/ })).toHaveCount(0);
  await page.goto(`${base}?hold=save`);
  await page.getByRole('button', { name: '切换林间星标' }).click();
  await expect
    .poll(async () => (await events(page)).some((event) => event.type === 'save'))
    .toBe(true);
  await page.evaluate(() =>
    (window as unknown as { organizationFixture: Fixture }).organizationFixture.switchAccount(),
  );
  await page.evaluate(() =>
    (window as unknown as { organizationFixture: Fixture }).organizationFixture.release(),
  );
  await expect(page.getByTestId('stars-probe')).toContainText('暂无');
  await expect(page.getByText('已保存并同步')).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { organizationFixture: Fixture }).organizationFixture.logout(),
  );
  await expect(page.getByText('请登录后管理自己的标签与星标。')).toBeVisible();
});
test('a cloud change while the old-device ownership confirmation is open requires another explicit confirmation', async ({
  page,
}) => {
  await page.addInitScript(
    (value) => localStorage.setItem('weiban:starred-characters', value),
    JSON.stringify([B]),
  );
  await page.goto(base);
  await expect(page.getByRole('button', { name: '新建标签', exact: true })).toBeEnabled();
  await page.getByText('此设备有旧星标记录', { exact: true }).click();
  await page.getByRole('button', { name: '查看并确认归属' }).click();
  const dialog = page.getByRole('dialog', { name: '确认旧星标归当前账号？' });
  await expect(dialog).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { organizationFixture: Fixture }).organizationFixture.remote(),
  );
  await expect(page.getByTestId('stars-probe')).toContainText('岛屿笔记');
  await dialog.getByRole('button', { name: '覆盖云端星标' }).click();
  await expect(page.getByText(/云端已有新的修改/)).toBeVisible();
  expect((await events(page)).some((event) => event.type === 'save')).toBe(false);
  await page.getByRole('button', { name: '确认保存这次修改' }).click();
  await expect(page.getByTestId('stars-probe')).toContainText('林间来信');
  expect((await cloud(page)).starredCharacterIds).toEqual([B]);
});

test('unsupported server is retryable and never writes an empty organization', async ({ page }) => {
  await page.goto(`${base}?unsupported=1`);
  await expect(page.getByText('星标和标签暂未同步，请稍后重试。')).toBeVisible();
  await expect(page.getByRole('button', { name: '新建标签', exact: true })).toBeDisabled();
  expect((await events(page)).some((event) => event.type === 'save')).toBe(false);
});
