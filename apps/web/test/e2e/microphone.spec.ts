import { expect, test, type Page } from './fixtures.js';

/** Real app/recorder, synthetic audio source instead of physical hardware; no paid provider. */
async function microphone(page: Page, error: string | null = null) {
  await page.addInitScript((initialError) => {
    const state = { calls: 0, stopped: 0, error: initialError, delay: false, release: () => {} };
    Object.assign(window, { microphoneTest: state });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        state.calls++;
        if (state.error) throw new DOMException('synthetic device failure', state.error);
        if (state.delay)
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const tone = context.createOscillator();
        tone.connect(destination);
        tone.start();
        await context.resume();
        const stream = destination.stream;
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            if (track.readyState !== 'ended') state.stopped++;
            stop();
            tone.disconnect();
            void context.close().catch(() => {});
          };
        }
        return stream;
      },
    });
  }, error);
}
const counts = (page: Page) =>
  page.evaluate(() => {
    const state = (window as unknown as { microphoneTest: { calls: number; stopped: number } })
      .microphoneTest;
    return { calls: state.calls, stopped: state.stopped };
  });
async function allow(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { microphoneTest: { error: string | null } }).microphoneTest.error = null;
  });
}
async function openChat(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('browser_user');
  await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: '同意并登录', exact: true }).click();
  const onboarding = page.getByRole('heading', { name: 'TA 该怎么称呼你？', exact: true });
  await expect(page.getByRole('navigation', { name: '主导航' }).or(onboarding)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page.getByLabel('昵称', { exact: true }).fill('录音测试用户');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: /测试陪伴角色/ }).click();
    await expect(page).toHaveURL(/\/chat\//);
  }
  await page.goto('/chat');
  await page.getByRole('link', { name: /测试陪伴角色/ }).click();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('permissions-onboarded'))).toBe('1');
}

test('旧引导完成后仍可申请麦克风，拒绝后重试成功且取消录音关闭设备', async ({ page }) => {
  await microphone(page, 'NotAllowedError');
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  const dialog = page.getByRole('dialog', { name: '麦克风尚未获准使用' });
  await expect(dialog).toContainText('更新网页不会重置已拒绝的权限');
  expect(await counts(page)).toEqual({ calls: 1, stopped: 0 });
  await allow(page);
  await dialog.getByRole('button', { name: '重新尝试' }).click();
  const hold = page.getByRole('button', { name: '按住说话', exact: true });
  await expect(hold).toBeVisible();
  expect(await counts(page)).toEqual({ calls: 2, stopped: 1 });
  await hold.dispatchEvent('pointerdown', { pointerId: 1, clientY: 800 });
  await expect(page.getByText('手指上滑，取消发送')).toBeVisible();
  await page
    .getByRole('button', { name: '松开发送', exact: true })
    .dispatchEvent('pointercancel', { pointerId: 1 });
  await expect(hold).toBeVisible();
  await expect.poll(() => counts(page)).toEqual({ calls: 3, stopped: 2 });
});

test('设备占用不会误说权限拒绝，设置里可以重新检查并释放设备', async ({ page }) => {
  await microphone(page, 'NotReadableError');
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  await expect(page.getByRole('dialog', { name: '麦克风暂时无法使用' })).toContainText('占用');
  await page.goto('/settings');
  await allow(page);
  await page.getByRole('button', { name: /麦克风权限/ }).click();
  await expect(page.getByRole('dialog', { name: '麦克风可以使用' })).toContainText(
    '不会每次都弹授权框',
  );
  expect(await counts(page)).toEqual({ calls: 1, stopped: 1 });
});

test('等待设备时离开聊天，迟到的录音流也会关闭', async ({ page }) => {
  await microphone(page);
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  await expect(page.getByRole('button', { name: '按住说话', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { microphoneTest: { delay: boolean } }).microphoneTest.delay = true;
  });
  await page
    .getByRole('button', { name: '按住说话', exact: true })
    .dispatchEvent('pointerdown', { pointerId: 1, clientY: 800 });
  await expect.poll(() => counts(page)).toEqual({ calls: 2, stopped: 1 });
  await page.getByRole('link', { name: '聊天信息', exact: true }).click();
  await expect(page.getByRole('button', { name: '按住说话', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { microphoneTest: { release(): void } }).microphoneTest.release();
  });
  await expect.poll(() => counts(page)).toEqual({ calls: 2, stopped: 2 });
});

