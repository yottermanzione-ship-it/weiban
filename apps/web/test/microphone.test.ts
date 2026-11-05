import { afterEach, expect, it, vi } from 'vitest';
import {
  checkMicrophone,
  microphoneProblem,
  openMicrophone,
  microphoneFailureName,
} from '../src/features/microphone.js';

afterEach(() => vi.unstubAllGlobals());
it('diagnostics keep only fixed exception categories, never arbitrary names or messages', () => {
  expect(microphoneFailureName({ name: 'TypeError', message: 'synthetic private detail' })).toBe(
    'TypeError',
  );
  expect(
    microphoneFailureName({
      name: 'synthetic private detail',
      message: 'synthetic private detail',
    }),
  ).toBe('OtherError');
  expect(microphoneFailureName(null)).toBe('OtherError');
});
it('requests in the caller stack, then stops every track after an access check', async () => {
  const stop = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }, { stop }] }));
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const pending = checkMicrophone();
  expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  await pending;
  expect(stop).toHaveBeenCalledTimes(2);
});
it('does not start capture on an insecure or unsupported page', async () => {
  const getUserMedia = vi.fn();
  vi.stubGlobal('window', { isSecureContext: false });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  await expect(openMicrophone()).rejects.toHaveProperty('name', 'NotSupportedError');
  expect(getUserMedia).not.toHaveBeenCalled();
});
it.each([
  ['NotAllowedError', '麦克风尚未获准使用'],
  ['NotFoundError', '没有找到麦克风'],
  ['NotReadableError', '麦克风暂时无法使用'],
  ['AbortError', '麦克风暂时无法使用'],
  ['NotSupportedError', '当前浏览器不支持录音'],
  ['UnknownError', '录音没有启动'],
  ['EmptyRecordingError', '没有录到声音'],
])('distinguishes %s without pretending every failure is a denial', (name, title) => {
  expect(microphoneProblem(new DOMException('synthetic failure', name)).title).toBe(title);
});
