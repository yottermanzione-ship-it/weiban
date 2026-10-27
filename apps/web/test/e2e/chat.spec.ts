import { expect, test, type Page } from '@playwright/test';
async function openChat(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/chat');
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await expect(page.getByRole('heading', { name: '测试陪伴角色' })).toBeVisible();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
}
test('真实HTTP/WS聊天：同步历史虚拟列表、原子落库、发送和撤回', async ({ page }) => {
  // The server fixture uses TestClock; recall visibility must use the same calendar.
  await page.clock.setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
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
  await expect(page.locator('.wx-bubble').filter({ hasText: '浏览器实际发送' })).toHaveCount(1);
  await expect(page.getByText('已送达', { exact: true })).toBeVisible();
  const bubble = page.locator('.wx-msg-row').filter({ hasText: '浏览器实际发送' });
  await bubble.locator('.wx-msg-bubble').click({ delay: 650 });
  await page.getByRole('menuitem', { name: '引用', exact: true }).click();
  await expect(page.locator('.wx-quote-bar').filter({ hasText: '浏览器实际发送' })).toHaveCount(1);
  await bubble.locator('.wx-msg-bubble').click({ delay: 650 });
  await page.getByRole('menuitem', { name: '撤回', exact: true }).click();
  await expect(page.getByText('你撤回了一条消息', { exact: true })).toBeVisible();
  await expect(page.locator('.wx-bubble').filter({ hasText: '浏览器实际发送' })).toHaveCount(0);
  await expect(page.locator('.wx-quote-bar').filter({ hasText: '浏览器实际发送' })).toHaveCount(0);
  expect(sent[0]).toBe('auth');
  expect(sent).toContain('presence.focus');
  await expect.poll(() => received.includes('update')).toBe(true);
  await page.getByRole('list', { name: '聊天消息' }).evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole('button', { name: '加载更多消息', exact: true }).click();
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
  await expect(page.locator('.wx-bubble').filter({ hasText: '确认丢失仍只显示一次' })).toHaveCount(
    1,
    { timeout: 15_000 },
  );
  expect(ids.length).toBeGreaterThanOrEqual(1);
  expect(new Set(ids).size).toBe(1);
  await page.reload();
  await expect(page.locator('.wx-bubble').filter({ hasText: '确认丢失仍只显示一次' })).toHaveCount(
    1,
  );
});
test('断网待发消息刷新后仍在；重新联网送达；退出后旧聊天缓存清空', async ({ page, context }) => {
  await openChat(page);
  await context.setOffline(true);
  await page.getByLabel('消息', { exact: true }).fill('离线待发私密消息');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(
    page.locator('.wx-msg-row.mine').filter({ hasText: '离线待发私密消息' }),
  ).toContainText('离线待发私密消息');
  await page.reload();
  await expect(
    page.locator('.wx-msg-row.mine').filter({ hasText: '离线待发私密消息' }),
  ).toContainText('离线待发私密消息');
  await expect(
    page
      .locator('.wx-msg-row.mine')
      .filter({ hasText: '离线待发私密消息' })
      .getByRole('img', { name: '我的头像' }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator('.wx-bubble').filter({ hasText: '离线待发私密消息' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(
    page
      .locator('.wx-msg-row.mine')
      .filter({ hasText: '离线待发私密消息' })
      .getByText('已送达', { exact: true }),
  ).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '退出登录？', exact: true })
    .getByRole('button', { name: '退出登录', exact: true })
    .click();
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
test('HTTP确认清空先持久保存范围，更新日志暂不可达也不会重现旧正文', async ({ page }) => {
  await page.routeWebSocket('**/api/v1/ws', (socket) => socket.close({ code: 1000 }));
  await openChat(page);
  const secret = '清空后不可恢复的浏览器正文';
  await page.getByLabel('消息', { exact: true }).fill(secret);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.wx-bubble').filter({ hasText: secret })).toHaveCount(1);
  await expect(
    page.locator('.wx-msg-row').filter({ hasText: secret }).getByText('已送达', { exact: true }),
  ).toBeVisible();
  let blockedUpdates = 0;
  await page.route('**/sync/updates?**', (route) => {
    blockedUpdates++;
    return route.abort('failed');
  });
  await page.getByRole('link', { name: '聊天信息', exact: true }).click();
  await page.getByRole('button', { name: '清空聊天记录', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '清空聊天记录', exact: true }).click();
  const response = page.waitForResponse(
    (value) => value.request().method() === 'POST' && value.url().endsWith('/clear'),
  );
  await page
    .getByRole('dialog', { name: '清空聊天记录？', exact: true })
    .getByRole('button', { name: '清空聊天记录', exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const open = indexedDB.open('weiban-app', 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const database = open.result;
              const request = database.transaction('records').objectStore('records').getAll();
              request.onsuccess = () => {
                const state = request.result.find(
                  (value) => value && typeof value === 'object' && 'messages' in value,
                );
                resolve(
                  Boolean(
                    state &&
                    state.messages.length === 0 &&
                    state.excluded.some(
                      (entry: { range: { reason: string; fromSeq: number } }) =>
                        entry.range.reason === 'cleared' && entry.range.fromSeq === 1,
                    ),
                  ),
                );
                database.close();
              };
              request.onerror = () => {
                reject(request.error);
                database.close();
              };
            };
          }),
      ),
    )
    .toBe(true);
  await expect.poll(() => blockedUpdates).toBeGreaterThan(0);
  await page.unroute('**/sync/updates?**');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.locator('.wx-bubble').filter({ hasText: secret })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  await expect(page.locator('.wx-bubble').filter({ hasText: secret })).toHaveCount(0);
  await page.getByRole('link', { name: '聊天信息', exact: true }).click();
  const removals: string[] = [];
  await page.route('**/contacts/*?mode=purge', (route) => {
    removals.push(route.request().url());
    return route.abort('failed');
  });
  await page.getByRole('button', { name: '永久删除角色和数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '永久删除角色和数据？', exact: true })
    .getByRole('button', { name: '继续', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '再次确认永久删除', exact: true })).toBeVisible();
  expect(removals).toEqual([]);
  await page
    .getByRole('dialog', { name: '再次确认永久删除', exact: true })
    .getByRole('button', { name: '永久删除', exact: true })
    .click();
  await expect.poll(() => removals.length).toBe(1);
  expect(removals[0]).toContain('mode=purge');
  await expect(page.getByRole('alert')).toBeVisible();
});
test('真实HTTP记忆管理：新增、手改、删除确认与人设设置', async ({ page }) => {
  await openChat(page);
  await page.getByRole('link', { name: '聊天信息', exact: true }).click();
  await expect(
    page
      .getByRole('heading', { name: '和 TA 的相处', exact: true })
      .or(page.locator('.group-label').filter({ hasText: '和 TA 的相处' })),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /^人设贴合度/ })).toBeVisible();
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await page.getByRole('link', { name: '我们的记忆', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我们的记忆', exact: true })).toBeVisible();
  const text = '浏览器记忆金丝雀：我的猫叫团子';
  await page.getByRole('button', { name: '添加记忆', exact: true }).click();
  await page
    .getByRole('dialog', { name: '添加记忆', exact: true })
    .getByLabel('记忆内容')
    .fill(text);
  await page
    .getByRole('dialog', { name: '添加记忆', exact: true })
    .getByRole('button', { name: '完成', exact: true })
    .click();
  await page.getByRole('button', { name: new RegExp(text) }).click();
  const editor = page.getByRole('dialog', { name: '编辑记忆', exact: true });
  await expect(editor.getByLabel('记忆内容')).toHaveValue(text);
  await editor.getByLabel('记忆内容').fill('浏览器记忆金丝雀：猫改叫芝麻');
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: /浏览器记忆金丝雀：猫改叫芝麻/ }).click();
  await expect(editor.getByLabel('记忆内容')).toHaveValue('浏览器记忆金丝雀：猫改叫芝麻');
  const cached = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('weiban-app', 1);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('records').objectStore('records').getAll();
          request.onsuccess = () => {
            resolve(JSON.stringify(request.result));
            db.close();
          };
        };
      }),
  );
  expect(cached).not.toContain('浏览器记忆金丝雀');
  await editor.getByRole('button', { name: '删除这条记忆', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除这条记忆？', exact: true })
    .getByRole('button', { name: '删除记忆', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /浏览器记忆金丝雀/ })).toHaveCount(0);
});
