import { expect, test } from '@playwright/test';
import {
  editText,
  loginUser,
  openField,
  setBirthday,
  setDialogue,
  setMinor,
  setTags,
  setVoice,
  uploadAvatar,
} from './persona-ui.js';
const description =
  '这是一个喜欢观察日常生活的原创成年角色，性格温柔而耐心，喜欢晴天散步和阅读，说话自然简洁，尊重他人边界，不编造真实经历。';
test('保存前试聊走真实接口，关闭清理后继续保存同一份编辑字段', async ({ page }) => {
  await page.addInitScript(() => {
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        const element = Reflect.construct(target, args) as HTMLAudioElement;
        Object.assign(window, { weibanTestPreviewAudio: element });
        return element;
      },
    });
  });
  await loginUser(page);
  await page.goto('/characters/custom/new');
  await editText(page, '名字', '保存前试聊测试');
  await editText(page, '人设描述', description);
  const voice = await openField(page, '音色');
  await voice.getByRole('radio', { name: /^浏览器测试音色(?: 已选择)?$/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { weibanTestPreviewAudio?: HTMLAudioElement })
            .weibanTestPreviewAudio?.paused,
      ),
    )
    .toBe(false);
  await voice.getByRole('button', { name: '完成', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { weibanTestPreviewAudio?: HTMLAudioElement })
            .weibanTestPreviewAudio?.paused,
      ),
    )
    .toBe(true);
  await setVoice(page, false);
  await setVoice(page, true);
  const started = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1/characters/custom/trial' &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '试聊', exact: true }).click();
  const response = await started;
  expect(response.status()).toBe(200);
  const selectedVoice = response.request().postDataJSON().voiceId;
  expect(selectedVoice).toBeTruthy();
  const trial = (await response.json()) as { characterId: string; conversationId: string };
  const dialog = page.getByRole('dialog', { name: '和保存前试聊测试试聊', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('试聊消息').fill('试聊消息只在这次会话里');
  const sent = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/v1/conversations/${trial.conversationId}/messages` &&
      r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '发送', exact: true }).click();
  expect((await sent).status()).toBe(200);
  await expect(dialog.getByText('试聊消息只在这次会话里', { exact: false })).toBeVisible();
  const ended = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/api/v1/characters/custom/trial/${trial.conversationId}` &&
      r.request().method() === 'DELETE',
  );
  await dialog.getByRole('button', { name: '结束试聊', exact: true }).click();
  expect((await ended).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  const name = await openField(page, '名字');
  await expect(name.getByRole('textbox', { name: '名字', exact: true })).toHaveValue(
    '保存前试聊测试',
  );
  await name.getByRole('button', { name: '取消', exact: true }).click();
  const persona = await openField(page, '人设描述');
  await expect(persona.getByRole('textbox', { name: '人设描述', exact: true })).toHaveValue(
    description,
  );
  await persona.getByRole('button', { name: '取消', exact: true }).click();
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1/characters/custom' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  const role = (await savedResponse.json()) as { characterId: string };
  expect(savedResponse.request().postDataJSON().voiceId).toBe(selectedVoice);
  expect(role.characterId).not.toBe(trial.characterId);
  await expect(page).toHaveURL(new RegExp(`/characters/${role.characterId}$`));
});
for (const delayedUpload of [false, true]) {
  test(`头像生日真实保存重读，编辑分类和清空字段实际生效${delayedUpload ? '（上传延迟）' : ''}`, async ({
    page,
  }) => {
    if (delayedUpload)
      await page.route(/\/api\/v1\/media(?:\?|$)/, async (route) => {
        if (route.request().method() === 'POST')
          await new Promise((resolve) => setTimeout(resolve, 6_000));
        await route.continue();
      });
    await loginUser(page);
    await page.goto('/characters/custom/new');
    await editText(page, '名字', '完整字段编辑测试');
    await editText(page, '人设描述', description);
    await setBirthday(page, '2000-05-16');
    await setVoice(page, true);
    await setDialogue(page, '我：你好\nTA：今天过得怎样？');
    await setTags(page, 'shy');
    await uploadAvatar(page, delayedUpload);
    const saved = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/v1/characters/custom' &&
        r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '创建角色', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    const role = await response.json();
    expect(role.birthday).toBe('2000-05-16');
    expect(role.voiceId).toBeTruthy();
    expect(role.avatar.image.mediaId).toBeTruthy();
    await page.goto(`/characters/custom/${role.characterId}/edit`);
    await expect(page.getByRole('button', { name: /^生日 / })).toContainText('5');
    const voice = await openField(page, '音色');
    await expect(voice.getByRole('radio', { name: /^浏览器测试音色(?: 已选择)?$/ })).toBeChecked();
    await voice.getByRole('radio', { name: '默认（不指定音色）', exact: true }).click();
    await voice.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.getByRole('img', { name: '角色头像', exact: true })).toHaveJSProperty(
      'naturalWidth',
      512,
    );
    await setMinor(page);
    await setDialogue(page, '');
    await setTags(page, '');
    const updated = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/characters/custom/${role.characterId}` &&
        r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const result = await updated;
    expect(result.status()).toBe(200);
    const value = await result.json();
    expect(value.classification.ageSetting).toBe('minor');
    expect(value.tags).toEqual([]);
    expect(value.exampleDialogue).toBe('');
    expect(value.voiceId).toBeNull();
    expect(value.avatar.image.mediaId).toBe(role.avatar.image.mediaId);
    await page.reload();
    await expect(page.getByRole('button', { name: /^音色 / })).toContainText('默认');
    const age = await openField(page, '年龄设定');
    await expect(age.getByRole('radio', { name: /^未满 18 岁(?: 已选择)?$/ })).toBeChecked();
    await age.getByRole('button', { name: '取消', exact: true }).click();
    const tags = await openField(page, '标签');
    await expect(tags.getByRole('textbox').first()).toHaveValue('');
    await tags.getByRole('button', { name: '取消', exact: true }).click();
    const dialogue = await openField(page, '示例对话');
    await expect(dialogue.getByText('还没有对话，从下面添加第一句', { exact: true })).toBeVisible();
  });
}