test('通话按钮先申请麦克风；拒绝时不创建通话', async ({ page }) => {
  let starts = 0;
  await microphone(page, 'NotFoundError');
  await page.route('**/calls/availability?*', (route) =>
    route.fulfill({ json: { available: true, reason: null } }),
  );
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/calls')) starts++;
  });
  await openChat(page);
  await page.getByRole('button', { name: '更多功能' }).click();
  await page.getByRole('button', { name: '语音通话', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '没有找到麦克风' })).toBeVisible();
  expect(await counts(page)).toEqual({ calls: 1, stopped: 0 });
  expect(starts).toBe(0);
});

test('缺少浏览器录音接口时给出真实原因，聊天与设置均可返回', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '当前浏览器不支持录音' })).toBeVisible();
  await expect(page.getByRole('button', { name: '按住说话', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/settings');
  await page.getByRole('button', { name: /麦克风权限/ }).click();
  await expect(page.getByRole('dialog', { name: '当前浏览器不支持录音' })).toBeVisible();
});

async function recordAndSend(page: Page) {
  const upload = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/media?purpose=chat_voice'),
  );
  await page
    .getByRole('button', { name: '按住说话', exact: true })
    .dispatchEvent('pointerdown', { pointerId: 1, clientY: 800 });
  await expect(page.getByText('手指上滑，取消发送')).toBeVisible();
  // Real encoder elapsed time: a sub-second recording is correctly rejected by the product.
  await page.waitForTimeout(1250);
  await page
    .getByRole('button', { name: '松开发送', exact: true })
    .dispatchEvent('pointerup', { pointerId: 1 });
  const response = await upload;
  expect(response.ok()).toBe(true);
  const media = await response.json();
  expect(media.sizeBytes).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '按住说话', exact: true })).toBeVisible();
  return media.mediaId as string;
}

