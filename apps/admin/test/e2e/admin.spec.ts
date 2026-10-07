import { expect, test, type Page } from '@playwright/test';
async function login(page: Page, username = 'browser_admin') {
  await page.goto('/');
  await page.getByLabel('管理员账号').fill(username);
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
}
test('真实管理员会话、邀请码和退出；后台不缓存管理数据', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await expect(page.getByRole('navigation', { name: '管理导航' })).toBeVisible();
  await page.getByLabel('注册赠送余额（元）').fill('2.000001');
  const request = page.waitForResponse(
    (r) => r.url().endsWith('/admin/invites') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '生成邀请码' }).click();
  const invite = await (await request).json();
  expect(invite.bonusMicros).toBe(2000001);
  await expect(page.getByRole('cell', { name: invite.code, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '邀请码', exact: true })).toBeVisible();
  const records = await page.evaluate(
    () =>
      new Promise<IDBValidKey[]>((resolve) => {
        const r = indexedDB.open('weiban-admin', 1);
        r.onsuccess = () => {
          const q = r.result.transaction('records').objectStore('records').getAllKeys();
          q.onsuccess = () => resolve(q.result);
        };
      }),
  );
  expect(records).toEqual(['session']);
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('普通用户不能登录后台', async ({ page }) => {
  await login(page, 'browser_user');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '管理导航' })).toHaveCount(0);
});
test('余额提交丢失响应后手动重试，不重复赠送', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '用户与余额' }).click();
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'browser_other', exact: true }) })
    .getByRole('button', { name: '余额与流水' })
    .click();
  await page.getByLabel('金额（元）').fill('0.123456');
  await page.getByLabel('原因', { exact: true }).fill('浏览器幂等重试');
  let first = true;
  const keys: string[] = [];
  await page.route('**/admin/billing/accounts/*/adjustments', async (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (first) {
      first = false;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: '确认提交' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '确认提交' }).click();
  await expect(page.getByRole('status')).toHaveText('余额已更新');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(page.getByRole('cell', { name: '浏览器幂等重试', exact: true })).toHaveCount(1);
});
test('上游测试与密钥掩码；原始密钥不会存入后台数据缓存', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '上游管理' }).click();
  await page.getByLabel('显示名称').fill('浏览器本机上游');
  await page.getByLabel('API基础地址').fill('http://127.0.0.1:3001/v1');
  const secret = 'sk-browser-secret-canary-123456';
  await page.getByLabel('平台API密钥').fill(secret);
  await page.getByRole('button', { name: '测试并保存' }).click();
  await expect(page.getByRole('status')).toHaveText('连通测试通过，已保存');
  await expect(page.getByLabel('平台API密钥')).toHaveValue('');
  await expect(page.getByRole('cell', { name: '浏览器本机上游', exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain(secret);
  const contents = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const r = indexedDB.open('weiban-admin', 1);
        r.onsuccess = () => {
          const q = r.result.transaction('records').objectStore('records').getAll();
          q.onsuccess = () => resolve(q.result);
        };
      }),
  );
  expect(JSON.stringify(contents)).not.toContain(secret);
});
test('角色结构化编辑、真实草稿保存、发布检测门禁和图片上传', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '角色库' }).click();
  await page.getByLabel('角色名字', { exact: true }).fill('浏览器角色');
  await page.getByLabel('一句话介绍').fill('真实API草稿');
  await page.getByLabel('备用开场白（每行一个，至少一条）').fill('你好呀');
  await page.getByLabel('人设摘要').fill('温柔的原创成年角色');
  await page.getByLabel('性格', { exact: true }).fill('温柔、认真');
  await page.getByLabel('上传角色图片').setInputFiles({
    name: 'avatar.png',
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
  });
  await expect(page.getByRole('status').filter({ hasText: '图片已上传' })).toBeVisible();
  await page.getByRole('button', { name: '保存角色草稿' }).click();
  await expect(page.getByRole('status').filter({ hasText: '角色草稿已保存' })).toBeVisible();
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '浏览器角色', exact: true }) });
  await expect(row.getByRole('cell', { name: '草稿', exact: true })).toBeVisible();
  await row.getByRole('button', { name: '上架', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '编辑 浏览器角色' }).click();
  await expect(page.getByLabel('人设摘要')).toHaveValue('温柔的原创成年角色');
  await expect(page.getByText('已设置角色图片', { exact: true })).toBeVisible();
});
test('价目草稿精确微元、模型启用与缺价发布确认', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '上游管理' }).click();
  await page.getByLabel('显示名称').fill('价目测试上游');
  await page.getByLabel('API基础地址').fill('http://127.0.0.1:3001/v1');
  await page.getByLabel('平台API密钥').fill('sk-price-test-key-123456');
  await page.getByRole('button', { name: '测试并保存' }).click();
  await expect(page.getByRole('status')).toHaveText('连通测试通过，已保存');
  await page.getByRole('link', { name: '价目表' }).click();
  await page.getByLabel('版本名称').fill('浏览器价格');
  await page.getByLabel('第1行模型键').fill('browser/test');
  await page.getByLabel('第1行售价').fill('1.234567');
  await page.getByLabel('第1行成本价').fill('0.123456');
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/price-versions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const price = await (await saved).json();
  expect(price.items[0].priceMicros).toBe(1234567);
  expect(price.items[0].costMicros).toBe(123456);
  await page.getByRole('button', { name: '立即发布' }).click();
  await expect(page.getByRole('status')).toHaveText('新版本已立即生效，原版本已停用');
  await page.getByRole('link', { name: '模型目录' }).click();
  await page.getByLabel('模型键', { exact: true }).fill('browser/test');
  await page.getByLabel('显示名称').fill('浏览器测试模型');
  await page.getByLabel('出品方').fill('浏览器测试');
  await page.getByLabel('调用上游').selectOption({ label: '价目测试上游' });
  await page.getByLabel('上游模型名称').fill('browser-test');
  await page.getByLabel('启用（先发布价格）').check();
  await page.getByRole('button', { name: '保存模型' }).click();
  await expect(page.getByRole('status')).toHaveText('模型目录已保存');
  await page.getByRole('link', { name: '价目表' }).click();
  await page.getByLabel('版本名称').fill('缺模型测试');
  await page.getByLabel('第1行模型键').fill('browser/other');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('价目草稿已保存');
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '缺模型测试', exact: true }) });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('browser/test');
    await dialog.dismiss();
  });
  await row.getByRole('button', { name: '立即发布' }).click();
  await expect(row.getByRole('cell', { name: '草稿', exact: true })).toBeVisible();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('browser/test');
    await dialog.accept();
  });
  await row.getByRole('button', { name: '立即发布' }).click();
  await expect(row.getByRole('cell', { name: '生效中', exact: true })).toBeVisible();
});

