import { expect, test } from '@playwright/test';

const fixture = '/test/browser-fixtures/long-press-menu.html';

/**
 * 手机长按的真实顺序：按住 → 菜单弹出 → 抬手（浏览器会补发一次点击，落点正好是刚铺开的遮罩）。
 * 修复前：抬手那一下就把菜单关掉了；修复后菜单必须留着，之后轻点遮罩才关闭。
 */
test('长按弹出的菜单在抬手后不会自己消失', async ({ page }) => {
  await page.goto(fixture);
  const box = (await page.getByTestId('bubble').boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);

  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.getByTestId('scrim')).toBeVisible();
  // 抬手：浏览器会在同一位置补发 click，正好落在遮罩上。
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect(page.getByTestId('scrim')).toBeVisible();

  // 用户随后轻点遮罩：应当关闭，说明只是忽略刚打开那一瞬，不是永远不关。
  await page.waitForTimeout(500);
  await page.mouse.click(20, 700);
  await expect(page.getByTestId('scrim')).toHaveCount(0);
});

/** 右键 / 安卓 contextmenu 同样路径：菜单留到真正轻点遮罩才关闭。 */
test('右键弹出的菜单同样留到下次点击才关闭', async ({ page }) => {
  await page.goto(fixture);
  const box = (await page.getByTestId('bubble').boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.getByTestId('scrim')).toBeVisible();
  await page.waitForTimeout(500);
  await page.mouse.click(x, y, { button: 'right' });
  await page.waitForTimeout(150);
  await expect(page.getByTestId('scrim')).toBeVisible();
  await page.mouse.click(20, 700);
  await expect(page.getByTestId('scrim')).toHaveCount(0);
});
