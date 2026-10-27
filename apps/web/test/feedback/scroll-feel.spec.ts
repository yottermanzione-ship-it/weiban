import { expect, test, type CDPSession, type Page } from '@playwright/test';

/**
 * 滚动手感（管理员 2026-10-25「聊天列表上下滑动卡手」）：
 * 夹具见 test/browser-fixtures/scroll-feel.tsx，挂的是真实 VirtualList / PullMiniApps / useRowGesture。
 * 条件固定：会话列表 300 行 × 72 行高；消息列表 400 行、行高随文本 1～5 行变化；视口 390×844。
 */

const fixture = '/test/browser-fixtures/scroll-feel.html';

type Win = {
  __writes: number[];
  __stable?: string;
  __stableCount?: number;
  __mark?: { key: string; y: number };
  __scrollStats(): { start: number; bottom: number };
  __scrollHooks: {
    prepend(count: number): void;
    append(): void;
    locate(key: string): void;
    keys(): string[];
  };
};

async function patchScrollWrites(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.virtual-list');
    if (!el) throw new Error('缺少 .virtual-list');
    const proto = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    const writes: number[] = [];
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get() {
        return proto.get!.call(el) as number;
      },
      set(value: number) {
        writes.push(value);
        proto.set!.call(el, value);
      },
    });
    (window as unknown as Win).__writes = writes;
  });
}

async function writeCount(page: Page) {
  return page.evaluate(() => (window as unknown as Win).__writes.length);
}

async function clearWrites(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Win).__writes.length = 0;
  });
}

async function state(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.virtual-list')!;
    return { top: el.scrollTop, height: el.clientHeight, scrollHeight: el.scrollHeight };
  });
}

/** 等滚动位置与内容高度连续 3 帧不变（ResizeObserver 量完、程序化补偿已落定）。 */
async function settle(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLElement>('.virtual-list');
      if (!el) return false;
      const win = window as unknown as Win;
      const key = `${el.scrollTop}:${el.scrollHeight}`;
      if (win.__stable === key) win.__stableCount = (win.__stableCount ?? 0) + 1;
      else {
        win.__stable = key;
        win.__stableCount = 0;
      }
      return (win.__stableCount ?? 0) >= 3;
    },
    undefined,
    { polling: 'raf', timeout: 8000 },
  );
}

/** 触摸目标到文档之间，有几层「非被动 touchmove」——每有一层，浏览器就得把滚动降级到主线程。 */
async function blockingTouchMove(cdp: CDPSession, selectors: string[]) {
  const out: Record<string, number> = {};
  for (const selector of selectors) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
    });
    if (!result.objectId) {
      out[selector] = -1;
      continue;
    }
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: result.objectId,
    });
    out[selector] = listeners.filter((l) => l.type === 'touchmove' && l.passive === false).length;
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
  }
  return out;
}

const CHAIN = ['.conv-row', '.swipe-track', '.virtual-list', '.pull-list', '.chat-list-page'];

test('会话列表连续滚动：不写 scrollTop、不跳位', async ({ page }) => {
  await page.goto(`${fixture}?page=conv&rows=300`);
  await expect(page.locator('.conv-row').first()).toBeVisible();
  await patchScrollWrites(page);
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.virtual-list')!;
    const listTop = el.getBoundingClientRect().top;
    const row = Array.from(el.querySelectorAll<HTMLElement>('[data-row-key]')).find(
      (node) => node.getBoundingClientRect().top > listTop + 150,
    )!;
    (window as unknown as Win).__mark = {
      key: row.dataset.rowKey!,
      y: row.getBoundingClientRect().top,
    };
  });
  const before = await state(page);
  const markBefore = await page.evaluate(() => (window as unknown as Win).__mark!.y);
  const box = await page.locator('.virtual-list').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 200);
  for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, 120);
  await settle(page);
  const after = await state(page);
  expect(after.top - before.top).toBeGreaterThan(560);
  expect(await writeCount(page)).toBe(0);

  const marked = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.virtual-list')!;
    const key = (window as unknown as Win).__mark!.key;
    const row = el.querySelector<HTMLElement>(`[data-row-key="${key}"]`);
    return row
      ? { y: row.getBoundingClientRect().top, top: el.scrollTop }
      : { y: null, top: el.scrollTop };
  });
  expect(marked.y).not.toBeNull();
  // 行一直跟着手指走：位移严格等于滚动距离（没有锚点把它拉回或跳走）。
  expect(Math.abs((marked.y as number) - (markBefore - (marked.top - before.top)))).toBeLessThan(2);
});

