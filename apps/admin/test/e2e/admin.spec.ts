import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, username = 'browser_admin') {
  await page.goto('/');
  await page.getByLabel('管理员账号').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  if (username === 'browser_admin') await expect(page.locator('.admin-avatar')).toBeVisible();
}
async function records(page: Page) {
  return page.evaluate(
    () =>
      new Promise<IDBValidKey[]>((resolve) => {
        const open = indexedDB.open('weiban-admin', 1);
        open.onsuccess = () => {
          const request = open.result.transaction('records').objectStore('records').getAllKeys();
          request.onsuccess = () => {
            resolve(request.result);
            open.result.close();
          };
        };
      }),
  );
}
async function authorization(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('weiban-admin', 1);
        open.onsuccess = () => {
          const request = open.result.transaction('records').objectStore('records').get('session');
          request.onsuccess = () => {
            resolve(`Bearer ${request.result.session.token}`);
            open.result.close();
          };
        };
      }),
  );
}
async function picture(page: Page) {
  return {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#0aa35a';
        context.fillRect(0, 0, 32, 32);
        return canvas.toDataURL('image/png').split(',')[1]!;
      }),
      'base64',
    ),
  };
}
async function upload(page: Page, button: string) {
  const image = await picture(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: new RegExp(button + '$') }).click(),
  ]);
  await chooser.setFiles(image);
}
async function createUpstream(page: Page, name: string, secret: string) {
  await page.goto('/model?tab=upstreams');
  await page.getByRole('button', { name: /添加上游账号$/ }).click();
  await page.getByLabel('名称', { exact: true }).fill(name);
  await page.getByLabel('接口地址', { exact: true }).fill('http://127.0.0.1:3001/v1');
  await page.getByLabel('API 密钥', { exact: true }).fill(secret);
  await page.getByRole('button', { name: '测试并保存', exact: true }).click();
  await expect(page.getByText('连通正常，已保存', { exact: true })).toBeVisible();
}

