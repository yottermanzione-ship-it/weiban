import { afterEach, expect, it, vi } from 'vitest';
import { releaseVoiceRecorder, startVoiceRecorder } from '../src/features/voice-recorder.js';

afterEach(() => vi.unstubAllGlobals());
const handlers = () => ({ ondataavailable: vi.fn(), onstop: vi.fn(), onerror: vi.fn() });
it('uses the browser default and attaches listeners before starting each fresh recorder', () => {
  const streams = [{}, {}] as MediaStream[];
  const seen: Array<{ stream: MediaStream; options?: MediaRecorderOptions }> = [];
  const listeners = handlers();
  class Recorder {
    static isTypeSupported = () => true;
    state = 'inactive';
    onstop: unknown;
    constructor(stream: MediaStream, options?: MediaRecorderOptions) {
      seen.push({ stream, options });
    }
    start() {
      expect(this.onstop).toBe(listeners.onstop);
      this.state = 'recording';
    }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  expect(startVoiceRecorder(streams[0]!, listeners)).not.toBe(
    startVoiceRecorder(streams[1]!, listeners),
  );
  expect(seen).toEqual(streams.map((stream) => ({ stream, options: undefined })));
});
it('a failing native encoder falls back with new listeners and does not stop the shared live stream', () => {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const created: Recorder[] = [];
  class Recorder {
    static isTypeSupported = (type: string) => type === 'audio/mp4';
    state = 'inactive';
    ondataavailable: unknown;
    onstop: unknown;
    onerror: unknown;
    constructor(
      public stream: MediaStream,
      public options?: MediaRecorderOptions,
    ) {
      created.push(this);
    }
    start() {
      if (!this.options) throw new DOMException('synthetic encoder failure', 'UnknownError');
      this.state = 'recording';
    }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  const listeners = handlers();
  const rec = startVoiceRecorder(stream, listeners);
  expect(created).toHaveLength(2);
  expect(created[0]).toMatchObject({ ondataavailable: null, onstop: null, onerror: null });
  expect(rec).toMatchObject({ options: { mimeType: 'audio/mp4' }, ...listeners });
  expect(stop).not.toHaveBeenCalled();
});
it('does not retry encoders after a security denial', () => {
  const create = vi.fn();
  class Recorder {
    static isTypeSupported = () => true;
    constructor() {
      create();
      throw new DOMException('synthetic denial', 'SecurityError');
    }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  expect(() => startVoiceRecorder({} as MediaStream, handlers())).toThrow('synthetic denial');
  expect(create).toHaveBeenCalledTimes(1);
});
it('releases every microphone track even when stopping an interrupted encoder throws', () => {
  const stop = vi.fn();
  const recorder = {
    ...handlers(),
    state: 'recording',
    stream: { getTracks: () => [{ stop }, { stop }] },
    stop: () => {
      throw new DOMException('already ended', 'InvalidStateError');
    },
  } as unknown as MediaRecorder;
  expect(() => releaseVoiceRecorder(recorder)).toThrow('already ended');
  expect(stop).toHaveBeenCalledTimes(2);
  expect(recorder).toMatchObject({ ondataavailable: null, onstop: null, onerror: null });
});
