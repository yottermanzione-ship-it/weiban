import { expect, test, type Page } from '@playwright/test';
async function openChat(page: Page) {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/chat');
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await expect(page.getByRole('heading', { name: '测试陪伴角色' })).toBeVisible();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
}
test('真实HTTP/WS聊天：同步历史虚拟列表、原子落库、发送和撤回', async ({ page }) => {
  const errors: string[] = [];
  const sent: string[] = [];
  const received: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    expect(socket.url()).not.toContain('?');
    socket.on('framesent', (event) => {
      const frame = JSON.parse(String(event.payload)) as { type: string };
      sent.push(frame.type);
    });
    socket.on('framereceived', (event) => {
      const frame = JSON.parse(String(event.payload)) as { type: string };
      received.push(frame.type);
    });
  });
  await openChat(page);
  await expect(page.getByRole('list', { name: '聊天消息' }).getByRole('listitem')).not.toHaveCount(
    50,
  );
  await page.getByLabel('消息', { exact: true }).fill('浏览器实际发送');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.message-bubble').filter({ hasText: '浏览器实际发送' })).toHaveCount(
    1,
  );
  await expect(page.getByText('已送达', { exact: true })).toBeVisible();
  const bubble = page.locator('.message-row').filter({ hasText: '浏览器实际发送' });
  await bubble.getByLabel('消息操作').click();
  await bubble.getByRole('button', { name: '引用', exact: true }).click();
  await expect(page.locator('.quote-preview').filter({ hasText: '浏览器实际发送' })).toHaveCount(1);
  await bubble.getByRole('button', { name: '撤回', exact: true }).click();
  await expect(page.getByText('这条消息已撤回', { exact: true })).toBeVisible();
  await expect(page.locator('.message-bubble').filter({ hasText: '浏览器实际发送' })).toHaveCount(
    0,
  );
  await expect(page.locator('.quote-preview').filter({ hasText: '浏览器实际发送' })).toHaveCount(0);
  expect(sent[0]).toBe('auth');
  expect(sent).toContain('presence.focus');
  await expect.poll(() => received.includes('update')).toBe(true);
  await page.getByRole('button', { name: '加载更早消息' }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const open = indexedDB.open('weiban-app', 1);
            open.onsuccess = () => {
              const request = open.result.transaction('records').objectStore('records').getAll();
              request.onsuccess = () =>
                resolve(
                  request.result
                    .filter(
                      (value: unknown) =>
                        typeof value === 'object' && value !== null && 'messages' in value,
                    )
                    .map((value) =>
                      Array.isArray(value.messages) ? value.messages.length : 0,
                    )[0] ?? 0,
                );
            };
          }),
      ),
    )
    .toBeGreaterThan(70);
  await page.screenshot({ path: 'apps/web/test-results/chat.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('关闭WS后HTTP等价路径；响应丢失用同一clientMsgId恢复，不重复消息', async ({ page }) => {
  await page.routeWebSocket('**/api/v1/ws', (socket) =>
    socket.close({ code: 1000, reason: 'browser HTTP fallback fixture' }),
  );
  await openChat(page);
  let first = true;
  const ids: string[] = [];
  await page.route('**/conversations/*/messages', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    ids.push(route.request().postDataJSON().clientMsgId);
    if (first) {
      first = false;
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByLabel('消息', { exact: true }).fill('确认丢失仍只显示一次');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(
    page.locator('.message-bubble').filter({ hasText: '确认丢失仍只显示一次' }),
  ).toHaveCount(1, { timeout: 15_000 });
  expect(ids.length).toBeGreaterThanOrEqual(1);
  expect(new Set(ids).size).toBe(1);
  await page.reload();
  await expect(
    page.locator('.message-bubble').filter({ hasText: '确认丢失仍只显示一次' }),
  ).toHaveCount(1);
});
test('断网待发消息刷新后仍在；重新联网送达；退出后旧聊天缓存清空', async ({ page, context }) => {
  await openChat(page);
  await context.setOffline(true);
  await page.getByLabel('消息', { exact: true }).fill('离线待发私密消息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.pending-message')).toContainText('离线待发私密消息');
  await page.reload();
  await expect(page.locator('.pending-message')).toContainText('离线待发私密消息');
  await context.setOffline(false);
  await expect(page.locator('.message-bubble').filter({ hasText: '离线待发私密消息' })).toHaveCount(
    1,
    { timeout: 15_000 },
  );
  await expect(page.locator('.pending-message')).toHaveCount(0);
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  const keys = await page.evaluate(
    () =>
      new Promise<IDBValidKey[]>((resolve) => {
        const open = indexedDB.open('weiban-app', 1);
        open.onsuccess = () => {
          const request = open.result.transaction('records').objectStore('records').getAllKeys();
          request.onsuccess = () => resolve(request.result);
        };
      }),
  );
  expect(keys).toEqual([]);
});
