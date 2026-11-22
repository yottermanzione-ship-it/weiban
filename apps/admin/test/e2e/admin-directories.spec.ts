import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('管理员账号').fill('browser_admin');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.admin-avatar')).toBeVisible();
}

function apiRequests(page: Page) {
  const requests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/admin/')) requests.push(url);
  });
  return requests;
}

function observe(page: Page, path: string) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/v1/admin${path}`,
  );
}

test('user and character drawers fetch detail on demand and column controls change layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const requests = apiRequests(page);
  const firstUsers = observe(page, '/billing/users');
  await page.goto('/accounts');
  const userResponse = await firstUsers;
  expect(userResponse.ok()).toBe(true);
  const users = (await userResponse.json()).items as Array<{ userId: string }>;
  expect(users.length).toBeGreaterThan(0);
  expect(users.length).toBeLessThanOrEqual(20);
  expect(new URL(userResponse.url()).searchParams.get('pageSize')).toBe('20');
  const userRows = page.locator('tbody tr[data-row-key]');
  await expect(userRows).toHaveCount(users.length);
  expect(requests.filter((url) => url.pathname === '/api/v1/admin/billing/users')).toHaveLength(1);
  expect(
    requests.some((url) =>
      /\/billing\/users\/|\/users\/lookup-labels|\/billing\/accounts$/.test(url.pathname),
    ),
  ).toBe(false);
  const userDetail = observe(page, `/billing/users/${users[0]!.userId}`);
  await userRows.first().click();
  expect((await userDetail).ok()).toBe(true);
  await expect(page.getByRole('tab', { name: '基本资料' })).toBeVisible();

  const rolePage = observe(page, '/characters/directory');
  await page.goto('/characters');
  const roleResponse = await rolePage;
  expect(roleResponse.ok()).toBe(true);
  const { items, total } = (await roleResponse.json()) as {
    total: number;
    items: Array<{ characterId: string }>;
  };
  expect(items).toHaveLength(20);
  expect(total).toBeGreaterThan(20);
  expect(items[0]).not.toHaveProperty('card');
  const roleRows = page.locator('tbody tr[data-row-key]');
  await expect(roleRows).toHaveCount(20);
  expect(
    requests.filter((url) => url.pathname === '/api/v1/admin/characters/directory'),
  ).toHaveLength(1);
  expect(requests.some((url) => /\/characters\/.+\/detail$/.test(url.pathname))).toBe(false);

  const name = page.getByRole('columnheader', { name: '角色', exact: true });
  const classification = page.getByRole('columnheader', { name: '分类', exact: true });
  const originalWidth = (await name.boundingBox())!.width;
  const originalClassWidth = (await classification.boundingBox())!.width;
  const originalHeight = (await roleRows.first().boundingBox())!.height;
  await page.getByRole('button', { name: '调整列宽和密度' }).click();
  await page.getByRole('spinbutton', { name: '角色列宽（像素）' }).fill('320');
  await page.getByRole('spinbutton', { name: '角色列宽（像素）' }).press('Tab');
  await page.getByRole('spinbutton', { name: '分类列宽（像素）' }).fill('80');
  await page.getByRole('spinbutton', { name: '分类列宽（像素）' }).press('Tab');
  await expect.poll(async () => Math.round((await name.boundingBox())!.width)).toBe(320);
  await expect.poll(async () => Math.round((await classification.boundingBox())!.width)).toBe(80);
  await page.locator('.table-layout-settings').getByText('紧凑', { exact: true }).click();
  await expect
    .poll(async () => (await roleRows.first().boundingBox())!.height)
    .toBeLessThan(originalHeight);
  const compactHeight = (await roleRows.first().boundingBox())!.height;
  await page.getByRole('button', { name: '恢复默认' }).click();
  await expect.poll(async () => (await name.boundingBox())!.width).toBe(originalWidth);
  await expect
    .poll(async () => (await classification.boundingBox())!.width)
    .toBe(originalClassWidth);
  await expect
    .poll(async () => (await roleRows.first().boundingBox())!.height)
    .toBe(originalHeight);
  await page.getByRole('button', { name: '调整列宽和密度' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const scroll = page.locator('.adjustable-table :is(.ant-table-content, .ant-table-body)');
  const horizontal = await scroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    return {
      width: element.clientWidth,
      content: element.scrollWidth,
      reached: element.scrollLeft,
    };
  });
  expect(horizontal.content).toBeGreaterThan(horizontal.width);
  expect(horizontal.reached).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: '调整列宽和密度' }).click();
  await expect(page.getByRole('spinbutton', { name: '角色列宽（像素）' })).toBeInViewport();
  await page.getByRole('button', { name: '调整列宽和密度' }).click();
  const roleDetail = observe(page, `/characters/${items[0]!.characterId}/detail`);
  await roleRows.first().getByRole('button', { name: '编辑', exact: true }).click();
  expect((await roleDetail).ok()).toBe(true);
  expect((await (await roleDetail).json()).card).toBeDefined();
  await test.info().attach('observed-table-dimensions', {
    contentType: 'application/json',
    body: JSON.stringify({
      userRows: users.length,
      roleRows: items.length,
      roleTotal: total,
      name: [originalWidth, 320],
      classification: [originalClassWidth, 80],
      rowHeight: [originalHeight, compactHeight],
      mobile: horizontal,
    }),
  });
});

test('model directory reads one page, sorts globally and fetches exact detail', async ({
  page,
}) => {
  await signIn(page);
  const authorization = await page.evaluate(
    async () =>
      new Promise<string>((resolve) => {
        const opened = indexedDB.open('weiban-admin', 1);
        opened.onsuccess = () => {
          const lookup = opened.result.transaction('records').objectStore('records').get('session');
          lookup.onsuccess = () => {
            resolve(`Bearer ${lookup.result.session.token}`);
            opened.result.close();
          };
        };
      }),
  );
  const headers = { authorization };
  const upstreams = await page.request.get('/api/v1/admin/model/upstreams', { headers });
  expect(upstreams.ok()).toBe(true);
  const upstreamId = (await upstreams.json()).items[0].upstreamId as string;
  const keys = Array.from(
    { length: 22 },
    (_, i) => `browser/list-model-${String(i).padStart(2, '0')}`,
  );
  const activeKeys = new Set<string>();
  try {
    for (const [i, modelKey] of keys.entries()) {
      const created = await page.request.put(
        `/api/v1/admin/model/catalog/${encodeURIComponent(modelKey)}`,
        {
          headers,
          data: {
            modelKey,
            displayName: `List fixture ${String(21 - i).padStart(2, '0')}`,
            vendorName: 'Browser',
            upstreamId,
            upstreamModelId: 'browser-test',
            enabled: false,
            capabilities: [],
            tags: [],
            leaderboardRank: null,
            defaultFor: [],
            sortOrder: 10 + i,
          },
        },
      );
      expect(created.ok(), await created.text()).toBe(true);
      activeKeys.add(modelKey);
    }
    const archived = keys[0]!;
    const deleted = await page.request.post('/api/v1/admin/model/models/delete', {
      headers,
      data: { modelKeys: [archived] },
    });
    expect(deleted.ok(), await deleted.text()).toBe(true);
    activeKeys.delete(archived);
    // The dashboard also requests this endpoint with pageSize=1. Start measuring after leaving it.
    await page.goto('about:blank');
    const requests = apiRequests(page);
    const firstModel = observe(page, '/model/models/page');
    await page.goto('/model');
    const response = await firstModel;
    expect(response.ok()).toBe(true);
    const requestedPage = new URL(response.url()).searchParams;
    expect(requestedPage.get('page')).toBe('1');
    expect(requestedPage.get('pageSize')).toBe('20');
    expect(requestedPage.get('sort')).toBe('priority');
    const result = await response.json();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).not.toHaveProperty('costRates');
    expect(result.items[0]).not.toHaveProperty('billingBounds');
    expect(result.total).toBeGreaterThan(20);
    expect(result.items.every((item: { deletedAt?: string }) => !item.deletedAt)).toBe(true);
    const rows = page.locator('tbody tr[data-row-key]');
    await expect(rows).toHaveCount(result.items.length);
    expect(
      requests.map((u) => u.pathname).filter((p) => p.startsWith('/api/v1/admin/model/models')),
    ).toEqual(['/api/v1/admin/model/models/page']);
    const sorted = observe(page, '/model/models/page');
    await page.getByRole('columnheader', { name: '模型', exact: true }).click();
    const sortedResponse = await sorted;
    expect(new URL(sortedResponse.url()).searchParams.get('sort')).toBe('name_asc');
    const ordered = await sortedResponse.json();
    expect(ordered.items.map((item: { modelKey: string }) => item.modelKey)).not.toContain(
      archived,
    );
    expect(
      ordered.items.find((item: { modelKey: string }) =>
        item.modelKey.startsWith('browser/list-model'),
      )?.modelKey,
    ).toBe(keys.at(-1));
    const item = ordered.items[0];
    const detail = observe(page, `/model/models/${encodeURIComponent(item.modelKey)}`);
    await page
      .locator(`tr[data-row-key="${item.modelKey}"]`)
      .getByRole('button', { name: '编辑', exact: true })
      .click();
    const detailResponse = await detail;
    expect(detailResponse.ok()).toBe(true);
    expect(await detailResponse.json()).toHaveProperty('costRates');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible();
    expect(requests.some((url) => url.pathname.endsWith('/models/selection'))).toBe(false);
    requests.length = 0;
    const accounts = observe(page, '/model/upstreams');
    await page.goto('/model?tab=upstreams');
    expect((await accounts).ok()).toBe(true);
    const account = page.locator(`tr[data-row-key="${item.upstreamId}"]`);
    await expect(account).toBeVisible();
    expect(
      requests.some((url) => /\/model\/(models|upstreams\/model-references)/.test(url.pathname)),
    ).toBe(false);
    const references = observe(page, '/model/upstreams/model-references');
    await account.click();
    const referenceResponse = await references;
    expect(referenceResponse.ok()).toBe(true);
    expect(new URL(referenceResponse.url()).searchParams.get('ids')).toBe(item.upstreamId);
    const referencesBody = await referenceResponse.json();
    expect(referencesBody.items).toContainEqual(
      expect.objectContaining({ modelKey: item.modelKey }),
    );
    expect(
      referencesBody.items.some((row: { modelKey: string }) => row.modelKey === archived),
    ).toBe(false);
    expect(referencesBody.items[0]).not.toHaveProperty('rates');
    await test.info().attach('observed-model-page', {
      contentType: 'application/json',
      body: JSON.stringify({ rows: result.items.length, total: result.total }),
    });
  } finally {
    if (activeKeys.size) {
      const removed = await page.request.post('/api/v1/admin/model/models/delete', {
        headers,
        data: { modelKeys: [...activeKeys] },
      });
      expect(removed.ok(), await removed.text()).toBe(true);
    }
  }
});

test('Weiban OS persists appearance, opens search results and exports masked user IDs', async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: '30 日计费与流量趋势' })).toBeVisible();
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: '全局搜索', exact: true })).toBeVisible();

  await page.keyboard.press('Control+k');
  const spotlight = page.getByRole('combobox', { name: '检索页面、用户、角色、模型' });
  await spotlight.fill('browser_other');
  await expect(page.getByRole('option', { name: /browser_other/ })).toBeVisible();
  await spotlight.press('Enter');
  await expect(page.getByRole('tab', { name: '基本资料' })).toBeVisible();
  await page.keyboard.press('Escape');

  const incoming = observe(page, '/billing/users');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  const users = (await (await incoming).json()).items as { userId: string }[];
  expect(users.length).toBeGreaterThan(0);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本页 CSV' }).click();
  const csv = await readFile(await (await downloadEvent).path(), 'utf8');
  for (const { userId } of users) {
    expect(csv).not.toContain(userId);
    expect(csv).toContain(userId.slice(0, 4) + '…' + userId.slice(-4));
  }
});

test('user amounts and the two dates toggle server-side sort directions independently', async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole('link', { name: '扫码收款', exact: true })).toHaveAttribute(
    'href',
    '/scan-payments',
  );
  await expect(page.getByRole('link', { name: '充值记录', exact: true })).toHaveAttribute(
    'href',
    '/recharge-records',
  );
  await page.getByRole('link', { name: '用户列表', exact: true }).click();
  const centered = page.locator('.user-membership-value').first();
  await expect(centered).toBeVisible();
  await expect(centered).toHaveCSS('text-align', 'left');
  await expect(centered.locator('..')).toHaveCSS('text-align', 'center');
  const headers = page.locator('thead th');
  await expect(headers).toHaveCount(8);
  for (const header of await headers.all()) {
    await expect(header).toHaveCSS('text-align', 'center');
  }
  const registered = page.getByRole('columnheader').filter({ hasText: '注册时间' });
  const active = page.getByRole('columnheader').filter({ hasText: '最近活跃' });
  await expect(registered).toBeVisible();
  await expect(active).toBeVisible();
  await expect(registered.getByRole('button')).toHaveCount(1);
  await expect(active.getByRole('button')).toHaveCount(1);
  await expect(registered).toHaveAttribute('aria-sort', 'descending');

  for (const [label, sort] of [
    ['余额（积分）升序', 'balance_asc'],
    ['余额（积分）降序', 'balance_desc'],
    ['近 30 天消耗升序', 'spent_asc'],
    ['近 30 天消耗降序', 'spent_desc'],
    ['注册时间降序', 'newest'],
    ['注册时间升序', 'oldest'],
    ['最近活跃降序', 'active_desc'],
    ['最近活跃升序', 'active_asc'],
  ] as const) {
    const requested = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/v1/admin/billing/users' && url.searchParams.get('sort') === sort
      );
    });
    await page.getByRole('button', { name: label, exact: true }).click();
    const response = await requested;
    expect(response.ok()).toBe(true);
    const state = (await response.json()) as {
      items: {
        user: { createdAt: string; lastActiveAt: string | null };
        account?: { balanceMicros: number; spentLast30DaysMicros: number };
      }[];
    };
    expect(state.items.length).toBeGreaterThan(1);
    if (sort.startsWith('balance_') || sort.startsWith('spent_')) {
      const amounts = state.items.map(({ account }) =>
        sort.startsWith('balance_')
          ? (account?.balanceMicros ?? 0)
          : (account?.spentLast30DaysMicros ?? 0),
      );
      expect(amounts).toEqual(amounts.toSorted((a, b) => (sort.endsWith('_asc') ? a - b : b - a)));
    }
    const times = state.items.map(({ user }) =>
      sort.startsWith('active_') ? user.lastActiveAt : user.createdAt,
    );
    if (sort === 'active_asc' || sort === 'active_desc') {
      await expect(active).toHaveAttribute(
        'aria-sort',
        sort === 'active_asc' ? 'ascending' : 'descending',
      );
      await expect(registered).not.toHaveAttribute('aria-sort');
      const activeTimes = times.filter((date): date is string => date !== null);
      expect(times).toEqual([
        ...activeTimes,
        ...Array(times.length - activeTimes.length).fill(null),
      ]);
      expect(activeTimes).toEqual(
        activeTimes.toSorted((a, b) =>
          sort === 'active_asc' ? a.localeCompare(b) : b.localeCompare(a),
        ),
      );
    }
  }
});

test('navigation starts loading a page on hover and shows its title while the code arrives', async ({
  page,
}) => {
  let proceed = () => {};
  const gate = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  await signIn(page);
  await page.route('**/assets/settings-*.js', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    const settings = page.getByRole('link', { name: '系统设置', exact: true });
    const started = page.waitForRequest((request) =>
      /\/assets\/settings-[^/]+\.js$/.test(request.url()),
    );
    await settings.hover();
    await started;
    await expect(page).not.toHaveURL(/\/settings$/);
    await settings.click();
    await expect(
      page.locator('section[aria-busy="true"]').getByRole('heading', { name: '系统设置' }),
    ).toBeVisible();
  } finally {
    proceed();
  }
  await expect(page.getByText('每用户限流与线路健康', { exact: true })).toBeVisible();
});