test('真实管理员会话、邀请码停用和退出；后台不缓存管理数据', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  const headers = { Authorization: await authorization(page) };
  const invite = await page.request.post('/api/v1/admin/invites', {
    headers,
    data: { expiresInDays: 7 },
  });
  expect(invite.status()).toBe(503);
  const list = await page.request.get('/api/v1/admin/invites', { headers });
  expect(list.status()).toBe(200);
  expect((await list.json()).items).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  expect(await records(page)).toEqual(['session']);
  await page.locator('.admin-avatar').hover();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('普通用户不能登录后台', async ({ page }) => {
  await login(page, 'browser_user');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.admin-avatar')).toHaveCount(0);
});
test('日常照片真实上传保存，后台同域代理加载签名图片而不放宽CSP', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await login(page);
  await page.goto('/card-templates');
  await page.getByRole('button', { name: /新增模板$/ }).click();
  await page.getByLabel('名称', { exact: true }).fill('日常照片浏览器自测');
  await page.getByRole('checkbox', { name: '日常配图', exact: true }).check();
  await page.getByRole('switch', { name: '不含人物', exact: true }).check();
  await upload(page, '上传图片');
  await expect(page.getByRole('img', { name: '卡面预览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const image = page.getByRole('img', { name: '日常照片浏览器自测', exact: true });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  const imageUrl = new URL(await image.evaluate((element: HTMLImageElement) => element.src));
  expect(imageUrl.origin).toBe(new URL(page.url()).origin);
  expect(imageUrl.searchParams.has('token')).toBe(true);
  await page.reload();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
test('积分提交丢失响应后手动重试，不重复赠送', async ({ page }) => {
  await login(page);
  await page.goto('/accounts');
  await page.getByRole('row').filter({ hasText: 'browser_other' }).click();
  await page.getByRole('tab', { name: '积分', exact: true }).click();
  await page.getByRole('button', { name: '加 / 扣积分', exact: true }).click();
  await page.getByLabel('积分数', { exact: true }).fill('12.3456');
  await page.getByLabel('原因', { exact: true }).fill('浏览器幂等重试');
  let first = true;
  const keys: string[] = [];
  await page.route('**/admin/billing/accounts/*/adjustments', async (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (first) {
      first = false;
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: '确认加积分', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '确认加积分', exact: true }).click();
  await expect(page.getByText('已加 12.3456 积分', { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(page.getByRole('cell', { name: /浏览器幂等重试/ })).toHaveCount(1);
});
test('上游测试与密钥掩码；原始密钥不会存入后台数据缓存', async ({ page }) => {
  await login(page);
  const secret = 'sk-browser-secret-canary-123456';
  await createUpstream(page, '浏览器本机上游', secret);
  const row = page.getByRole('row').filter({ hasText: '浏览器本机上游' });
  await expect(row).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain(secret);
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(
    page.getByText('密钥保存后只显示末 4 位，不能再查看原文', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('API 密钥', { exact: true })).toHaveCount(0);
  const contents = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const open = indexedDB.open('weiban-admin', 1);
        open.onsuccess = () => {
          const request = open.result.transaction('records').objectStore('records').getAll();
          request.onsuccess = () => {
            resolve(request.result);
            open.result.close();
          };
        };
      }),
  );
  expect(JSON.stringify(contents)).not.toContain(secret);
});
test('角色结构化编辑、真实草稿保存、发布检测门禁和图片上传', async ({ page }) => {
  await login(page);
  await page.goto('/characters');
  await page.getByRole('button', { name: /新建角色$/ }).click();
  const field = (label: string) =>
    page
      .locator('.field-line')
      .filter({ has: page.locator('.field-label').filter({ hasText: new RegExp('^' + label) }) })
      .getByRole('textbox');
  await field('角色名字').fill('浏览器角色');
  await field('一句话介绍').fill('真实API草稿');
  await field('备用开场白').fill('你好呀');
  await field('人设摘要').fill('温柔的原创成年角色');
  await upload(page, '上传角色图片');
  await expect(page.getByText('已设置角色图片，保存后生效。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: '浏览器角色' });
  await expect(row.getByText('草稿', { exact: true })).toBeVisible();
  const publish = page.waitForResponse(
    (r) => r.url().endsWith('/publish') && r.request().method() === 'POST',
  );
  await row.getByRole('button', { name: '上架', exact: true }).click();
  expect((await publish).ok()).toBe(false);
  await expect(row.getByText('草稿', { exact: true })).toBeVisible();
  await page.reload();
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(field('人设摘要')).toHaveValue('温柔的原创成年角色');
  await expect(page.getByText('已设置角色图片，保存后生效。', { exact: true })).toBeVisible();
});
test('价目草稿精确微元、模型启用与缺价发布确认', async ({ page }) => {
  await login(page);
  await createUpstream(page, '价目测试上游', 'sk-price-test-key-123456');
  await page.goto('/model?tab=models');
  await page.getByRole('button', { name: /添加模型$/ }).click();
  await page
    .locator('.ant-select')
    .filter({ has: page.getByLabel('上游账号', { exact: true }) })
    .click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('价目测试上游', { exact: true })
    .click();
  await page.getByLabel('上游模型名', { exact: true }).fill('browser-test');
  await page.getByLabel('显示名', { exact: true }).fill('浏览器测试模型');
  await page.getByLabel('出品方（厂商）', { exact: true }).fill('Browser');
  await page.getByRole('checkbox', { name: '识图', exact: true }).check();
  await page.getByLabel('输入（元）', { exact: true }).fill('1.234567');
  await page.getByLabel('输出（元）', { exact: true }).fill('1.234567');
  const modelSaved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && /\/admin\/model\/models\//.test(r.url()),
  );
  await page.getByRole('button', { name: '保存并上架', exact: true }).click();
  const response = await modelSaved;
  expect(response.ok()).toBe(true);
  const model = await response.json();
  await expect(page.getByRole('row').filter({ hasText: '浏览器测试模型' })).toBeVisible();
  await page.goto('/prices');
  await page.getByRole('button', { name: /新建价格版本$/ }).click();
  await page.getByLabel('版本名称', { exact: true }).fill('浏览器价格');
  await page.locator('.price-edit-row').getByRole('combobox').first().fill(model.modelKey);
  await page.locator('.price-edit-row').getByRole('spinbutton').nth(0).fill('1.234567');
  await page.locator('.price-edit-row').getByRole('spinbutton').nth(1).fill('0.123456');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/price-versions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const price = await (await saved).json();
  expect(price.items[0].priceMicros).toBe(1234567);
  expect(price.items[0].costMicros).toBe(123456);
  const row = page.getByRole('row').filter({ hasText: '浏览器价格' });
  await row.getByRole('button', { name: '立即启用', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '立即启用', exact: true }).click();
  await expect(row.getByText('生效中', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /新建价格版本$/ }).click();
  await page.getByLabel('版本名称', { exact: true }).fill('缺模型测试');
  await page.locator('.price-edit-row').getByRole('combobox').first().fill('browser/other');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const missing = page.getByRole('row').filter({ hasText: '缺模型测试' });
  await missing.getByRole('button', { name: '立即启用', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('浏览器测试模型');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(missing.getByText('草稿', { exact: true })).toBeVisible();
  await missing.getByRole('button', { name: '立即启用', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '立即启用', exact: true }).click();
  await expect(missing.getByText('生效中', { exact: true })).toBeVisible();
});
test('真实提醒红点、分页、丢失处理响应后幂等重试；管理内容不落本机缓存', async ({ page }) => {
  await login(page);
  await page.goto('/admin/alerts');
  await expect(page.getByText('待处理（53）', { exact: true })).toBeVisible();
  const buttons = page.getByRole('button', { name: '标记已处理', exact: true });
  await expect(buttons).toHaveCount(20);
  await expect(page.getByText('共 50 条', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(page.getByText('共 53 条', { exact: true })).toBeVisible();
  let first = true;
  const ids: string[] = [];
  await page.route('**/admin/alerts/*/acknowledge', async (route) => {
    ids.push(route.request().url());
    if (first) {
      first = false;
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await buttons.first().click();
  await expect(page.getByRole('alert')).toBeVisible();
  // The live list may refresh after the server mutation despite the lost response.
  // Retry the exact acknowledged ID, never whatever row happens to be first now.
  expect(ids).toHaveLength(1);
  const repeated = await page.request.post(ids[0]!, {
    headers: { Authorization: await authorization(page) },
  });
  expect(repeated.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText('待处理（52）', { exact: true })).toBeVisible();
  await page.locator('.page-head-extra .ant-select').click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('全部（90 天）', { exact: true })
    .click();
  await expect(page.getByText('已处理', { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('待处理（52）', { exact: true })).toBeVisible();
  expect(await records(page)).toEqual(['session']);
});
