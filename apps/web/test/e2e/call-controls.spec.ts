import { expect, test } from './fixtures.js';

// This suite controls call responses; an installed worker must not bypass those routes.
test.use({ serviceWorkers: 'block' });

for (const native of [true, false])
  test(`通话三键与稳定头像：${native ? '安卓实际输出状态' : '网页独立静音'}`, async ({ page }) => {
    await page.addInitScript((native) => {
      const state = {
        gains: [] as GainNode[],
        tracks: [] as MediaStreamTrack[],
        messages: [] as Record<string, unknown>[],
        route: 'earpiece',
        rejectSpeaker: false,
        audioOrder: [] as string[],
      };
      Object.assign(window, { callControlsTest: state });
      const OriginalAudioContext = AudioContext;
      window.AudioContext = new Proxy(OriginalAudioContext, {
        construct(target, args) {
          state.audioOrder.push('output');
          return Reflect.construct(target, args);
        },
      });
      const createGain = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function () {
        const gain = createGain.call(this);
        state.gains.push(gain);
        return gain;
      };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          const ctx = new OriginalAudioContext();
          const destination = ctx.createMediaStreamDestination();
          const oscillator = ctx.createOscillator();
          oscillator.connect(destination);
          oscillator.start();
          await ctx.resume();
          const track = destination.stream.getAudioTracks()[0]!;
          const stop = track.stop.bind(track);
          track.stop = () => {
            stop();
            oscillator.disconnect();
            void ctx.close();
          };
          state.tracks.push(track);
          state.audioOrder.push('microphone-ready');
          return destination.stream;
        },
      });
      const bridge = {
        onmessage: null as null | ((event: { data: string }) => void),
        postMessage(raw: string) {
          const data = JSON.parse(raw) as Record<string, unknown>;
          state.messages.push(data);
          const accepted = data.type !== 'speaker' || !state.rejectSpeaker;
          if (data.type === 'speaker' && accepted)
            state.route = data.enabled ? 'speaker' : 'earpiece';
          queueMicrotask(() =>
            bridge.onmessage?.({
              data: JSON.stringify({
                id: data.id,
                accepted,
                route: state.route,
                canSwitch: true,
              }),
            }),
          );
        },
      };
      if (native) Object.assign(window, { weibanDevice: bridge });
    }, native);
    await page.route('**/calls/availability?*', (route) =>
      route.fulfill({ json: { available: true, reason: null } }),
    );
    const callId = '77777777-7777-4777-8777-777777777777';
    const muteFrames: boolean[] = [];
    const frames: string[] = [];
    let sendFrame: (frame: object) => void = () => {};
    await page.routeWebSocket(/\/test-call-audio(?:\?|$)/, (socket) => {
      sendFrame = (frame) => socket.send(JSON.stringify(frame));
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const frame = JSON.parse(message) as { type: string; data: { muted?: boolean } };
        frames.push(frame.type);
        if (frame.type === 'hello') {
          socket.send(
            JSON.stringify({
              type: 'call.ready',
              data: { callId, outputSampleRate: 24000, serverTime: new Date().toISOString() },
            }),
          );
        }
        if (frame.type === 'mute') muteFrames.push(frame.data.muted!);
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByLabel('账号', { exact: true }).fill('browser_avatar');
    await page.getByLabel('密码', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: '同意并登录', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await page.getByRole('link', { name: /测试陪伴角色/ }).click();
    const conversationId = page.url().split('/chat/')[1]!;
    await page.route('**/api/v1/calls', async (route) => {
      const request = route.request().postDataJSON() as { characterId: string };
      await route.fulfill({
        json: {
          callId,
          characterId: request.characterId,
          conversationId,
          direction: 'outgoing',
          state: 'connecting',
          outcome: null,
          createdAt: new Date().toISOString(),
          answeredAt: null,
          endedAt: null,
          durationSec: 0,
          stream: {
            path: '/test-call-audio',
            token: 'synthetic-stream-token',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        },
      });
    });
    await page.route('**/calls/*/hangup', (route) => route.fulfill({ json: {} }));
    await page.getByRole('button', { name: '更多功能', exact: true }).click();
    await page.evaluate(() => {
      (
        window as unknown as { callControlsTest: { audioOrder: string[] } }
      ).callControlsTest.audioOrder = [];
    });
    await page.getByRole('button', { name: '语音通话', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '语音通话', exact: true });
    await expect.poll(() => frames, { timeout: 8000 }).toContain('hello');
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeVisible();
    const controls = dialog.locator('.wx-call-controls');
    if (native) await expect(controls.getByRole('button')).toHaveCount(3);
    sendFrame({ type: 'call.state', data: { state: 'active', durationSec: 1 } });
    await expect(dialog.getByRole('button', { name: '挂断', exact: true })).toBeVisible();
    const avatar = dialog.locator('.wx-call-avatar');
    const avatarBefore = (await avatar.boundingBox())!;
    for (const speaking of [true, false, true, false]) {
      sendFrame({ type: 'call.agent_speaking', data: { speaking } });
      await expect(dialog.getByLabel('对方正在说话')).toHaveCount(speaking ? 1 : 0);
      const after = (await avatar.boundingBox())!;
      expect(Math.abs(after.y - avatarBefore.y)).toBeLessThan(0.5);
      expect(after.x).toBe(avatarBefore.x);
    }
    await expect(controls.getByRole('button')).toHaveCount(3);
    if (native)
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { callControlsTest: { audioOrder: string[] } }).callControlsTest
              .audioOrder,
        ),
      ).toEqual(['microphone-ready', 'output']);
    const audio = () =>
      page.evaluate(() => {
        const state = (
          window as unknown as {
            callControlsTest: {
              gains: GainNode[];
              tracks: MediaStreamTrack[];
              messages: Record<string, unknown>[];
            };
          }
        ).callControlsTest;
        return {
          gain: state.gains[0]?.gain.value,
          enabled: state.tracks[0]?.enabled,
          stopped: state.tracks[0]?.readyState === 'ended',
          messages: state.messages,
        };
      });
    const mic = dialog.getByRole('button', { name: '麦克风已开', exact: true });
    const onColor = await mic.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
    }));
    expect(onColor).toEqual({ background: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)' });
    await mic.click();
    expect(await audio()).toMatchObject({ gain: 1, enabled: false });
    await expect.poll(() => muteFrames).toContain(true);
    const micOff = dialog.getByRole('button', { name: '麦克风已关', exact: true });
    const offColor = await micOff.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
    }));
    expect(offColor).toEqual({ background: 'rgb(0, 0, 0)', color: 'rgb(255, 255, 255)' });
    if (!native) {
      await dialog.getByRole('button', { name: '扬声器已开', exact: true }).click();
      expect(await audio()).toMatchObject({ gain: 0, enabled: false });
    }
    await micOff.click();
    expect(await audio()).toMatchObject({ gain: native ? 1 : 0, enabled: true });
    await expect.poll(() => muteFrames).toEqual([true, false]);
    if (native) {
      await dialog.getByRole('button', { name: '扬声器已关', exact: true }).click();
      await expect(dialog.getByRole('button', { name: '扬声器已开', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '扬声器已开', exact: true }).click();
      await expect(dialog.getByRole('button', { name: '扬声器已关', exact: true })).toBeVisible();
      await page.evaluate(() => {
        (
          window as unknown as { callControlsTest: { rejectSpeaker: boolean } }
        ).callControlsTest.rejectSpeaker = true;
      });
      await dialog.getByRole('button', { name: '扬声器已关', exact: true }).click();
      await expect(
        page.getByText('当前设备未能切换声音输出，请检查耳机或系统声音设置', { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: '扬声器已关', exact: true })).toBeVisible();
    } else {
      await dialog.getByRole('button', { name: '扬声器已关', exact: true }).click();
      expect(await audio()).toMatchObject({ gain: 1, enabled: true });
      expect((await audio()).messages).toEqual([]);
    }
    const boxes = await controls.getByRole('button').evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect();
        return { x: box.x, y: box.y, label: el.getAttribute('aria-label') };
      }),
    );
    expect(boxes.map((box) => box.label)).toEqual([
      '麦克风已开',
      '挂断',
      native ? '扬声器已关' : '扬声器已开',
    ]);
    expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    await expect(dialog.getByRole('button', { name: /对方声音|声音输出/ })).toHaveCount(0);
    const collapse = dialog.getByRole('button', { name: '收起通话', exact: true });
    const box = (await collapse.boundingBox())!;
    expect(box.x).toBeGreaterThan(300);
    expect(box.y).toBeLessThan(60);
    expect(box.width).toBeLessThanOrEqual(44);
    await page.screenshot({ path: test.info().outputPath('call-controls.png') });
    await page.setViewportSize({ width: 390, height: 560 });
    const hangup = (await dialog.getByRole('button', { name: '挂断', exact: true }).boundingBox())!;
    expect(hangup.y + hangup.height).toBeLessThan(560);
    await collapse.click();
    await expect(dialog).toHaveCount(0);
    if (native)
      expect((await audio()).messages).toContainEqual(
        expect.objectContaining({ type: 'theme', dark: false }),
      );
    await page.getByRole('button', { name: /通话中 00:/ }).click();
    await dialog.getByRole('button', { name: '挂断', exact: true }).click();
    await expect.poll(async () => (await audio()).stopped).toBe(true);
    if (native)
      expect((await audio()).messages).toContainEqual(
        expect.objectContaining({ type: 'end-call', callId }),
      );
  });
