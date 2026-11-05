import { expect, test, type Page } from './fixtures.js';
import { readFile, writeFile } from 'node:fs/promises';
import { AuthResponse, MessagePage } from '@weiban/contracts';
import { releaseProxy } from './release-proxy.js';

async function openChat(page: Page, origin: string) {
  await page.goto(origin);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  const onboarding = page.getByRole('heading', { name: 'TA 该怎么称呼你？', exact: true });
  await expect(page.getByRole('navigation', { name: '主导航' }).or(onboarding)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page.getByLabel('昵称', { exact: true }).fill('更新测试用户');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: /测试陪伴角色/ }).click();
    await expect(page).toHaveURL(/\/chat\//);
  } else {
    await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  }
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
}

test('新版本等待生效期间，发布断连后旧页不刷新即可补发与继续聊天，草稿保留', async ({ page }) => {
  test.setTimeout(65_000);
  let authenticated = 0;
  const text = '发布中排队的合成消息';
  const proxy = await releaseProxy(text);
  const sentIds = proxy.sentIds;
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (JSON.parse(String(payload)).type === 'auth.ok') authenticated++;
    }),
  );
  const file = new URL('../../dist/sw.js', import.meta.url);
  const original = await readFile(file, 'utf8');
  try {
    // 与既有 storage-state 一致；临时本机入口使用独立端口，需设置在它自己的来源下。
    await page.addInitScript(() => localStorage.setItem('permissions-onboarded', '1'));
    await openChat(page, proxy.origin);
    await expect.poll(() => authenticated).toBeGreaterThan(0);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    // 使用真实 SW 安装/等待流程；只控制发布时网络中断，不改变页面状态或消息结果。
    await writeFile(file, original + '\n// controlled old-page compatibility update\n');
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect
      .poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)))
      .toBe(true);
    const beforeClose = proxy.stateReads;
    proxy.mode('http');
    const offline = page.getByText('网络暂不可用，消息保存在本机，联网后继续发送', { exact: true });
    // 只断长连接、没有新消息：原版会一直保留“网络不可用”，即使 HTTP 对账已成功。
    await expect.poll(() => proxy.stateReads, { timeout: 10_000 }).toBeGreaterThan(beforeClose);
    await expect(offline).toBeHidden();
    proxy.mode('down');
    await page.getByLabel('消息', { exact: true }).fill(text);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const draft = '更新期间没有发送的草稿';
    await page.getByLabel('消息', { exact: true }).fill(draft);
    await expect(offline).toBeVisible({ timeout: 10_000 });
    expect(sentIds.length).toBeGreaterThan(0);
    // 先恢复 HTTP、长连接继续不可用，必须据实际可发送的通道恢复在线提示。
    proxy.mode('http');
    await expect(offline).toBeHidden({ timeout: 12_000 });
    const queued = page.locator('.wx-msg-row.mine').filter({ hasText: text });
    await expect(queued.getByText('已送达', { exact: true })).toBeVisible({ timeout: 12_000 });
    expect(sentIds.length).toBeGreaterThan(1);
    expect(new Set(sentIds).size).toBe(1);
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue(draft);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(
      page
        .locator('.wx-msg-row.mine')
        .filter({ hasText: draft })
        .getByText('已送达', { exact: true }),
    ).toBeVisible();
    proxy.mode('up');
    await expect.poll(() => authenticated, { timeout: 15_000 }).toBeGreaterThan(1);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(
      await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)),
    ).toBe(true);
    const auth = AuthResponse.parse(
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open('weiban-app', 1);
            open.onsuccess = () => {
              const request = open.result
                .transaction('records')
                .objectStore('records')
                .get('session');
              request.onsuccess = () => {
                open.result.close();
                resolve(request.result);
              };
            };
          }),
      ),
    );
    const conversation = new URL(page.url()).pathname.split('/').at(-1)!;
    const response = await page.request.get(
      `${proxy.origin}/api/v1/conversations/${conversation}/messages?limit=100`,
      {
        headers: { Authorization: `Bearer ${auth.session.token}` },
      },
    );
    expect(response.ok()).toBe(true);
    const messages = MessagePage.parse(await response.json()).items;
    for (const content of [text, draft])
      expect(
        messages.filter(
          (message) => message.content?.type === 'text' && message.content.text === content,
        ),
      ).toHaveLength(1);
  } finally {
    await writeFile(file, original);
    await page.close();
    await proxy.close();
  }
});