test('惯性滑动中新行量高：不把列表拽回上一个 scroll 事件的位置', async ({ page }) => {
  // 总经理 10-28「一划只能翻一页、猛地停住、每次切 tab 都这样」：估算行高与真实不一致时，
  // 每批新挂的行量完都会触发一次补偿。惯性滑动在 scroll 事件之后还会继续走，补偿不能按旧锚点写回。
  await page.goto(`${fixture}?page=conv&rows=300&est=60`);
  await expect(page.locator('.conv-row').first()).toBeVisible();
  await settle(page);
  await patchScrollWrites(page);
  // 先一小段一小段往下（每段都在预挂范围内，新行总是从下方挂进来，和连续滑动一样）。
  for (let top = 400; top <= 2000; top += 400) {
    await page.evaluate((value) => {
      const el = document.querySelector<HTMLElement>('.virtual-list')!;
      Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!.set!.call(el, value);
    }, top);
    await settle(page);
  }
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.virtual-list')!;
    const track = el.firstElementChild!;
    const proto = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    let armed = true;
    // 在 VirtualList 自己的量高回调之后、React 提交补偿之前，再往下走一段（等价合成器线程上的惯性）。
    const drift = new ResizeObserver(() => {
      if (!armed) return;
      armed = false;
      proto.set!.call(el, (proto.get!.call(el) as number) + 30);
    });
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of Array.from(record.addedNodes))
          if (node instanceof Element && node.matches('[data-row-key]')) drift.observe(node);
    }).observe(track, { childList: true });
    proto.set!.call(el, 2400);
  });
  await settle(page);
  expect(await writeCount(page)).toBe(0);
  expect((await state(page)).top).toBeGreaterThan(2420);
});

test('会话列表触摸路径没有阻塞主线程的 touchmove；到顶才挂下拉二楼', async ({ page }) => {
  await page.goto(`${fixture}?page=conv&rows=300`);
  await expect(page.locator('.conv-row').first()).toBeVisible();
  const cdp = await page.context().newCDPSession(page);

  await page.locator('.virtual-list').evaluate((el) => {
    el.scrollTop = 400;
  });
  await settle(page);
  const scrolled = await blockingTouchMove(cdp, CHAIN);
  expect(scrolled['.conv-row']).toBe(0);
  expect(scrolled['.swipe-track']).toBe(0);
  expect(scrolled['.pull-list']).toBe(0);

  // 回到最顶：只允许 .pull-list 这一层（下拉要阻止浏览器滚动），行内仍然不能有。
  await page.locator('.virtual-list').evaluate((el) => {
    el.scrollTop = 0;
  });
  await settle(page);
  await expect
    .poll(async () => (await blockingTouchMove(cdp, ['.pull-list']))['.pull-list'], {
      timeout: 3000,
    })
    .toBe(1);
  const topChain = await blockingTouchMove(cdp, CHAIN);
  expect(topChain['.conv-row']).toBe(0);
  expect(topChain['.swipe-track']).toBe(0);
  expect(topChain['.virtual-list']).toBe(0);

  // 到顶时上滑仍然要能正常滚动列表（下拉手势不能抢走竖向滚动）。
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 180, y: 600, id: 1 }],
  });
  for (let y = 560; y >= 360; y -= 40)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 180, y, id: 1 }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(page);
  expect((await state(page)).top).toBeGreaterThan(80);
});

