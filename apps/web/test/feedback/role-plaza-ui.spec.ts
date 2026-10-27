import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * 角色广场窄屏布局与手动分页的开发自测（真实组件 + 假数据夹具；启动的真实服务只有 Vite，没有后端）。
 * 覆盖：335 / 356 宽下两个 tab 等宽铺满、下划线贴着文字、无横向溢出、切 tab 不位移；
 * 筛选已删除；列表铺满剩余高度；加载行在列表内部；滚到底不自动加载；点一次只取一批、在途再点不会多拉。
 */

type Recorded = { path: string; cursor?: string; limit?: number; sort?: string };

const fixture = (tab: 'official' | 'custom') =>
  `/test/browser-fixtures/role-plaza-ui.html?tab=${tab}`;

const recorded = (page: Page): Promise<Recorded[]> =>
  page.evaluate(() => (window as unknown as { plazaCalls: Recorded[] }).plazaCalls);

const callsOf = (calls: Recorded[], suffix: string) =>
  calls.filter((call) => call.path.endsWith(suffix));

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  expect(rect, `找不到元素：${String(locator)}`).not.toBeNull();
  return rect!;
};

test('两个 tab 在 335 / 356 宽都等宽铺满顶栏、下划线贴着文字，切换不位移', async ({ page }) => {
  const tabs = page.locator('.role-plaza-tabs > button');
  for (const width of [335, 356]) {
    await page.setViewportSize({ width, height: 756 });
    await page.goto(fixture('official'));
    await expect(tabs).toHaveCount(2);

    // 不横向溢出（窄屏要求）
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const first = await box(tabs.nth(0));
    const second = await box(tabs.nth(1));
    const nav = await box(page.locator('.nav-bar'));
    const right = await box(page.locator('.nav-bar-side.end'));
    // 等宽
    expect(Math.abs(first.width - second.width)).toBeLessThanOrEqual(1);
    // 两颗紧接着铺满「返回箭头到个人入口」之间的整段
    expect(Math.abs(first.x + first.width - second.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(second.x + second.width - right.x)).toBeLessThanOrEqual(1);
    expect(first.x).toBeGreaterThan(56 - 1);
    // 点击区够大
    expect(first.height).toBeGreaterThanOrEqual(44);

    // 下划线：跟文字同宽、离文字 4px、不贴顶栏底边
    const label = page.locator(
      '.role-plaza-tabs > button[aria-selected="true"] .role-plaza-tab-label',
    );
    const labelBox = await box(label);
    const underline = await label.evaluate((element) => {
      const style = getComputedStyle(element, '::after');
      return {
        position: style.position,
        left: style.left,
        right: style.right,
        bottom: style.bottom,
        height: style.height,
      };
    });
    expect(underline).toEqual({
      position: 'absolute',
      left: '0px',
      right: '0px',
      bottom: '0px',
      height: '2px',
    });
    expect(await label.evaluate((element) => getComputedStyle(element).paddingBottom)).toBe('4px');
    expect(labelBox.width).toBeLessThan(first.width - 8);
    const navBottom = nav.y + nav.height;
    expect(navBottom - (labelBox.y + labelBox.height)).toBeGreaterThanOrEqual(8);
    // 选中态只变近黑 + 下划线，字重不变（U7）：两颗都继承标题外层 h1 的 500，切换时文字宽度不跳
    expect(await label.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('500');
    const other = page.locator(
      '.role-plaza-tabs > button[aria-selected="false"] .role-plaza-tab-label',
    );
    expect(await other.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('500');

    // 切到自定义角色：个人入口出现，两颗 tab 的位置与宽度不变
    await page.getByRole('tab', { name: '自定义角色' }).click();
    await expect(page.getByRole('link', { name: '我发布的' })).toBeVisible();
    const customFirst = await box(tabs.nth(0));
    const customSecond = await box(tabs.nth(1));
    expect(customFirst.x).toBeCloseTo(first.x, 0);
    expect(customFirst.width).toBeCloseTo(first.width, 0);
    expect(customSecond.width).toBeCloseTo(second.width, 0);

    // 再切回微伴角色：图标消失，位置仍不变（右侧入口位常驻同宽）
    await page.getByRole('tab', { name: '微伴角色' }).click();
    await expect(page.getByRole('link', { name: '我发布的' })).toHaveCount(0);
    const backFirst = await box(tabs.nth(0));
    const backSecond = await box(tabs.nth(1));
    expect(backFirst.x).toBeCloseTo(first.x, 0);
    expect(backSecond.x).toBeCloseTo(second.x, 0);
    expect(backSecond.width).toBeCloseTo(second.width, 0);
  }
});

test('微伴角色：筛选已删除、列表铺满、加载行在列表内部；滚到底不自动加载，点一次只取一批', async ({
  page,
}) => {
  await page.setViewportSize({ width: 335, height: 756 });
  await page.goto(fixture('official'));
  await expect(page.locator('.official-row').first()).toBeVisible();

  // 排序 / 类型 / 分类的筛选控件全部消失；搜索框还在
  await expect(page.locator('.plaza-filter')).toHaveCount(0);
  await expect(page.locator('.plaza-tab-page select')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /排序|全部类型|全部分类|热门/ })).toHaveCount(0);
  await expect(page.getByRole('search')).toHaveCount(1);

  // 请求口径：只看「被用户添加」，不是热门 / 点赞；一次 20 条
  const page1 = callsOf(await recorded(page), '/plaza/official');
  expect(page1).toHaveLength(1);
  expect(page1[0]?.sort).toBe('added');
  expect(page1[0]?.limit).toBe(20);
  expect(page1[0]?.cursor).toBeUndefined();

  // 列表紧接搜索条并铺到屏幕底；没有外部悬着的 pager 按钮、也没有空态占位
  const search = await box(page.locator('.search-strip'));
  const list = await box(page.locator('.virtual-list'));
  expect(list.y).toBeCloseTo(search.y + search.height, 0);
  expect(list.y + list.height).toBeCloseTo(756, 0);
  expect(list.height).toBeGreaterThan(520);
  await expect(page.locator('.pager-row')).toHaveCount(0);
  await expect(page.locator('.plaza-tab-body')).toHaveCount(0);

  // 行的计数不再堆 0：有值才显示
  const metas = await page.locator('.official-row-meta').allInnerTexts();
  expect(metas.length).toBeGreaterThan(0);
  expect(metas.every((text) => !/赞 0(?:$| ·)|评论 0(?:$| ·)/.test(text))).toBe(true);

  // 加载行是列表内部最后一项，而不是列表外面另起的一个按钮
  const endRow = page.locator('.virtual-list [data-row-key="plaza-list-end-row"]');
  await endRow.scrollIntoViewIfNeeded();
  await expect(endRow.locator('.plaza-list-end')).toBeVisible();
  const more = endRow.getByRole('button', { name: '加载更多' });
  await expect(more).toBeVisible();

  // 触底（滚动）不自动加载
  const before = (await recorded(page)).length;
  await page.locator('.virtual-list').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(700);
  expect((await recorded(page)).length).toBe(before);

  // 点一次：在途转圈；在途期间再点同一处不会多拉一批
  const heightBefore = await page
    .locator('.virtual-list')
    .evaluate((element) => element.scrollHeight);
  const moreBox = await box(more);
  await more.click();
  await expect(endRow.locator('.plaza-list-end[role="status"]')).toContainText('正在读取');
  await page.mouse.click(moreBox.x + moreBox.width / 2, moreBox.y + moreBox.height / 2);
  await expect
    .poll(async () => callsOf(await recorded(page), '/plaza/official').length, { timeout: 5000 })
    .toBe(2);
  const page2 = callsOf(await recorded(page), '/plaza/official')[1];
  expect(page2?.cursor).toBe('20');
  expect(page2?.limit).toBe(20);

  // 一批 20 条真的加到列表里了：滚到底能看到第 40 条与「没有更多了」
  await expect
    .poll(async () => page.locator('.virtual-list').evaluate((element) => element.scrollHeight), {
      timeout: 5000,
    })
    .toBeGreaterThan(heightBefore + 1400);
  await page.locator('.virtual-list').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(endRow.locator('.plaza-list-end-done')).toHaveText('没有更多了');
  await expect(page.locator('.official-row-name', { hasText: '微伴40' })).toBeVisible();
  const heightAfter = await page
    .locator('.virtual-list')
    .evaluate((element) => element.scrollHeight);
  expect(heightAfter - heightBefore).toBeGreaterThanOrEqual(1400);
});

test('自定义角色：同样没有筛选、列表铺满，加载行也在列表内部，滚到底不自动加载', async ({
  page,
}) => {
  await page.setViewportSize({ width: 356, height: 756 });
  await page.goto(fixture('custom'));
  await expect(page.getByRole('tab', { name: '自定义角色' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.work-row').first()).toBeVisible();
  await expect(page.locator('.plaza-filter')).toHaveCount(0);
  await expect(page.locator('.pager-row')).toHaveCount(0);

  const works = callsOf(await recorded(page), '/plaza/works');
  expect(works[0]?.sort).toBe('added');
  expect(works[0]?.limit).toBe(20);

  const list = await box(page.locator('.virtual-list'));
  expect(list.y + list.height).toBeCloseTo(756, 0);
  expect(list.height).toBeGreaterThan(520);

  // 行里不堆「赞 0 / 添加 0」
  const metas = await page.locator('.work-row-meta').allInnerTexts();
  expect(metas.length).toBeGreaterThan(0);
  expect(metas.every((text) => !/赞 0(?:$| ·)|添加 0(?:$| ·)/.test(text))).toBe(true);

  const before = (await recorded(page)).length;
  await page.locator('.virtual-list').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(700);
  expect((await recorded(page)).length).toBe(before);

  const endRow = page.locator('.virtual-list [data-row-key="plaza-list-end-row"]');
  await endRow.scrollIntoViewIfNeeded();
  await endRow.getByRole('button', { name: '加载更多' }).click();
  await expect.poll(async () => callsOf(await recorded(page), '/plaza/works').length).toBe(2);
  const page2 = callsOf(await recorded(page), '/plaza/works')[1];
  expect(page2?.cursor).toBe('20');
  await expect
    .poll(async () =>
      page
        .locator('.virtual-list')
        .evaluate((element) => element.scrollHeight)
        .then((height) => height > 2400),
    )
    .toBe(true);
});
