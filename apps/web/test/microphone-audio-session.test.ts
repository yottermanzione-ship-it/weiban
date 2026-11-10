import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function environment() {
  const session = { type: 'auto' };
  const played = vi.fn(async () => {});
  class Audio {
    onended = null;
    onerror = null;
    currentTime = 0;
    preload = '';
    play = played;
    pause = vi.fn();
    removeAttribute = vi.fn();
    load = vi.fn();
    canPlayType = () => 'probably';
  }
  const tracks: Array<{ kind: string; readyState: string; stop(): void }> = [];
  const getUserMedia = vi.fn(async () => {
    // WebKit refuses microphone capture when the page explicitly selected a playback category.
    if (!['auto', 'play-and-record'].includes(session.type))
      throw new DOMException('Synthetic audio-session category conflict', 'InvalidStateError');
    const track = {
      kind: 'audio',
      readyState: 'live',
      stop() {
        this.readyState = 'ended';
      },
    };
    tracks.push(track);
    return { getTracks: () => [track] } as unknown as MediaStream;
  });
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', { audioSession: session, mediaDevices: { getUserMedia } });
  vi.stubGlobal('Audio', Audio);
  return { session, played, tracks, getUserMedia };
}

it('发送提示音之后可以再次申请麦克风，不需要刷新页面', async () => {
  const e = environment();
  const { openMicrophone } = await import('../src/features/microphone.js');
  const { playMessageSound } = await import('../src/features/message-sound.js');
  const first = await openMicrophone();
  first.getTracks().forEach((track) => track.stop());
  playMessageSound();
  expect(e.session.type).toBe('ambient');
  const second = await openMicrophone();
  expect(e.session.type).toBe('auto');
  expect(e.getUserMedia).toHaveBeenCalledTimes(2);
  second.getTracks().forEach((track) => track.stop());
});

it('正在录音时消息与试听提示音不改变声音状态；停止后恢复正常提示音', async () => {
  const e = environment();
  const { openMicrophone } = await import('../src/features/microphone.js');
  const { playMessageSound, previewNoticeSound } = await import('../src/features/message-sound.js');
  const stream = await openMicrophone();
  playMessageSound();
  await previewNoticeSound('iphone');
  expect(e.session.type).toBe('auto');
  expect(e.played).not.toHaveBeenCalled();
  stream.getTracks().forEach((track) => track.stop());
  vi.advanceTimersByTime(300);
  playMessageSound();
  expect(e.session.type).toBe('ambient');
  expect(e.played).toHaveBeenCalledTimes(1);
});

it('等待授权期间也不让提示音切换状态，授权拒绝后释放等待保护且不自动重试', async () => {
  const e = environment();
  let rejectCapture!: (error: Error) => void;
  e.getUserMedia.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectCapture = reject;
      }),
  );
  const { openMicrophone } = await import('../src/features/microphone.js');
  const { playMessageSound } = await import('../src/features/message-sound.js');
  const result = openMicrophone();
  expect(e.getUserMedia).toHaveBeenCalledTimes(1);
  playMessageSound();
  expect(e.session.type).toBe('auto');
  expect(e.played).not.toHaveBeenCalled();
  const check = expect(result).rejects.toHaveProperty('name', 'NotAllowedError');
  rejectCapture(new DOMException('Synthetic permission denial', 'NotAllowedError'));
  await check;
  expect(e.getUserMedia).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(300);
  playMessageSound();
  expect(e.session.type).toBe('ambient');
});

it('关闭一次权限检查不会干扰另一个仍在使用麦克风的通话', async () => {
  const e = environment();
  const { openMicrophone, checkMicrophone } = await import('../src/features/microphone.js');
  const { playMessageSound } = await import('../src/features/message-sound.js');
  const call = await openMicrophone();
  await checkMicrophone();
  playMessageSound();
  expect(e.tracks.map((t) => t.readyState)).toEqual(['live', 'ended']);
  expect(e.played).not.toHaveBeenCalled();
  call.getTracks().forEach((track) => track.stop());
  vi.advanceTimersByTime(300);
  playMessageSound();
  expect(e.played).toHaveBeenCalledTimes(1);
});

it('没有音频会话接口的浏览器仍正常申请麦克风', async () => {
  const e = environment();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: e.getUserMedia } });
  const { checkMicrophone } = await import('../src/features/microphone.js');
  await checkMicrophone();
  expect(e.getUserMedia).toHaveBeenCalledWith({ audio: true });
  expect(e.tracks[0]?.readyState).toBe('ended');
});