test('连续两条语音均上传并保存，第一条发出后释放设备，刷新仍可看到两条', async ({ page }) => {
  await microphone(page);
  await openChat(page);
  const voices = page.getByRole('button', { name: /^语音 \d+ 秒，播放$/ });
  const before = await voices.count();
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  const first = await recordAndSend(page);
  await expect(voices).toHaveCount(before + 1);
  await expect.poll(() => counts(page)).toEqual({ calls: 2, stopped: 2 });
  const second = await recordAndSend(page);
  expect(second).not.toBe(first);
  await expect(voices).toHaveCount(before + 2);
  await expect.poll(() => counts(page)).toEqual({ calls: 3, stopped: 3 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(voices).toHaveCount(before + 2);
});

test('第二次录音编码器启动失败时换用可用格式，不重复请求麦克风或发送', async ({ page }) => {
  await microphone(page);
  await page.addInitScript(() => {
    const Native = window.MediaRecorder;
    let attempts = 0;
    class Recorder extends Native {
      override start(timeslice?: number) {
        attempts++;
        if (attempts === 2) throw new DOMException('synthetic restart failure', 'UnknownError');
        super.start(timeslice);
      }
    }
    window.MediaRecorder = Recorder;
  });
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  const first = await recordAndSend(page);
  const second = await recordAndSend(page);
  expect(second).not.toBe(first);
  await expect.poll(() => counts(page)).toEqual({ calls: 3, stopped: 3 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('语音自然结束及再次播放后录音，均释放播放器资源且新录音正常发送', async ({ page }) => {
  await microphone(page);
  await page.addInitScript(() => {
    const Native = window.Audio;
    const audios: HTMLAudioElement[] = [];
    Object.assign(window, { capturedPlayback: audios });
    window.Audio = class extends Native {
      constructor(src?: string) {
        super(src);
        // Message notification sounds are separately cached until capture, not voice bubbles.
        if (!src?.startsWith('/assets/old-ui/audio/')) audios.push(this);
      }
    };
  });
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  await recordAndSend(page);
  const voice = page.getByRole('button', { name: /^语音 \d+ 秒，播放$/ }).last();
  await voice.click();
  const playback = () =>
    page.evaluate(() =>
      (window as unknown as { capturedPlayback: HTMLAudioElement[] }).capturedPlayback.map(
        (audio) => ({ src: audio.getAttribute('src'), paused: audio.paused }),
      ),
    );
  await expect.poll(playback).toEqual([{ src: null, paused: true }]);
  await voice.click();
  await expect(page.getByRole('button', { name: /^语音 \d+ 秒，暂停$/ })).toBeVisible();
  await expect.poll(async () => (await playback()).length).toBe(2);
  // Check the real player's state at the exact capture boundary, not only after recording finishes.
  await page.evaluate(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const playing = (window as unknown as { capturedPlayback: HTMLAudioElement[] })
      .capturedPlayback[1];
    playing.loop = true;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      const audios = (window as unknown as { capturedPlayback: HTMLAudioElement[] })
        .capturedPlayback;
      Object.assign(window, {
        playbackAtCapture: audios.map((audio) => ({
          src: audio.getAttribute('src'),
          paused: audio.paused,
        })),
      });
      return capture(constraints);
    };
  });
  await recordAndSend(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { playbackAtCapture: unknown }).playbackAtCapture,
    ),
  ).toEqual([
    { src: null, paused: true },
    { src: null, paused: true },
  ]);
  await expect.poll(() => counts(page)).toEqual({ calls: 3, stopped: 3 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('切到后台取消正在录制的内容并释放设备，返回后能够再录', async ({ page }) => {
  await microphone(page);
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  await page
    .getByRole('button', { name: '按住说话', exact: true })
    .dispatchEvent('pointerdown', { pointerId: 1, clientY: 800 });
  await expect(page.getByText('手指上滑，取消发送')).toBeVisible();
  let uploads = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/media?purpose=chat_voice')) uploads++;
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: '按住说话', exact: true })).toBeVisible();
  await expect.poll(() => counts(page)).toEqual({ calls: 2, stopped: 2 });
  expect(uploads).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await recordAndSend(page);
  expect(uploads).toBe(1);
  await expect.poll(() => counts(page)).toEqual({ calls: 3, stopped: 3 });
});

test('连续录音中全部编码器失败时关闭设备，记录固定分类，手动重试后能发', async ({ page }) => {
  await microphone(page);
  await page.addInitScript(() => {
    const Native = window.MediaRecorder;
    Object.assign(window, { encoderFault: false });
    class Recorder extends Native {
      override start(timeslice?: number) {
        if ((window as unknown as { encoderFault: boolean }).encoderFault)
          throw new DOMException('synthetic-private-detail-not-for-logs', 'UnknownError');
        super.start(timeslice);
      }
    }
    window.MediaRecorder = Recorder;
  });
  await openChat(page);
  await page.getByRole('button', { name: '切换到按住说话' }).click();
  await recordAndSend(page);
  await page.evaluate(() => {
    (window as unknown as { encoderFault: boolean }).encoderFault = true;
  });
  await page
    .getByRole('button', { name: '按住说话', exact: true })
    .dispatchEvent('pointerdown', { pointerId: 1, clientY: 800 });
  const dialog = page.getByRole('dialog', { name: '录音没有启动' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => counts(page)).toEqual({ calls: 3, stopped: 3 });
  const diagnostics = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/client-logs'),
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    (window as unknown as { encoderFault: boolean }).encoderFault = false;
  });
  const batch = (await diagnostics).postDataJSON();
  expect(JSON.stringify(batch)).not.toContain('synthetic-private-detail-not-for-logs');
  expect(
    batch.events.some(
      (event: { kind: string; components?: string[] }) =>
        event.kind === 'js_error' && event.components?.length === 2,
    ),
  ).toBe(true);
  await dialog.getByRole('button', { name: '重新尝试' }).click();
  await recordAndSend(page);
  await expect.poll(() => counts(page)).toEqual({ calls: 5, stopped: 5 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
