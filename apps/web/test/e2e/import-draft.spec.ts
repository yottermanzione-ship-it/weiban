import { expect, test } from '@playwright/test';
import { openField, setBirthday, setMinor, setVoice, uploadAvatar } from './persona-ui.js';

test('导入草稿生日、头像、分类保存重读并创建角色；清空后仍为空', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_other');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  const login = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/auth/login');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
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
  const name = await openField(page, '名字');
  await expect(name.getByRole('textbox', { name: '名字', exact: true })).toHaveValue('导入测试');
  await name.getByRole('button', { name: '取消', exact: true }).click();
  await setBirthday(page, '2000-05-16');
  await setVoice(page, true);
  const basis = await openField(page, '角色分类');
  await basis.getByRole('radio', { name: /^历史人物(?: 已选择)?$/ }).click();
  await basis.getByRole('button', { name: '完成', exact: true }).click();
  await setMinor(page, true);
  await uploadAvatar(page);
  const save = () =>
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/imports/${job.jobId}/result` &&
        r.request().method() === 'PUT',
    );
  const first = save();
  await page.getByRole('button', { name: /^保存草稿/ }).click();
  const response = await first;
  expect(response.status()).toBe(200);
  const saved = await response.json();
  expect(saved.editorFields.birthday).toBe('2000-05-16');
  expect(saved.editorFields.avatarMediaId).toBeTruthy();
  expect(saved.editorFields.voiceId).toBeTruthy();
  expect(saved.suggestedClassification.childAppearance).toBe(true);
  expect(saved.suggestedClassification.realPersonKind).toBe('historical');
  await page.reload();
  await expect(page.getByRole('button', { name: /^生日 / })).toContainText('5');
  const voice = await openField(page, '音色');
  await expect(voice.getByRole('radio', { name: /^浏览器测试音色(?: 已选择)?$/ })).toBeChecked();
  await voice.getByRole('button', { name: '取消', exact: true }).click();
  const age = await openField(page, '年龄设定');
  await expect(age.getByRole('switch', { name: '外表是儿童', exact: true })).toBeChecked();
  await expect(age.getByRole('radio', { name: /^未满 18 岁(?: 已选择)?$/ })).toBeChecked();
  await age.getByRole('button', { name: '取消', exact: true }).click();
  const classification = await openField(page, '角色分类');
  await expect(classification.getByRole('radio', { name: /^历史人物(?: 已选择)?$/ })).toBeChecked();
  await classification.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('img', { name: '角色头像', exact: true })).toHaveJSProperty(
    'naturalWidth',
    512,
  );
  await setBirthday(page, null);
  await page.getByRole('button', { name: '更换头像', exact: true }).click();
  await page.getByRole('menuitem', { name: '恢复默认头像', exact: true }).click();
  const second = save();
  await page.getByRole('button', { name: /^保存草稿/ }).click();
  expect((await second).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('button', { name: '生日', exact: true })).toBeVisible();
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
