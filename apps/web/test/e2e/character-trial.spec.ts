import { expect, test } from '@playwright/test';

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
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_other');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/characters/custom/new');
  await page.getByRole('textbox', { name: '名字', exact: true }).fill('保存前试聊测试');
  const description =
    '这是一个喜欢观察日常生活的原创成年角色，性格温柔而耐心，喜欢晴天散步和阅读，说话自然简洁，尊重他人边界，不编造真实经历。';
  await page.getByLabel(/人设描述/).fill(description);
  await page.getByLabel('音色（可选）').selectOption({ label: '浏览器测试音色' });
  const selectedVoice = await page.getByLabel('音色（可选）').inputValue();
  await page.getByRole('button', { name: '试听音色', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { weibanTestPreviewAudio?: HTMLAudioElement })
            .weibanTestPreviewAudio?.paused,
      ),
    )
    .toBe(false);
  await page.getByLabel('音色（可选）').selectOption('');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { weibanTestPreviewAudio?: HTMLAudioElement })
            .weibanTestPreviewAudio?.paused,
      ),
    )
    .toBe(true);
  await page.getByLabel('音色（可选）').selectOption({ label: '浏览器测试音色' });
  const started = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1/characters/custom/trial' &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存前试聊', exact: true }).click();
  const response = await started;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().voiceId).toBe(selectedVoice);
  const trial = (await response.json()) as { characterId: string; conversationId: string };
  const dialog = page.getByRole('dialog', { name: '角色试聊' });
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
  await dialog.getByRole('button', { name: '结束试聊，返回编辑' }).click();
  expect((await ended).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '名字', exact: true })).toHaveValue(
    '保存前试聊测试',
  );
  await expect(page.getByLabel(/人设描述/)).toHaveValue(description);
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

test('头像生日真实保存重读，编辑分类和清空字段实际生效', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('微伴号').fill('browser_other');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await page.goto('/characters/custom/new');
  await page.getByRole('textbox', { name: '名字', exact: true }).fill('完整字段编辑测试');
  await page
    .getByLabel(/人设描述/)
    .fill(
      '这是一位喜欢观察日常生活的原创成年角色，性格温柔耐心，喜欢晴天散步和读书，说话自然简短，尊重别人边界，不编造真实经历。',
    );
  await page.getByLabel(/生日/).fill('2000-05-16');
  await page.getByLabel('音色（可选）').selectOption({ label: '浏览器测试音色' });
  const selectedVoice = await page.getByLabel('音色（可选）').inputValue();
  await page.getByLabel(/示例对话/).fill('我：你好\nTA：今天过得怎样？');
  await page.getByLabel(/标签/).fill('shy');
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
  const saved = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1/characters/custom' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const role = (await response.json()) as {
    characterId: string;
    birthday: string;
    voiceId: string;
    avatar: { image: { mediaId: string } };
  };
  expect(role.birthday).toBe('2000-05-16');
  expect(role.voiceId).toBe(selectedVoice);
  expect(role.avatar.image.mediaId).toBeTruthy();
  await page.goto(`/characters/custom/${role.characterId}/edit`);
  await expect(page.getByLabel(/生日/)).toHaveValue('2000-05-16');
  await expect(page.getByLabel('音色（可选）')).toHaveValue(selectedVoice);
  await page.getByLabel('音色（可选）').selectOption('');
  await expect(page.getByRole('img', { name: '角色头像', exact: true })).toHaveJSProperty(
    'naturalWidth',
    512,
  );
  await page.getByRole('radio', { name: '未满 18 岁', exact: true }).check();
  await page.getByLabel(/示例对话/).fill('');
  await page.getByLabel(/标签/).fill('');
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
  await expect(page.getByLabel('音色（可选）')).toHaveValue('');
  await expect(page.getByRole('radio', { name: '未满 18 岁', exact: true })).toBeChecked();
  await expect(page.getByLabel(/标签/)).toHaveValue('');
  await expect(page.getByLabel(/示例对话/)).toHaveValue('');
});
