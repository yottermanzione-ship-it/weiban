import { ChatEndpoints } from '@weiban/contracts';
import { expect, test, type Page } from './fixtures.js';
async function openChat(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  const onboarding = page.getByRole('heading', { name: 'TA 该怎么称呼你？', exact: true });
  await expect(page.getByRole('navigation', { name: '主导航' }).or(onboarding)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page.getByLabel('昵称', { exact: true }).fill('浏览器用户');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByText('先加一个你喜欢的 TA 吧')).toBeVisible();
    await page.getByRole('button', { name: /测试陪伴角色/ }).click();
    await expect(page).toHaveURL(/\/chat\//);
  }
  await page.goto('/chat');
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await expect(page.getByRole('heading', { name: '测试陪伴角色' })).toBeVisible();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
}
/** 等到这次发送真正获得批次回执，再检查具有同一服务端 ID 的气泡。 */
async function deliveredBubble(page: Page, text: string, action: () => Promise<void>) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().endsWith('/message-batches') &&
        r
          .request()
          .postDataJSON()
          .items.some((item: { content: { text?: string } }) => item.content.text === text),
    ),
    action(),
  ]);
  expect(response.status()).toBe(200);
  const batch = ChatEndpoints.sendBatch.response.parse(await response.json());
  const ack = batch.items.find(
    ({ message }) => message.content?.type === 'text' && message.content.text === text,
  );
  if (!ack) throw new Error('批次回执缺少本次发送的文字消息');
  const bubble = page.locator(`[data-row-key="${ack.message.messageId}"] .wx-msg-row.mine`);
  await expect(bubble.getByText('已送达', { exact: true })).toBeVisible();
  return bubble;
}
test('角色的聊天记忆可以在手机宽度切换并在刷新后保留', async ({ page }) => {
  await openChat(page);
  await page.getByRole('link', { name: '聊天信息', exact: true }).click();
  const setting = page.getByRole('button', { name: /聊天记忆/ });
  for (const choice of ['近期聊天和摘要', '长期记忆（按模型容量）']) {
    await setting.click();
    await page.getByRole('radio', { name: choice, exact: true }).click();
    await expect(setting).toContainText(choice);
    await page.reload();
    await expect(setting).toContainText(choice);
  }
});
test('连发先显示两个气泡，编辑草稿重置五秒且只提交一次', async ({ page }) => {
  test.slow();
  await openChat(page);
  const composer = page.getByLabel('消息', { exact: true });
  const batches: { at: number; texts: string[] }[] = [];
  const signals: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'POST') return;
    if (r.url().endsWith('/edit-activity')) signals.push(JSON.stringify(r.postDataJSON()));
    if (r.url().endsWith('/message-batches'))
      batches.push({
        at: Date.now(),
        texts: r
          .postDataJSON()
          .items.map((item: { content: { text: string } }) => item.content.text),
      });
  });
  const first = '本地合批甲',
    second = '本地合批乙',
    draft = '尚未发送的第三句';
  await composer.fill(first);
  expect(signals).toHaveLength(0);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.wx-msg-row.mine').filter({ hasText: first })).toBeVisible();
  await composer.fill(second);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.wx-msg-row.mine').filter({ hasText: second })).toBeVisible();
  await page.waitForTimeout(4100);
  const edited = Date.now();
  await composer.fill(draft);
  await composer.press('ArrowLeft');
  await page.waitForTimeout(1000);
  expect(batches).toHaveLength(0);
  await expect.poll(() => batches.length, { timeout: 10_000 }).toBe(1);
  expect(batches[0]!.at - edited).toBeGreaterThanOrEqual(5000);
  expect(batches[0]!.texts).toEqual([first, second]);
  expect(signals.join('')).not.toContain(draft);
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(draft);
});
test('原消息上的回复状态展示、重试和积分入口', async ({ page }) => {
  let target: string | null = null;
  let state: 'failed' | 'retrying' | 'blocked' | 'done' = 'failed';
  const attempts: number[] = [];
  const receipt = () => ({
    messageId: target,
    epoch: state === 'failed' ? 2 : 3,
    state,
    reason: state === 'blocked' ? 'insufficient_balance' : 'provider_unavailable',
    canRetry: state === 'failed',
  });
  await page.route('**/reply-statuses', async (route) => {
    const ids: string[] = route.request().postDataJSON().messageIds;
    await route.fulfill({
      json: { items: target && ids.includes(target) && state !== 'done' ? [receipt()] : [] },
    });
  });
  await page.route('**/messages/*/retry-reply', async (route) => {
    expect(route.request().url()).toContain('/messages/' + target + '/retry-reply');
    attempts.push(route.request().postDataJSON().epoch);
    state = 'retrying';
    await route.fulfill({ json: { issue: receipt() } });
  });
  const refresh = () =>
    page.evaluate((itemId) => {
      window.dispatchEvent(
        new CustomEvent('weiban:update', {
          detail: { type: 'data.changed', data: { section: 'reply_delivery', itemId } },
        }),
      );
    }, target);
  await openChat(page);
  const text = '检查原消息上的角色回复';
  await page.getByLabel('消息', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const original = page.locator('.wx-msg-row.mine').filter({ hasText: text });
  await expect(original.getByText('已送达', { exact: true })).toBeVisible({ timeout: 15000 });
  target = await original.evaluate(
    (row) => row.closest('[data-row-key]')?.getAttribute('data-row-key') ?? null,
  );
  expect(target).toBeTruthy();
  await refresh();
  await original.getByRole('button', { name: '重试角色回复' }).click();
  await expect(original.getByText('正在重新获取角色回复…')).toBeVisible();
  expect(attempts).toEqual([2]);
  state = 'blocked';
  await refresh();
  await expect(original.getByRole('link', { name: '查看积分' })).toHaveAttribute('href', '/wallet');
  await expect(original.getByRole('button', { name: '重试角色回复' })).toHaveCount(0);
  state = 'done';
  await refresh();
  await expect(original.getByRole('status')).toHaveCount(0);
  await expect(original).toHaveCount(1);
});
test('旧网页组件缺少新版取消和行高接口时，仍能登录、收发并重新打开聊天', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
    Reflect.deleteProperty(ResizeObserverEntry.prototype, 'borderBoxSize');
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await openChat(page);
  const text = '较旧网页组件聊天兼容测试';
  await page.getByLabel('消息', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const sent = page.locator('.wx-msg-row.mine').filter({ hasText: text });
  await expect(sent.getByText('已送达', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  await expect(sent).toHaveCount(1);
  await expect(page.getByText('网络异常', { exact: false })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

for (const sameText of [false, true]) {
  test(`本机发送保存尚未完成时，新输入的${sameText ? '同文' : '不同'}草稿保留`, async ({
    page,
  }) => {
    await openChat(page);
    const sent = sameText ? '相同文字也属于下一条草稿' : '保存尚未完成的上一条消息';
    const draft = sameText ? sent : '发送期间输入的新草稿';
    await page.getByLabel('消息', { exact: true }).fill(sent);
    // 用真实读写事务暂时占住本机存储，稳定重现发送保存晚于下一次输入的顺序。
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('weiban-app', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('records', 'readwrite');
            let holding = true;
            (window as Window & { releaseDraftWrite?: () => void }).releaseDraftWrite = () => {
              holding = false;
            };
            const keep = () => {
              tx.objectStore('records').get('draft-test-lock').onsuccess = () => {
                resolve();
                if (holding) keep();
              };
            };
            tx.oncomplete = tx.onabort = () => db.close();
            keep();
          };
        }),
    );
    const release = () =>
      page.evaluate(() => {
        const control = window as Window & { releaseDraftWrite?: () => void };
        control.releaseDraftWrite?.();
        delete control.releaseDraftWrite;
      });
    try {
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
      // 同文也先清空再重新输入，不能只用字符串相等来判断是不是原草稿。
      await page.getByLabel('消息', { exact: true }).fill('');
      await page.getByLabel('消息', { exact: true }).fill(draft);
      await deliveredBubble(page, sent, async () => {
        await release();
        await expect(page.locator('.wx-msg-row.mine').filter({ hasText: sent })).toBeVisible();
        await expect(page.getByLabel('消息', { exact: true })).toHaveValue(draft);
        await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
      });
      await expect(page.getByLabel('消息', { exact: true })).toHaveValue(draft);
    } finally {
      await release();
    }
  });
}

test('六阶段相处弹层：第六级成长进度和六个徽记在亮暗色中可见', async ({ page }, testInfo) => {
  await page.clock.setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
  // 仅将本地合成账号的响应设为第六级；不修改真实用户的等级或绕过业务加分规则。
  await page.route('**/growth/*/familiarity', async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, level: 6, stageName: '伴侣', pointsToNextLevel: null, capReason: null },
    });
  });
  await openChat(page);
  await page.getByRole('link', { name: '聊天信息', exact: true }).click();
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await page.getByRole('button', { name: /第.*天.*伴侣/ }).click();
  const sheet = page.getByRole('dialog', { name: '和 TA 的相处', exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('已经是最高阶段')).toBeVisible();
  await expect(sheet.locator('.level-list li')).toHaveCount(6);
  await expect(sheet.locator('.level-list li[aria-current="true"]')).toContainText('伴侣');
  const colors: string[] = [];
  for (const scheme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.scheme = value;
    }, scheme);
    const color = await sheet
      .locator('.meter > span')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    colors.push(color);
    await testInfo.attach(`familiarity-l6-${scheme}`, {
      body: await sheet.screenshot(),
      contentType: 'image/png',
    });
  }
  expect(colors[0]).not.toBe(colors[1]);
});

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
  const bubble = await deliveredBubble(page, '浏览器实际发送', async () => {
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.wx-bubble').filter({ hasText: '浏览器实际发送' })).toHaveCount(1);
  });
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
  await page.route('**/conversations/*/message-batches', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    ids.push(
      ...route
        .request()
        .postDataJSON()
        .items.map((item: { clientMsgId: string }) => item.clientMsgId),
    );
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
  await expect.poll(() => ids.length, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
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
  await deliveredBubble(page, secret, async () => {
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.wx-bubble').filter({ hasText: secret })).toHaveCount(1);
  });
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
  await page.route('**/contacts/*?mode=reset', (route) => {
    removals.push(route.request().url());
    return route.abort('failed');
  });
  await page.getByRole('button', { name: '重置角色', exact: true }).click();
  await page
    .getByRole('dialog', { name: '重置角色？', exact: true })
    .getByRole('button', { name: '继续', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '再次确认重置', exact: true })).toBeVisible();
  expect(removals).toEqual([]);
  await page
    .getByRole('dialog', { name: '再次确认重置', exact: true })
    .getByRole('button', { name: '重置角色', exact: true })
    .click();
  await expect.poll(() => removals.length).toBe(1);
  expect(removals[0]).toContain('mode=reset');
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
  await page.getByRole('button', { name: '分类：关于我', exact: true }).click();
  await page.getByRole('radio', { name: '偏好', exact: true }).click();
  await expect(page.locator('.action-sheet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '分类：偏好', exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: '添加记忆', exact: true })
    .getByRole('button', { name: '完成', exact: true })
    .click();
  await page.getByRole('button', { name: new RegExp(text) }).click();
  const editor = page.getByRole('dialog', { name: '编辑记忆', exact: true });
  await expect(editor.getByLabel('记忆内容')).toHaveValue(text);
  const done = editor.getByRole('button', { name: '完成', exact: true });
  const currentStatus = editor.getByRole('button', { name: '状态：现在', exact: true });
  await expect(done).toBeDisabled();
  await currentStatus.click();
  await page.getByRole('radio', { name: '现在', exact: true }).click();
  await expect(page.locator('.action-sheet')).toHaveCount(0);
  await expect(done).toBeDisabled();
  await currentStatus.click();
  await page.locator('.action-sheet').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.action-sheet')).toHaveCount(0);
  await expect(currentStatus).toBeVisible();
  await currentStatus.click();
  // 直接点蒙层：label 的默认激活曾在关闭后又点击状态按钮，令弹层原地重开。
  await page.locator('.action-scrim').click({ position: { x: 16, y: 100 } });
  await expect(page.locator('.action-sheet')).toHaveCount(0);
  await expect(editor.getByLabel('记忆内容')).toHaveValue(text);
  await expect(done).toBeDisabled();
  await currentStatus.click();
  await page.getByRole('radio', { name: '过去', exact: true }).click();
  await expect(page.locator('.action-sheet')).toHaveCount(0);
  await expect(done).toBeEnabled();
  await done.click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(text) }).click();
  await editor.getByRole('button', { name: '状态：过去', exact: true }).click();
  await page.getByRole('radio', { name: '现在', exact: true }).click();
  await expect(page.locator('.action-sheet')).toHaveCount(0);
  await editor.getByLabel('记忆内容').fill('浏览器记忆金丝雀：猫改叫芝麻');
  await editor.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: /浏览器记忆金丝雀：猫改叫芝麻/ }).click();
  await expect(editor.getByLabel('记忆内容')).toHaveValue('浏览器记忆金丝雀：猫改叫芝麻');
  await expect(currentStatus).toBeVisible();
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
test('角色动态跟随生态开关，切换后返回即生效，历史仍可见', async ({ page }) => {
  let roleOn = false;
  let legacyDaily = true;
  let finishSave!: () => void;
  const saving = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  let accountOn = true;
  let paused = false;
  let eligible = true;
  let unavailable = false;
  await page.route('**/companion-settings', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), dailyLife: legacyDaily } });
  });
  await page.route('**/me/ecology', async (route) => {
    if (unavailable) return route.fulfill({ status: 503 });
    const response = await route.fetch();
    const settings = await response.json();
    await route.fulfill({
      response,
      json: {
        ...settings,
        enabled: accountOn,
        eligible,
        pausedReason: paused ? 'insufficient_balance' : null,
        characters: settings.characters.map((c: { characterId: string }) => ({
          ...c,
          enabled: roleOn,
        })),
      },
    });
  });
  await page.route('**/me/ecology/characters/*', async (route) => {
    expect(route.request().method()).toBe('PUT');
    await saving;
    roleOn = route.request().postDataJSON().enabled;
    await route.fulfill({
      json: {
        characterId: new URL(route.request().url()).pathname.split('/').pop(),
        enabled: roleOn,
      },
    });
  });
  await page.route('**/timeline?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            entryId: '00000000-0000-4000-8000-000000000011',
            occurredAt: '2026-10-05T08:00:00Z',
            source: 'daily_event',
            kind: 'rest',
            moodAfter: null,
            summary: '合成历史日常',
            withCharacterIds: [],
            ref: null,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await openChat(page);
  await page.getByRole('link', { name: '聊天信息', exact: true }).click();
  const timeline = page
    .getByRole('main')
    .filter({ has: page.getByRole('heading', { name: 'TA 的动态', exact: true }) });
  const history = timeline.getByRole('listitem').getByText('合成历史日常', { exact: true });
  const openTimeline = async () => {
    await page.getByRole('link', { name: /测试陪伴角色/ }).click();
    const status = page.waitForResponse((r) => r.url().endsWith('/me/ecology'));
    await page.getByRole('link', { name: /TA 的动态/ }).click();
    await status;
    await expect(history).toBeVisible();
  };
  await openTimeline();
  const notice = timeline.locator('.inline-tip');
  await expect(notice).toContainText('TA 未参与角色生态');
  await page.getByRole('link', { name: '查看生态设置' }).click();
  const toggle = page.getByRole('switch', { name: 'TA 参与角色生态' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  legacyDaily = false;
  // 用户在保存回包前就离开设置页。回包后当前动态页应自动更新。
  await openTimeline();
  await expect(notice).toContainText('TA 未参与角色生态');
  finishSave();
  await expect(notice).toHaveCount(0);

  // 来自账号的限制优先展示具体原因；读取失败时避免继续显示上次的关闭提示。
  const revisit = async () => {
    await timeline.getByRole('button', { name: '返回' }).click();
    const response = page.waitForResponse((r) => r.url().endsWith('/me/ecology'));
    await page.getByRole('link', { name: /TA 的动态/ }).click();
    await response;
    await expect(history).toBeVisible();
  };
  roleOn = false;
  accountOn = false;
  await revisit();
  await expect(notice).toContainText('角色生态尚未开启');
  await expect(notice.getByRole('link')).toHaveAttribute('href', '/services/ecology');
  accountOn = true;
  paused = true;
  await revisit();
  await expect(notice).toContainText('积分不足');
  eligible = false;
  await revisit();
  await expect(notice).toContainText('PRO+');
  unavailable = true;
  await revisit();
  await expect(notice).toHaveCount(0);
});
