import { afterEach, expect, it, vi } from 'vitest';
import { registerPlaybackStop, releaseAudioPlayback } from '../src/features/audio-playback.js';
import { checkMicrophone } from '../src/features/microphone.js';
afterEach(() => vi.unstubAllGlobals());

it('switches from app playback to capture in the same gesture and releases the output resource', async () => {
  const order: string[] = [];
  const audio = {
    onended: vi.fn(),
    onerror: vi.fn(),
    pause: () => order.push('pause'),
    removeAttribute: (name: string) => order.push(`remove:${name}`),
    load: () => order.push('release-output'),
  } as unknown as HTMLAudioElement;
  const remove = registerPlaybackStop(() => releaseAudioPlayback(audio));
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(() => {
        order.push('capture');
        return Promise.resolve({ getTracks: () => [{ stop: () => order.push('stop-track') }] });
      }),
    },
  });
  try {
    const result = checkMicrophone();
    expect(order).toEqual(['pause', 'remove:src', 'release-output', 'capture']);
    await result;
    expect(order.at(-1)).toBe('stop-track');
    expect(audio.onended).toBeNull();
    expect(audio.onerror).toBeNull();
  } finally {
    remove();
  }
});