test('可变行高列表 prepend 更早消息：视觉位置不跳动', async ({ page }) => {
  await page.goto(`${fixture}?page=chat&rows=400`);
  await expect(page.locator('.fixture-bubble').first()).toBeVisible();
  await patchScrollWrites(page);
  await settle(page);
  await page.locator('.virtual-list').evaluate((el) => {
    el.scrollTop = 2400;
  });
  await settle(page);
  await clearWrites(page);
  const before = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.virtual-list')!;
    const listTop = el.getBoundingClientRect().top;
    const row = Array.from(el.querySelectorAll<HTMLElement>('[data-row-key]')).find(
      (node) => node.getBoundingClientRect().bottom > listTop + 60,
    )!;
    (window as unknown as Win).__mark = {
      key: row.dataset.rowKey!,
      y: row.getBoundingClientRect().top,
    };
    return { key: row.dataset.rowKey!, y: row.getBoundingClientRect().top, top: el.scrollTop };
  });
  await page.evaluate(() => (window as unknown as Win).__scrollHooks.prepend(60));
  await settle(page);
  const after = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.virtual-list')!;
    const key = (window as unknown as Win).__mark!.key;
    const row = el.querySelector<HTMLElement>(`[data-row-key="${key}"]`);
    return {
      y: row?.getBoundingClientRect().top ?? null,
      top: el.scrollTop,
      mounted: el.querySelectorAll('[data-row-key]').length,
    };
  });
  expect(after.y).not.toBeNull();
  expect(Math.abs((after.y as number) - before.y)).toBeLessThan(2);
  // 补偿是加在 scrollTop 上的：插进来的一批高度要把它顶下去，而不是把内容往下拉。
  expect(after.top - before.top).toBeGreaterThan(1000);
  // 只挂可视区上下缓冲，没有把几百行全塞进 DOM。
  expect(after.mounted).toBeLessThan(80);
});

test('首次到底、新消息跟随；上翻一点后新消息不再把人拉回底部', async ({ page }) => {
  await page.goto(`${fixture}?page=chat&rows=400`);
  await expect(page.locator('.fixture-bubble').first()).toBeVisible();
  await patchScrollWrites(page);
  await settle(page);
  const bottom = async () => {
    const value = await state(page);
    return Math.abs(value.top - (value.scrollHeight - value.height));
  };
  await expect.poll(bottom, { timeout: 5000 }).toBeLessThan(2);

  await clearWrites(page);
  await page.evaluate(() => (window as unknown as Win).__scrollHooks.append());
  await settle(page);
  await expect.poll(bottom, { timeout: 5000 }).toBeLessThan(2);
  expect(await writeCount(page)).toBeGreaterThan(0);

  // 上翻 40 像素（小于 96 的老阈值）后再来新消息：手指停在哪就停在哪。
  await page.locator('.virtual-list').evaluate((el) => {
    el.scrollTop -= 40;
  });
  await settle(page);
  const parked = (await state(page)).top;
  await clearWrites(page);
  await page.evaluate(() => (window as unknown as Win).__scrollHooks.append());
  await settle(page);
  expect(Math.abs((await state(page)).top - parked)).toBeLessThan(2);
  expect(await writeCount(page)).toBe(0);
});

test('搜索定位仍把目标消息放在可视区上三分之一处', async ({ page }) => {
  await page.goto(`${fixture}?page=chat&rows=400`);
  await expect(page.locator('.fixture-bubble').first()).toBeVisible();
  await patchScrollWrites(page);
  await settle(page);
  const key = await page.evaluate(() => {
    const keys = (window as unknown as Win).__scrollHooks.keys();
    return keys[Math.floor(keys.length * 0.5)]!;
  });
  await page.evaluate((target) => (window as unknown as Win).__scrollHooks.locate(target), key);
  await settle(page);
  const spot = await page.evaluate((target) => {
    const el = document.querySelector<HTMLElement>('.virtual-list')!;
    const row = el.querySelector<HTMLElement>(`[data-row-key="${target}"]`);
    if (!row) return null;
    return {
      offset: row.getBoundingClientRect().top - el.getBoundingClientRect().top,
      // 列表有内边距；行是绝对定位在内容盒里的，所以上三分之一线要加上 padding-top。
      third: el.clientHeight / 3 + Number.parseFloat(getComputedStyle(el).paddingTop),
      height: el.clientHeight,
    };
  }, key);
  expect(spot).not.toBeNull();
  // 变高列表里，目标周围的行是滚动到位置后才量出真实高度的，落点有几十像素的修正余量；
  // 这里只守住「仍在可视区上三分之一附近」，不要为了这个数字改坏锚点逻辑。
  expect(Math.abs(spot!.offset - spot!.third)).toBeLessThan(40);
  expect(spot!.offset).toBeGreaterThan(0);
  expect(spot!.offset).toBeLessThan(spot!.height);
});
