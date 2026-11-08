import { generateKeyPairSync, sign, randomBytes, createHash } from 'node:crypto';
import { expect, test } from './fixtures.js';
import { ScanOrder } from '@weiban/contracts';

test('扫码收款：后台配置、手机签名到账、积分和会员页面显示真实结果', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const device = {
    platform: 'web',
    name: 'Synthetic checkout browser',
    appVersion: '7.6',
    timeZone: 'Asia/Shanghai',
  };
  const login = await request.post('http://127.0.0.1:3000/api/v1/auth/login', {
    data: { username: 'browser_admin', password: 'correct horse battery', device, kind: 'admin' },
  });
  expect(login.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${(await login.json()).session.token}` };
  const admin = 'http://127.0.0.1:3000/api/v1/admin/scan-payments';
  const monitor = 'http://127.0.0.1:3000/api/v1/billing/scan/monitor';
  const pair = await (
    await request.post(admin + '/devices', { headers, data: { name: '合成付款监控' } })
  ).json();
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const proof = (s: string) => sign('sha256', Buffer.from(s), keys.privateKey).toString('base64');
  expect(
    (
      await request.post(monitor + '/pair', {
        data: {
          deviceId: pair.deviceId,
          pairCode: pair.pairCode,
          publicKey: pub,
          signature: proof(`wb-pay-pair-v1|${pair.deviceId}|${pair.pairCode}|${pub}`),
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await (await request.get(admin + '/devices', { headers })).json()).find(
      (d: { id: string }) => d.id === pair.deviceId,
    ),
  ).toMatchObject({ active: true });
  const now = (
    await (await request.get('http://127.0.0.1:3000/api/v1/me/membership', { headers })).json()
  ).checkedAt as string;
  expect(now).toMatch(/^2026-/);
  const heartbeat = {
    deviceId: pair.deviceId,
    requestTime: now,
    event: { type: 'heartbeat', listenerConnected: true, queued: 0 },
    signature: proof(`wb-pay-v1|${pair.deviceId}|${now}|heartbeat|1|0`),
  };
  expect((await request.post(monitor + '/report', { data: heartbeat })).ok()).toBe(true);
  // Configure using the actual admin screen. The image is synthetic and cannot collect money.
  await page.goto('http://127.0.0.1:5174/');
  await page.getByLabel('管理员账号').fill('browser_admin');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.admin-avatar')).toBeVisible();
  await page.goto('http://127.0.0.1:5174/scan-payments');
  await page.getByRole('button', { name: '配置收款码与开关' }).click();
  const buffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lV8AAAAASUVORK5CYII=',
    'base64',
  );
  for (const label of ['微信收款码', '支付宝收款码'])
    await page
      .getByLabel(label, { exact: true })
      .setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer });
  await page.getByRole('checkbox').check();
  await page.getByRole('switch').check();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '收款设置' })).toHaveCount(0);
  await expect(page.getByText('已开放', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'apps/web/test-results/scan-admin.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_other');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  for (const purchase of ['recharge', 'membership'] as const) {
    await page.goto(purchase === 'recharge' ? '/wallet/recharge' : '/membership');
    if (purchase === 'recharge')
      await page.getByRole('button', { name: '扫码充值', exact: true }).click();
    else await page.getByRole('button').filter({ hasText: '月卡' }).click();
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/billing/scan/orders'),
    );
    await page
      .getByRole('button', { name: purchase === 'recharge' ? '微信扫码付款' : '支付宝扫码付款' })
      .click();
    const o = ScanOrder.parse(await (await created).json());
    await expect(
      page.getByText(`¥${(o.amountFen / 100).toFixed(2)}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByAltText(purchase === 'recharge' ? '微信收款码' : '支付宝收款码'),
    ).toBeVisible();
    await page.screenshot({ path: `apps/web/test-results/scan-${purchase}.png` });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存收款码', exact: true }).click();
    expect((await download).suggestedFilename()).toContain('weiban-payment-');
    const eventId = createHash('sha256').update(randomBytes(16)).digest('hex');
    const event = {
      type: 'receipt',
      eventId,
      channel: o.channel,
      amountFen: o.amountFen,
      observedAt: now,
      postedAt: now,
    };
    const data = {
      deviceId: pair.deviceId,
      requestTime: now,
      event,
      signature: proof(
        `wb-pay-v1|${pair.deviceId}|${now}|receipt|${eventId}|${o.channel}|${o.amountFen}|${now}|${now}`,
      ),
    };
    const reported = await request.post(monitor + '/report', { data });
    expect(await reported.json()).toMatchObject({
      ok: true,
      status: 'matched',
      purchaseKind: purchase,
    });
    // Also replay the notification after the initial response; the screen still reports one paid order.
    expect((await request.post(monitor + '/report', { data })).ok()).toBe(true);
    await page.getByRole('button', { name: '查询到账' }).click();
    await expect(page.getByText('已到账', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.reload();
  await expect(page.getByText(/有效期至/)).toBeVisible();
  // A missed phone notification can be settled only through the explicit administrator bill check.
  await page.goto('/wallet/recharge');
  await page.getByRole('button', { name: '扫码充值', exact: true }).click();
  const manualCreated = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/billing/scan/orders'),
  );
  await page.getByRole('button', { name: '微信扫码付款', exact: true }).click();
  const manualOrder = ScanOrder.parse(await (await manualCreated).json());
  // Every receipt query is slower than the polling interval. Polling must not
  // invalidate every in-flight result and leave the table permanently empty.
  let delayedReceiptQueries = 0;
  await page.route('**/admin/scan-payments/receipts?*', async (route) => {
    delayedReceiptQueries++;
    await new Promise((resolve) => setTimeout(resolve, 6000));
    await route.continue();
  });
  await page.goto('http://127.0.0.1:5174/scan-payments');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByText('监控上报记录', { exact: true })).toBeVisible();
  const payerRow = page.getByRole('row').filter({ hasText: manualOrder.id });
  await expect(page.getByRole('columnheader', { name: '付款人', exact: true })).toBeVisible();
  await expect(payerRow.locator('.cell-title')).toHaveText('其他用户');
  await expect(payerRow.locator('.cell-title')).toHaveAttribute('title', manualOrder.userId!);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await payerRow.locator('.ant-typography-copy').click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(manualOrder.userId);
  // A promotion can contain the exact pending amount. Preserve it for review and
  // make it visible without refreshing the page, but never credit that order.
  const uncertainId = createHash('sha256').update(randomBytes(16)).digest('hex');
  const uncertain = {
    deviceId: pair.deviceId,
    requestTime: now,
    event: {
      type: 'receipt',
      eventId: uncertainId,
      channel: manualOrder.channel,
      amountFen: manualOrder.amountFen,
      observedAt: now,
      postedAt: now,
      reviewReason: 'notice_uncertain',
    },
    signature: proof(
      `wb-pay-v2|${pair.deviceId}|${now}|receipt|${uncertainId}|${manualOrder.channel}|${manualOrder.amountFen}|${now}|${now}|notice_uncertain`,
    ),
  };
  expect(await (await request.post(monitor + '/report', { data: uncertain })).json()).toMatchObject(
    {
      ok: true,
      status: 'review',
      purchaseKind: null,
    },
  );
  const uncertainRow = page.getByRole('row').filter({ hasText: '有金额的通知，收款性质待核对' });
  await expect(uncertainRow).toBeVisible({ timeout: 12_000 });
  expect(delayedReceiptQueries).toBeGreaterThan(0);
  await expect(uncertainRow).toContainText(`¥${(manualOrder.amountFen / 100).toFixed(2)}`);
  await expect(uncertainRow).toContainText('未关联');
  await expect(page.getByRole('row').filter({ hasText: manualOrder.id })).toContainText('待付款');
  await page.unroute('**/admin/scan-payments/receipts?*');
  await page
    .getByRole('row')
    .filter({ hasText: manualOrder.id })
    .getByRole('button', { name: '核实漏报到账' })
    .click();
  const settle = page.getByRole('button', { name: '已核实实际收款，登记入账' });
  await expect(
    page.getByRole('dialog', { name: '核实漏报到账' }).locator('.cell-title'),
  ).toHaveAttribute('title', manualOrder.userId!);
  await expect(settle).toBeDisabled();
  await page
    .getByLabel('账单实收金额', { exact: true })
    .fill((manualOrder.amountFen / 100).toFixed(2));
  await page.getByLabel('支付机构交易编号', { exact: true }).fill('SYNTHETIC_BROWSER_RECEIPT');
  await page.getByLabel('漏报核对依据', { exact: true }).fill('合成账单，仅测试漏报处理');
  await settle.click();
  await expect(page.getByRole('dialog', { name: '核实漏报到账' })).toHaveCount(0);
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: manualOrder.id })
      .first()
      .getByText('已到账', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '到账通知时间', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '入账时间', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '会员购买', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '积分充值', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '暂停监控', exact: true })).toBeVisible();
  await expect(page.getByText('待配对', { exact: true })).toHaveCount(0);
  const settings = await (await request.get(admin + '/settings', { headers })).json();
  await request.put(admin + '/settings', { headers, data: { ...settings, enabled: false } });
  await page.goto('/wallet');
  await page.getByRole('button', { name: '扫码付款记录' }).click();
  await expect(page.getByText('最近付款记录', { exact: true })).toBeVisible();
  await expect(page.getByRole('button').filter({ hasText: '积分充值 ¥' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
