import { expect, test, type Page } from '@playwright/test';

/** 情景弹层 + 聊天头部徽标的真实组件夹具（平台固定模型为夹具数据，不表示真实后端解析）。 */

const base = '/test/browser-fixtures/scenario-ui.html';
const fixture = (query = '') => `${base}${query ? `?${query}` : ''}`;

async function openSheet(page: Page) {
  await page.getByTestId('open-preset').click();
  const sheet = page.getByRole('dialog', { name: '情景预设' });
  await expect(sheet).toBeVisible();
  return sheet;
}

const updates = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { feedbackCalls: Array<{ body?: { scenarioMode?: string } }> }
    ).feedbackCalls
      .map((call) => call.body?.scenarioMode)
      .filter((mode): mode is string => !!mode),
  );

test('私密按普通模式展示；平台固定模型未提供时提示暂不可用，不再让用户选模型', async ({ page }) => {
  await page.goto(fixture());
  await expect(page.getByTestId('current-mode')).toHaveText('auto');
  const sheet = await openSheet(page);

  const privateRow = sheet.getByRole('button', { name: /私密模式/ });
  await expect(privateRow).toBeVisible();
  await expect(privateRow).toContainText('不可描述的情景');
  await expect(privateRow.locator('.icon-tile')).toHaveCount(1);
  await expect(sheet.locator('.menu-row .ink-brand')).toHaveCount(1);

  await privateRow.click();
  const dialog = page.getByRole('dialog', { name: '私密模式暂不可用' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('平台还没有配置固定的私密模型');
  await expect(dialog.getByRole('button', { name: '去选模型' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '知道了' }).click();
  await expect(page.getByTestId('current-mode')).toHaveText('auto');
  expect(await updates(page)).toEqual([]);

  const paths = await page.evaluate(() =>
    (window as unknown as { feedbackCalls: Array<{ path: string }> }).feedbackCalls.map(
      (call) => call.path,
    ),
  );
  expect(paths.some((path) => path.includes('/model/'))).toBe(false);
});

test('平台固定模型存在时确认框显示折后真实倍率；取消不改状态', async ({ page }) => {
  await page.goto(fixture('private=ready'));
  const sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /私密模式/ }).click();

  const dialog = page.getByRole('dialog', { name: '开启私密模式' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('平台私密模型');
  // displayMultiplier 已含折扣：接口给 0.60，不能再乘 discountRate 0.5 变成 0.30。
  await expect(dialog).toContainText('×0.60');
  await expect(dialog).toContainText('限时 5 折');
  await expect(dialog).toContainText('仅支持文字和图片');
  await expect(dialog.getByRole('button', { name: '去选模型' })).toHaveCount(0);
  await expect(dialog).not.toContainText('不会出现在朋友圈');
  await expect(dialog).not.toContainText('干净整理');

  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.getByTestId('current-mode')).toHaveText('auto');
  expect(await updates(page)).toEqual([]);
});

test('平台模型倍率读不到时如实说明，不显示假数字', async ({ page }) => {
  await page.goto(fixture('private=nomultiplier'));
  const sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /私密模式/ }).click();

  const dialog = page.getByRole('dialog', { name: '开启私密模式' });
  await expect(dialog).toContainText('平台私密模型');
  await expect(dialog).toContainText('倍率暂时读不到');
  await expect(dialog).not.toContainText('×');
  await dialog.getByRole('button', { name: '取消' }).click();
  expect(await updates(page)).toEqual([]);
});

test('确认进入私密；再点私密恢复上次日常；选普通模式真正退出私密', async ({ page }) => {
  await page.goto(fixture('private=ready'));
  let sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /日常聊天/ }).click();
  await expect(page.getByTestId('current-mode')).toHaveText('daily');

  sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /私密模式/ }).click();
  await page
    .getByRole('dialog', { name: '开启私密模式' })
    .getByRole('button', { name: '开启' })
    .click();
  await expect(page.getByTestId('current-mode')).toHaveText('adult');

  sheet = await openSheet(page);
  const selectedPrivate = sheet.getByRole('button', { name: /私密模式/ });
  await expect(selectedPrivate.locator('.ink-brand')).toHaveCount(1);
  await expect(sheet.locator('.menu-row .ink-brand')).toHaveCount(1);
  await selectedPrivate.click();
  await expect(page.getByTestId('current-mode')).toHaveText('daily');

  // 再从日常进入私密，然后点一个普通模式：走真实 PATCH，服务端据此切回普通内容范围。
  sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /私密模式/ }).click();
  await page
    .getByRole('dialog', { name: '开启私密模式' })
    .getByRole('button', { name: '开启' })
    .click();
  await expect(page.getByTestId('current-mode')).toHaveText('adult');
  sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /傲娇斗嘴/ }).click();
  await expect(page.getByTestId('current-mode')).toHaveText('tsundere');

  expect(await updates(page)).toEqual(['daily', 'adult', 'daily', 'adult', 'tsundere']);
});

