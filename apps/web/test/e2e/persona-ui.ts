import { expect, type Page } from '@playwright/test';

export async function loginUser(page: Page, username = 'browser_other') {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

/** Current persona editor: rows open owned subpages; only 完成 writes back to the draft. */
export async function openField(page: Page, title: string) {
  await page
    .locator('.custom-character > .menu-group')
    .getByRole('button', { name: new RegExp(`^${title}(?: |$)`) })
    .click();
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function editText(page: Page, title: string, value: string) {
  const dialog = await openField(page, title);
  await dialog.getByRole('textbox', { name: title, exact: true }).fill(value);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
export async function selectWheelDate(page: Page, title: string, value: string) {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  const [year, month, day] = value.split('-').map(Number);
  for (const [label, text] of [
    ['年', `${year}年`],
    ['月', `${month}月`],
    ['日', `${day}日`],
  ]) {
    const option = dialog
      .getByRole('listbox', { name: label, exact: true })
      .getByRole('option', { name: text, exact: true });
    await option.evaluate((element) => {
      const column = element.parentElement!;
      column.scrollTop =
        Array.from(column.children).indexOf(element) * element.getBoundingClientRect().height;
    });
    await expect(option).toHaveAttribute('aria-selected', 'true');
  }
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
}
export async function setBirthday(page: Page, value: string | null) {
  await page.getByRole('button', { name: /^生日(?: |$)/ }).click();
  const dialog = page.getByRole('dialog', { name: '生日', exact: true });
  if (value) {
    const [year, month, day] = value.split('-').map(Number);
    for (const [label, text] of [
      ['年', `${year}年`],
      ['月', `${month}月`],
      ['日', `${day}日`],
    ]) {
      const option = dialog
        .getByRole('listbox', { name: label, exact: true })
        .getByRole('option', { name: text, exact: true });
      // Drive the wheel's real scroll/settle path; scrollIntoView + click can move the wheel again.
      await option.evaluate((element) => {
        const column = element.parentElement!;
        column.scrollTop =
          Array.from(column.children).indexOf(element) * element.getBoundingClientRect().height;
      });
      await expect(option).toHaveAttribute('aria-selected', 'true');
    }
    await dialog.getByRole('button', { name: '确定', exact: true }).click();
  } else await dialog.getByRole('button', { name: /不设置|不填写|清除/ }).click();
  await expect(dialog).toHaveCount(0);
}
export async function setVoice(page: Page, selected: boolean) {
  const dialog = await openField(page, '音色');
  await dialog
    .getByRole('radio', { name: selected ? '浏览器测试音色' : '默认（不指定音色）', exact: true })
    .click();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
export async function setMinor(page: Page, childAppearance = false) {
  const dialog = await openField(page, '年龄设定');
  await dialog.getByRole('radio', { name: /^未满 18 岁(?: 已选择)?$/ }).click();
  if (childAppearance)
    await dialog.getByRole('switch', { name: '外表是儿童', exact: true }).check();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
}
export async function setTags(page: Page, value: string) {
  const dialog = await openField(page, '标签');
  await dialog.getByRole('textbox').first().fill(value);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
}
export async function setDialogue(page: Page, value: string) {
  const dialog = await openField(page, '示例对话');
  await dialog.getByRole('button', { name: '按原文编辑', exact: true }).click();
  await dialog.getByRole('textbox', { name: '示例对话原文', exact: true }).fill(value);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
}
export async function uploadAvatar(page: Page, delayed = false) {
  await page.getByRole('button', { name: '设置头像', exact: true }).click();
  await page.getByLabel('头像', { exact: true }).setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGqoAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.getContext('2d')?.getImageData(256, 256, 1, 1).data[3] ===
      255,
  );
  const uploaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/v1/media' && r.request().method() === 'POST',
  );
  const metadata = page.waitForResponse(
    (r) =>
      /^\/api\/v1\/media\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '完成', exact: true }).click();
  if (delayed)
    await expect(page.getByRole('button', { name: '创建角色', exact: true })).toBeDisabled();
  const [upload, media] = await Promise.all([uploaded, metadata]);
  expect(upload.status()).toBe(201);
  expect(media.status()).toBe(200);
  const result = await upload.json();
  expect(new URL(media.url()).pathname).toBe(`/api/v1/media/${result.mediaId}`);
  await expect(page.getByRole('img', { name: '角色头像', exact: true })).toHaveJSProperty(
    'naturalWidth',
    512,
  );
}
