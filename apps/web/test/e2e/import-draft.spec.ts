import { expect, test } from '@playwright/test';

test('导入草稿生日、头像、分类保存重读并创建角色；清空后仍为空', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_other');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  const login = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/auth/login');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const token = (await (await login).json()).session.token as string;
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  const jobs = await page.request.get('/api/v1/imports', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(jobs.status()).toBe(200);
  const job = (await jobs.json()).items.find(
    (item: { selectedSpeaker: string }) => item.selectedSpeaker === '导入测试',
  );
  expect(job).toBeTruthy();
  await page.goto(`/characters/custom/new?import=${job.jobId}`);
  await expect(page.getByRole('textbox', { name: /名字/ })).toHaveValue('导入测试');
  await page.getByLabel(/生日/).fill('2000-05-16');
  await page.getByLabel('音色（可选）').selectOption({ label: '浏览器测试音色' });
  await page.getByLabel('真人类型').selectOption('historical');
  await page.getByLabel('外表是儿童').check();
  await page.getByRole('radio', { name: '未满 18 岁', exact: true }).check();
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
  await page.getByRole('button', { name: '完成裁剪并上传', exact: true }).click();
  await expect(page.getByRole('img', { name: '角色头像', exact: true })).toHaveJSProperty(
    'naturalWidth',
    512,
  );
  const save = () =>
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/imports/${job.jobId}/result` &&
        r.request().method() === 'PUT',
    );
  const first = save();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const response = await first;
  expect(response.status()).toBe(200);
  const saved = await response.json();
  expect(saved.editorFields.birthday).toBe('2000-05-16');
  expect(saved.editorFields.avatarMediaId).toBeTruthy();
  expect(saved.editorFields.voiceId).toBeTruthy();
  expect(saved.suggestedClassification.childAppearance).toBe(true);
  expect(saved.suggestedClassification.realPersonKind).toBe('historical');
  await page.reload();
  await expect(page.getByLabel(/生日/)).toHaveValue('2000-05-16');
  await expect(page.getByLabel('音色（可选）')).toHaveValue(saved.editorFields.voiceId);
  await expect(page.getByLabel('外表是儿童')).toBeChecked();
  await expect(page.getByLabel('真人类型')).toHaveValue('historical');
  await expect(page.getByRole('radio', { name: '未满 18 岁', exact: true })).toBeChecked();
  await expect(page.getByRole('img', { name: '角色头像', exact: true })).toHaveJSProperty(
    'naturalWidth',
    512,
  );
  await page.getByLabel(/生日/).fill('');
  await page.getByRole('button', { name: '选择头像', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认头像', exact: true }).click();
  const second = save();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  expect((await second).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel(/生日/)).toHaveValue('');
  await expect(page.getByRole('img', { name: '角色头像', exact: true })).toHaveCount(0);
  const create = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1/characters/custom' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  const created = await create;
  expect(created.status()).toBe(200);
  const role = await created.json();
  expect(role.birthday).toBeNull();
  expect(role.voiceId).toBe(saved.editorFields.voiceId);
  expect(role.avatar.image).toBeNull();
  expect(role.classification.childAppearance).toBe(true);
  expect(role.classification.ageSetting).toBe('minor');
  expect(role.classification.realPersonKind).toBe('historical');
});
