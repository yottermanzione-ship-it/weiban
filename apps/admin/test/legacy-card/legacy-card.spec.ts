import { expect, test, type Page } from '@playwright/test';

const FIXTURE = '/test/browser-fixtures/legacy-card.html';
const AVATAR_MEDIA = '01a16dd0-04d5-770f-acbb-3c94e4960a61';
const NEW_AVATAR = '01a16dd0-9999-7777-8888-000000000001';
/** 1×1 PNG：只用来证明图片真的加载了。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function mockMedia(page: Page, options: { broken?: boolean } = {}) {
  await page.route('**/api/v1/media/**', async (route) => {
    const url = route.request().url();
    if (options.broken && url.includes('token=broken'))
      return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
}

async function savedBodies(page: Page) {
  return page.evaluate(() => (window as unknown as { legacySaved: unknown[] }).legacySaved);
}

test('旧卡按旧字段渲染：不出现 WB-Card 缺项提示，头像真实加载，未识别字段只读', async ({
  page,
}) => {
  await mockMedia(page);
  await page.goto(FIXTURE);
  await expect(page.getByLabel(/角色名字/)).toHaveValue('吴云飞');
  await expect(page.getByLabel(/核心人设/)).toHaveValue('核心人设原文');
  await expect(page.getByLabel(/说话风格/)).toHaveValue('说话风格原文');
  // 旧卡不再落到 WB-Card 编辑器，也就没有「待完善 12 项」。
  await expect(page.getByText('待完善')).toHaveCount(0);
  await expect(page.getByText('人设卡（WB-Card 1.0）')).toHaveCount(0);
  const image = page.getByRole('img', { name: '吴云飞头像' });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute(
    'src',
    new RegExp(`^/api/v1/media/${AVATAR_MEDIA}/content\\?token=tok$`),
  );
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.getByText('raw_json').click();
  await expect(page.getByText('{"legacy":true}')).toBeVisible();
});

test('局部保存：只提交改动、清空走 clear、世界书与示例按 id，保存后读回', async ({ page }) => {
  await mockMedia(page);
  await page.goto(FIXTURE);
  await expect(page.getByLabel(/核心人设/)).toHaveValue('核心人设原文');
  await page.getByLabel(/核心人设/).fill('新的核心人设');
  await page.getByLabel(/昵称/).fill('');
  await page.getByLabel(/角色说/).fill('嗨呀');
  await page
    .getByRole('button', { name: /删\s*除/ })
    .first()
    .click();
  await page.locator('.ant-popconfirm .ant-btn-primary').click();
  await expect(page.getByText('世界书（0 条）')).toBeVisible();
  await page.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(page.getByLabel('保存结果')).toHaveText('已保存旧卡人设');

  const saved = await savedBodies(page);
  expect(saved).toHaveLength(1);
  const body = saved[0] as Record<string, unknown>;
  expect(body.expectedRevision).toBe(7);
  expect(body.fields).toEqual({ corePersona: '新的核心人设' });
  expect(body.clear).toEqual(['nickname']);
  expect(body.lorebook).toEqual({ delete: ['lb-1'] });
  expect(body.examples).toMatchObject({ upsert: [{ id: 'ex-1', sortOrder: 0 }] });

  // 保存后读回：表单显示服务端返回的新版本。
  await expect(page.getByLabel(/核心人设/)).toHaveValue('新的核心人设');
  await expect(page.getByLabel(/昵称/)).toHaveValue('');
  await expect(page.getByText('当前版本 v8')).toBeVisible();
  await expect(page.getByText('世界书（0 条）')).toBeVisible();
});

test('revision 冲突：返回 409 时明确提示并可读取最新内容，不假装保存成功', async ({ page }) => {
  await mockMedia(page);
  await page.goto(`${FIXTURE}?conflict=1`);
  await expect(page.getByLabel(/核心人设/)).toHaveValue('核心人设原文');
  await page.getByLabel(/核心人设/).fill('冲突保存');
  await page.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(page.getByRole('alert')).toContainText('角色已被其他人修改');
  await expect(page.getByRole('button', { name: '读取最新内容' })).toBeVisible();
  expect(await savedBodies(page)).toHaveLength(0);
  await expect(page.getByLabel('保存结果')).toHaveText('');
});

test('替换头像：上传后预览更新，保存带上 avatarMediaId 并读回', async ({ page }) => {
  await mockMedia(page);
  await page.goto(FIXTURE);
  const image = page.getByRole('img', { name: '吴云飞头像' });
  await expect(image).toHaveAttribute('src', /token=tok/);
  await page.setInputFiles('input[type=file]', {
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.getByRole('img', { name: '吴云飞头像' })).toHaveAttribute(
    'src',
    new RegExp(NEW_AVATAR),
  );
  await page.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect(page.getByLabel('保存结果')).toHaveText('已保存旧卡人设');
  const saved = await savedBodies(page);
  expect((saved[0] as Record<string, unknown>).avatarMediaId).toBe(NEW_AVATAR);
  await expect(page.getByRole('img', { name: '吴云飞头像' })).toHaveAttribute(
    'src',
    /\?token=new$/,
  );
});

test('头像地址失效时回退文字头像', async ({ page }) => {
  await mockMedia(page, { broken: true });
  await page.goto(`${FIXTURE}?broken=1`);
  await expect(page.getByRole('img', { name: '吴云飞头像' })).toHaveCount(0);
  await expect(page.locator('.legacy-avatar-fallback')).toHaveText('吴');
});