test('真实提醒红点、分页、丢失处理响应后幂等重试；管理内容不落本机缓存', async ({ page }) => {
  await login(page);
  await expect(page.getByLabel('53条未处理提醒')).toBeVisible();
  await page.getByRole('link', { name: '运行提醒' }).click();
  await expect(page.getByRole('heading', { name: '运行提醒' })).toBeVisible();
  await expect(page.getByRole('button', { name: '标记已处理' })).toHaveCount(50);
  await page.getByRole('button', { name: '加载更多提醒' }).click();
  await expect(page.getByRole('button', { name: '标记已处理' })).toHaveCount(53);
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
  await page.getByRole('button', { name: '标记已处理' }).first().click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '标记已处理' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: '已标记为已处理' })).toHaveText(
    '已标记为已处理',
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await expect(page.getByLabel('52条未处理提醒')).toBeVisible();
  await page.getByLabel('提醒范围').selectOption('all');
  await page.getByRole('button', { name: '加载更多提醒' }).click();
  await expect(page.getByRole('cell', { name: '已处理', exact: true })).toHaveCount(1);
  await expect(page.getByRole('row')).toHaveCount(54);
  await page.reload();
  await expect(page.getByLabel('52条未处理提醒')).toBeVisible();
  const records = await page.evaluate(
    () =>
      new Promise<IDBValidKey[]>((resolve) => {
        const request = indexedDB.open('weiban-admin', 1);
        request.onsuccess = () => {
          const keys = request.result.transaction('records').objectStore('records').getAllKeys();
          keys.onsuccess = () => resolve(keys.result);
        };
      }),
  );
  expect(records).toEqual(['session']);
});
