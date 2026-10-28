import { expect, test, type Page } from '@playwright/test';

const fixture = '/test/browser-fixtures/wechat-binding.html';
type FixtureWindow = Window & {
  wechatFixture: {
    copied: string;
    requests: string[];
    providerStatus(value: 'wait' | 'confirmed' | 'expired'): void;
  };
};

async function open(page: Page) {
  await page.goto(fixture);
  await page.getByRole('button', { name: '微信接入', exact: false }).click();
  await expect(page.getByRole('dialog', { name: '微信接入' })).toBeVisible();
}
async function create(page: Page) {
  await page.getByRole('button', { name: '测试角色 01', exact: true }).click();
  await page.getByRole('button', { name: '生成绑定二维码', exact: true }).click();
  await expect(page.getByRole('img', { name: '微信绑定二维码' })).toBeVisible();
}

test('340px 长名单角色不贴边，生成按钮与链接可见，点击打开不伪报已连接', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 766 });
  await open(page);
  const dialog = page.getByRole('dialog', { name: '微信接入' });
  const label = page
    .getByRole('button', { name: '测试角色 01', exact: true })
    .locator('.menu-label-text');
  const edge = (await dialog.boundingBox())!.x;
  expect((await label.boundingBox())!.x - edge).toBeGreaterThanOrEqual(16);
  const generate = page.getByRole('button', { name: '生成绑定二维码', exact: true });
  await expect(generate).toBeDisabled();
  await page.getByRole('button', { name: '测试角色 48', exact: true }).click();
  await expect(generate).toBeInViewport({ ratio: 1 });
  await generate.click();
  await expect(page.getByRole('img', { name: '微信绑定二维码' })).toBeInViewport({ ratio: 1 });
  const launch = page.getByRole('link', { name: '打开绑定链接' });
  await expect(launch).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '复制绑定链接' })).toBeInViewport({ ratio: 1 });
  const styles = await page
    .locator(
      '.wechat-bind-toolbar .channel-action-button, .wechat-bind-link-actions .channel-action-button',
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          color: style.color,
          background: style.backgroundColor,
          font: style.fontSize,
          weight: style.fontWeight,
        };
      }),
    );
  expect(styles).toHaveLength(3);
  expect(new Set(styles.map((style) => JSON.stringify(style))).size).toBe(1);
  expect(styles[0]!.background).not.toBe('rgb(7, 193, 96)');
  await page.screenshot({ path: '.ci-wechat-binding-340.png' });
  await page.getByRole('button', { name: '复制绑定链接' }).click();
  const original = await page.getByRole('textbox', { name: '微信绑定链接' }).inputValue();
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).wechatFixture.copied)).toBe(
    original,
  );
  await launch.evaluate((el) =>
    el.addEventListener('click', (event) => event.preventDefault(), { once: true }),
  );
  await launch.click();
  await expect(page.getByText('微信已连接', { exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).wechatFixture.providerStatus('confirmed'),
  );
  await expect(page.getByText('微信已连接', { exact: true })).toBeVisible();
});

test('320px 深色主题仍保留主操作，二维码过期后旧链接不再可点', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  await page.evaluate(() => {
    document.documentElement.dataset.scheme = 'dark';
  });
  await create(page);
  await expect(page.getByRole('button', { name: '重新生成二维码' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '复制绑定链接' })).toBeInViewport({ ratio: 1 });
  await page.evaluate(() =>
    (window as unknown as FixtureWindow).wechatFixture.providerStatus('expired'),
  );
  await expect(page.getByText('测试码已过期', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '微信绑定链接' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '打开绑定链接' })).toHaveCount(0);
});

test('剪贴板被拒绝时保留可选中的原链接，换角色不会继续展示旧角色二维码', async ({ page }) => {
  await open(page);
  await create(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      },
    });
    document.execCommand = () => false;
  });
  await page.getByRole('button', { name: '复制绑定链接' }).click();
  await expect(page.getByRole('status')).toContainText('手动复制');
  const field = page.getByRole('textbox', { name: '微信绑定链接' });
  expect(
    await field.evaluate(
      (el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '测试角色 02', exact: true }).click();
  await expect(page.getByRole('img', { name: '微信绑定二维码' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成绑定二维码' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByText('请先在旧版解绑', { exact: false })).toHaveCount(0);
});

test.describe('Android 浏览器', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
  });
  test('Intent 只交给微信，并保留官方原地址供复制与回退', async ({ page }) => {
    await open(page);
    await create(page);
    const launch = page.getByRole('link', { name: '尝试用微信打开' });
    const href = await launch.getAttribute('href');
    expect(href).toContain('package=com.tencent.mm;');
    expect(href).toContain('S.browser_fallback_url=https%3A%2F%2Fliteapp.weixin.qq.com');
    await page.getByRole('button', { name: '复制绑定链接' }).click();
    const copied = await page.evaluate(
      () => (window as unknown as FixtureWindow).wechatFixture.copied,
    );
    expect(copied).toMatch(/^https:\/\/liteapp\.weixin\.qq\.com\//);
    expect(copied).not.toContain('intent:');
  });
});

test.describe('微信内浏览器', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14) MicroMessenger/8.0.50' });
  test('直接打开原官方链接，不重复呼起微信', async ({ page }) => {
    await open(page);
    await create(page);
    await expect(page.getByRole('link', { name: '在微信内继续绑定' })).toHaveAttribute(
      'href',
      /^https:\/\/liteapp\.weixin\.qq\.com\//,
    );
  });
});

test('已绑定首屏能解除新站绑定，取消不调用接口，只有本人确认才解绑', async ({ page }) => {
  await page.setViewportSize({ width: 351, height: 755 });
  await page.goto(fixture + '?bound=1');
  await page.getByRole('button', { name: '微信接入', exact: false }).click();
  const unbind = page.getByRole('button', { name: '解除新站绑定', exact: true });
  await expect(unbind).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: '.ci-channel-bound-polish.png' });
  const calls = () =>
    page.evaluate(
      () =>
        (window as unknown as FixtureWindow).wechatFixture.requests.filter((path) =>
          path.endsWith('/:channel/binding'),
        ).length,
    );
  await unbind.click();
  await expect(page.getByText('只解除当前新站的微信连接', { exact: false })).toBeVisible();
  expect(await calls()).toBe(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await calls()).toBe(0);
  await unbind.click();
  await page.getByRole('button', { name: '解除绑定', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '微信接入' })).toHaveCount(0);
  expect(await calls()).toBe(1);
  await page.getByRole('button', { name: '微信接入', exact: false }).click();
  await expect(page.getByRole('button', { name: '生成绑定二维码' })).toBeVisible();
});

test('微博凭据、说明和 AppID 输入都有统一内边距，不发生横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 339, height: 755 });
  await page.goto(fixture + '?channel=weibo');
  await page.getByRole('button', { name: '微博接入', exact: false }).click();
  const dialog = page.getByRole('dialog', { name: '微博接入' });
  const box = (await dialog.boundingBox())!;
  for (const selector of [
    '.wx-auth-field--credentials > span',
    '.wx-auth-field--credentials textarea',
    '.wx-auth-fields .page-note',
    '.wx-auth-field > span',
  ]) {
    for (const item of await dialog.locator(selector).all()) {
      const current = (await item.boundingBox())!;
      expect(current.x - box.x).toBeGreaterThanOrEqual(16);
      expect(box.x + box.width - current.x - current.width).toBeGreaterThanOrEqual(16);
    }
  }
  const overflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: '.ci-channel-weibo-polish.png' });
});
