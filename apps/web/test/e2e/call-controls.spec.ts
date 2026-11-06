import { expect, test } from './fixtures.js';

test('通话独立控制收听、麦克风和安卓输出，收起位于右上且挂断释放设备', async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      gains: [] as GainNode[],
      tracks: [] as MediaStreamTrack[],
      messages: [] as Record<string, unknown>[],
      route: 'earpiece',
    };
    Object.assign(window, { callControlsTest: state });
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this);
      state.gains.push(gain);
      return gain;
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const ctx = new AudioContext();
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
        return destination.stream;
      },
    });
    const bridge = {
      onmessage: null as null | ((event: { data: string }) => void),
      postMessage(raw: string) {
        const data = JSON.parse(raw) as Record<string, unknown>;
        state.messages.push(data);
        if (data.type === 'speaker') state.route = data.enabled ? 'speaker' : 'earpiece';
        queueMicrotask(() =>
          bridge.onmessage?.({
            data: JSON.stringify({
              id: data.id,
              accepted: true,
              route: state.route,
              canSwitch: true,
            }),
          }),
        );
      },
    };
    Object.assign(window, { weibanDevice: bridge });
  });
  await page.route('**/calls/availability?*', (route) =>
    route.fulfill({ json: { available: true, reason: null } }),
  );
  const callId = '77777777-7777-4777-8777-777777777777';
  const muteFrames: boolean[] = [];
  const frames: string[] = [];
  await page.routeWebSocket(/\/test-call-audio(?:\?|$)/, (socket) => {
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
        socket.send(
          JSON.stringify({ type: 'call.state', data: { state: 'active', durationSec: 1 } }),
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
  await page.getByRole('button', { name: '语音通话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '语音通话', exact: true });
  await expect.poll(() => frames, { timeout: 8000 }).toContain('hello');
  await expect(dialog.getByRole('button', { name: '挂断', exact: true })).toBeVisible();
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
  await dialog.getByRole('button', { name: '对方声音已开', exact: true }).click();
  expect(await audio()).toMatchObject({ gain: 0, enabled: true });
  await dialog.getByRole('button', { name: '麦克风已开', exact: true }).click();
  expect(await audio()).toMatchObject({ gain: 0, enabled: false });
  await expect.poll(() => muteFrames).toContain(true);
  await dialog.getByRole('button', { name: '对方声音已关', exact: true }).click();
  expect(await audio()).toMatchObject({ gain: 1, enabled: false });
  await dialog.getByRole('button', { name: '听筒', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '扬声器', exact: true })).toBeVisible();
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
  expect((await audio()).messages).toContainEqual(
    expect.objectContaining({ type: 'theme', dark: false }),
  );
  await page.getByRole('button', { name: /通话中 00:/ }).click();
  await dialog.getByRole('button', { name: '挂断', exact: true }).click();
  await expect.poll(async () => (await audio()).stopped).toBe(true);
  expect((await audio()).messages).toContainEqual(
    expect.objectContaining({ type: 'end-call', callId }),
  );
});