test('重复点当前普通模式不保存；开关持久化并驱动头部徽标与布局', async ({ page }) => {
  await page.goto(fixture('private=ready'));
  let sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /自动/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('current-mode')).toHaveText('auto');
  expect(await updates(page)).toEqual([]);

  sheet = await openSheet(page);
  const toggle = sheet.getByRole('switch', { name: '显示情景模式' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '关闭' }).click();

  const badge = page.locator('.scenario-mode-badge');
  await expect(badge).toHaveText('自动');

  sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /日常聊天/ }).click();
  await expect(badge).toHaveText('日常');

  const name = page.locator('.wx-chat-name');
  expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const badgeBox = await badge.boundingBox();
  const moreBox = await page.getByLabel('聊天信息').boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(moreBox).not.toBeNull();
  expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(moreBox!.x);

  await page.getByTestId('toggle-typing').click();
  await expect(page.locator('.wx-chat-title h1')).toHaveText('对方正在输入...');
  await expect(badge).toHaveCount(0);
  await page.getByTestId('toggle-typing').click();
  await expect(badge).toHaveText('日常');

  await page.reload();
  await expect(page.locator('.scenario-mode-badge')).toHaveText('自动');
  sheet = await openSheet(page);
  await expect(sheet.getByRole('switch', { name: '显示情景模式' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(await page.evaluate(() => Object.keys(localStorage))).toContain(
    'weiban:scenario-badge:anon',
  );
});

test('旧私密状态在平台模型不可用时仍能退出，但不能再次开启', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('weiban:scenario-badge:anon', 'on'));
  await page.goto(fixture('mode=adult&last=daily'));
  await expect(page.locator('.scenario-mode-badge')).toHaveText('私密');

  let sheet = await openSheet(page);
  const selectedPrivate = sheet.getByRole('button', { name: /私密模式/ });
  await expect(selectedPrivate.locator('.ink-brand')).toHaveCount(1);
  await selectedPrivate.click();
  await expect(page.getByTestId('current-mode')).toHaveText('daily');
  await expect(page.locator('.scenario-mode-badge')).toHaveText('日常');
  expect(await updates(page)).toEqual(['daily']);

  sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /私密模式/ }).click();
  await expect(page.getByRole('dialog', { name: '私密模式暂不可用' })).toBeVisible();
  expect(await updates(page)).toEqual(['daily']);
  await expect(page.getByTestId('current-mode')).toHaveText('daily');
});

test('显示开关与上次普通模式按账号、会话隔离', async ({ page }) => {
  await page.goto(fixture());
  const result = await page.evaluate(() => {
    const scenarioFixture = (
      window as unknown as {
        scenarioFixture: {
          setBadgeFor(userId: string, visible: boolean): void;
          getBadgeFor(userId: string): boolean;
          rememberLastNormal(userId: string, target: string, mode: string): void;
          getLastNormal(userId: string, target: string): string | null;
        };
      }
    ).scenarioFixture;
    scenarioFixture.setBadgeFor('user-a', true);
    scenarioFixture.setBadgeFor('user-b', false);
    scenarioFixture.rememberLastNormal('user-a', 'character:a', 'tsundere');
    scenarioFixture.rememberLastNormal('user-b', 'character:a', 'cheer');
    scenarioFixture.rememberLastNormal('user-a', 'character:b', 'daily');
    return {
      badgeA: scenarioFixture.getBadgeFor('user-a'),
      badgeB: scenarioFixture.getBadgeFor('user-b'),
      lastA: scenarioFixture.getLastNormal('user-a', 'character:a'),
      lastB: scenarioFixture.getLastNormal('user-b', 'character:a'),
      otherTarget: scenarioFixture.getLastNormal('user-a', 'character:b'),
    };
  });
  expect(result).toEqual({
    badgeA: true,
    badgeB: false,
    lastA: 'tsundere',
    lastB: 'cheer',
    otherTarget: 'daily',
  });
});

test('真实 private-model 倍率不重复折扣；available=false / model:null 均不能进入', async ({
  page,
}) => {
  await page.goto(fixture('source=api&api=available'));
  let sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /私密模式/ }).click();
  let dialog = page.getByRole('dialog', { name: '开启私密模式' });
  // 接口给 displayMultiplier=0.60（已含 5 折），不能再乘 discountRate 变成 0.30。
  await expect(dialog).toContainText('×0.60');
  await expect(dialog).not.toContainText('×0.30');
  await expect(dialog).toContainText('限时 5 折');
  const paths = await page.evaluate(() =>
    (window as unknown as { feedbackCalls: Array<{ path: string }> }).feedbackCalls.map(
      (call) => call.path,
    ),
  );
  expect(paths).toContain('/api/v1/model/private-model');
  await dialog.getByRole('button', { name: '取消' }).click();

  await page.goto(fixture('source=api&api=unavailable'));
  sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /私密模式/ }).click();
  dialog = page.getByRole('dialog', { name: '私密模式暂不可用' });
  await expect(dialog).toContainText('平台固定的私密模型暂时不可用');
  expect(await updates(page)).toEqual([]);
  await dialog.getByRole('button', { name: '知道了' }).click();

  await page.goto(fixture('source=api&api=none'));
  sheet = await openSheet(page);
  await sheet.getByRole('button', { name: /私密模式/ }).click();
  dialog = page.getByRole('dialog', { name: '私密模式暂不可用' });
  await expect(dialog).toContainText('平台还没有配置固定的私密模型');
  expect(await updates(page)).toEqual([]);
});
