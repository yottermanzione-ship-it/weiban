// 这里专门测新手引导的自动弹出，所以直接用 @playwright/test，不经过 fixtures.ts 里「引导默认已看过」的包装。
import { expect, test, type Page } from '@playwright/test';

/**
 * 新手引导触发条件（T-20261103 第 2 项）：真实页面、真实登录与真实服务器。
 * 会员档位只在网页这一侧用请求替身模拟（测试服务器里的账号都是免费用户）；不改服务器数据。
 */
const layer = (page: Page) => page.locator('.guided-tour-layer');

async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_guide');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

/** 等自动弹出的检查跑过几轮（每 250ms 一次，需连续两次稳定），确认没有弹出。 */
async function expectNoGuide(page: Page) {
  await page.waitForTimeout(1500);
  await expect(layer(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'PRO+ 已开通' })).toHaveCount(0);
}

function membership(tier: 'free' | 'pro_plus') {
  return {
    checkedAt: '2026-10-05T12:00:00.000Z',
    tier,
    expiresAt: tier === 'pro_plus' ? '2027-10-05T12:00:00.000Z' : null,
    updatedAt: '2026-10-05T12:00:00.000Z',
  };
}

async function openChat(page: Page) {
  await page.goto('/chat');
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
}

test('情景预设：第一次进入私聊页自动弹出，之后再进、刷新都不再弹', async ({ page }) => {
  await login(page);
  await expectNoGuide(page);
  await openChat(page);
  await expect(layer(page)).toHaveAttribute('data-tour-step', 'live-scenario-plus');
  await expect(page.locator('.guided-tour-card')).toContainText('情景预设');
  await page.getByRole('button', { name: '稍后再学，退出引导' }).click();
  await expect(layer(page)).toHaveCount(0);
  await openChat(page);
  await expectNoGuide(page);
  await page.reload();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  await expectNoGuide(page);
});

test('角色生态（老会员）：更新前就是会员，第一次进「服务」弹一次，之后不再弹', async ({ page }) => {
  await page.route(/\/me\/membership$/, (route) => route.fulfill({ json: membership('pro_plus') }));
  await login(page);
  // 从没看到过「免费」：不是新开通，不弹新会员说明框
  await expectNoGuide(page);
  await page.goto('/services');
  await expect(layer(page)).toHaveAttribute('data-tour-step', 'live-ecology-entry');
  await page.locator('[data-guide="ecology-entry"]').click();
  await expect(layer(page)).toHaveAttribute('data-tour-step', 'live-ecology-master');
  await page.getByRole('button', { name: '稍后再学，退出引导' }).click();
  await page.goto('/services');
  await expect(page.locator('[data-guide="ecology-entry"]')).toBeVisible();
  await expectNoGuide(page);
});

test('角色生态（新会员）：开通成功马上弹，弹过后进「服务」不再弹', async ({ page }) => {
  let tier: 'free' | 'pro_plus' = 'free';
  await page.route(/\/me\/membership$/, (route) => route.fulfill({ json: membership(tier) }));
  await login(page);
  // 先在这台设备上看到「免费」
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.entries(localStorage).find(([key]) =>
            key.startsWith('weiban:guided-tour:v1:'),
          )?.[1] ?? '',
      ),
    )
    .toContain('"tier":"free"');
  await expectNoGuide(page);
  // 后台开通会员后，余额 / 设置变化通知会让页面重新拉取会员档位
  tier = 'pro_plus';
  await page.evaluate(() => window.dispatchEvent(new Event('weiban:settings-updated')));
  const intro = page.getByRole('dialog', { name: 'PRO+ 已开通' });
  await expect(intro).toBeVisible();
  await intro.getByRole('button', { name: '以后再说', exact: true }).click();
  await expect(intro).toHaveCount(0);
  await page.goto('/services');
  await expect(page.locator('[data-guide="ecology-entry"]')).toBeVisible();
  await expectNoGuide(page);
});

test('角色生态：免费用户进「服务」不弹', async ({ page }) => {
  await page.route(/\/me\/membership$/, (route) => route.fulfill({ json: membership('free') }));
  await login(page);
  await page.goto('/services');
  await expect(page.locator('[data-guide="ecology-entry"]')).toBeVisible();
  await expectNoGuide(page);
});

test('小程序：第一次下拉打开小程序面板自动弹出，之后再下拉不再弹', async ({ page }) => {
  await login(page);
  await page.goto('/chat');
  // exact：引导卡片自己也是 dialog，标题里同样带「小程序」。
  const panel = page.getByRole('dialog', { name: '小程序', exact: true });
  async function pullOpen() {
    const head = await page.locator('.chat-list-head').boundingBox();
    if (!head) throw new Error('聊天列表标题栏不可见');
    await page.mouse.move(head.x + 24, head.y + head.height / 2);
    await page.mouse.down();
    await page.mouse.move(head.x + 24, head.y + 620, { steps: 20 });
    await page.mouse.up();
    await expect(panel).toBeVisible();
  }
  await expectNoGuide(page);
  await pullOpen();
  await expect(layer(page)).toHaveAttribute('data-tour-step', 'live-pull-grid');
  await expect(page.locator('.guided-tour-card')).toContainText('小程序');
  await page.getByRole('button', { name: '稍后再学，退出引导' }).click();
  await expect(layer(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await pullOpen();
  await expectNoGuide(page);
});
