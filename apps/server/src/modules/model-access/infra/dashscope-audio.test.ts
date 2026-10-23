import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', async (original) => ({
  ...(await original<typeof import('node:dns/promises')>()),
  lookup: network.lookup,
}));
vi.mock('node:https', async (original) => ({
  ...(await original<typeof import('node:https')>()),
  request: network.request,
}));
import { downloadDashscopeAudio, dashscopeAudioUrl } from './dashscope-audio.js';
import { OpenAiCompatibleMediaAdapter, withMimoChatAudio } from './media-adapter.js';

const AUDIO_URL = 'https://audio-test.oss-cn-hangzhou.aliyuncs.com/out.wav?token=fixture';
const KEY = 'FAKE_DASHSCOPE_AUDIO_TEST_KEY';
function wav(rate = 24_000, samples = 4800): Buffer {
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);
  return b;
}
let status: number;
let headers: Record<string, string>;
let chunks: Buffer[];
let audioUrl: string;
let api: ReturnType<typeof vi.fn>;
let connectError: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  status = 200;
  headers = { 'content-type': 'audio/wav' };
  chunks = [wav()];
  audioUrl = AUDIO_URL;
  connectError = false;
  network.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
  network.request.mockImplementation(
    (_url: URL, _options: RequestOptions, reply: (r: IncomingMessage) => void) => {
      const req = Object.assign(new EventEmitter(), {
        end() {
          queueMicrotask(() => {
            if (connectError) {
              req.emit('error', new Error('synthetic transport failure'));
              return;
            }
            const stream = Object.assign(Readable.from(chunks), { statusCode: status, headers });
            reply(stream as unknown as IncomingMessage);
          });
          return req;
        },
      });
      return req;
    },
  );
  api = vi.fn(async () => Response.json({ output: { audio: { url: audioUrl } } }));
  vi.stubGlobal('fetch', api);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const synthesize = (format: 'wav' | 'pcm16_24k' = 'wav') =>
  withMimoChatAudio(new OpenAiCompatibleMediaAdapter(async () => true)).synthesize(
    {
      kind: 'dashscope',
      model: 'qwen-audio-3.0-tts-plus',
      baseUrl: 'https://dashscope.example/api/v1',
      apiKey: KEY,
    },
    { text: '你好', voice: 'Cherry', format },
  );

describe('DashScope provider-returned audio download', () => {
  it('really returns downloaded WAV bytes through the native synthesize path', async () => {
    const result = await synthesize();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.from(result.value.bytes)).toEqual(wav());
    expect(result.value.mimeType).toBe('audio/wav');
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toBe(
      'https://dashscope.example/api/v1/services/audio/tts/SpeechSynthesizer',
    );
    expect(network.request).toHaveBeenCalledTimes(1);
  });

  it('returns the expected 24kHz PCM bytes and measured duration', async () => {
    const result = await synthesize('pcm16_24k');
    expect(result).toEqual({
      ok: true,
      value: { bytes: new Uint8Array(9600), mimeType: 'audio/L16', durationMs: 200 },
    });
  });

  it('pins the inspected public A record while preserving hostname certificate checks', async () => {
    await downloadDashscopeAudio(AUDIO_URL);
    expect(network.lookup).toHaveBeenCalledWith('audio-test.oss-cn-hangzhou.aliyuncs.com', {
      all: true,
      family: 4,
    });
    const options = network.request.mock.calls[0]![1] as RequestOptions;
    expect(options).toMatchObject({
      family: 4,
      servername: 'audio-test.oss-cn-hangzhou.aliyuncs.com',
      agent: false,
    });
    const callback = vi.fn();
    const pinned = options.lookup as (host: string, options: object, cb: typeof callback) => void;
    pinned('audio-test.oss-cn-hangzhou.aliyuncs.com', { family: 4 }, callback);
    expect(callback).toHaveBeenCalledWith(null, '1.1.1.1', 4);
    expect(network.lookup).toHaveBeenCalledTimes(1);
  });

  it('does not forward provider Authorization or cookies to the audio CDN', async () => {
    await synthesize();
    const options = network.request.mock.calls[0]![1] as RequestOptions;
    expect(options.headers).toEqual({ Accept: 'audio/wav, application/octet-stream' });
    expect(JSON.stringify(options)).not.toContain(KEY);
  });

  it('rejects credentials, private hosts, misleading suffixes, non-HTTPS and nonstandard ports before DNS', async () => {
    for (const raw of [
      'http://cdn.aliyuncs.com/a.wav',
      'https://127.0.0.1/a.wav',
      'https://a.aliyuncs.com.evil.example/a.wav',
      'https://a.aliyuncs.com:8443/a.wav',
      'https://user:password@a.aliyuncs.com/a.wav',
      'https://a.aliyuncs.com/a.wav#fragment',
      'invalid',
    ]) {
      expect(dashscopeAudioUrl(raw)).toBeNull();
      await expect(downloadDashscopeAudio(raw)).rejects.toThrow('DASHSCOPE_AUDIO_URL_REJECTED');
    }
    expect(network.lookup).not.toHaveBeenCalled();
    expect(network.request).not.toHaveBeenCalled();
  });

  it('refuses private, loopback, metadata, CGNAT and documentation A records', async () => {
    for (const address of [
      '0.1.2.3',
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '100.64.0.1',
      '192.0.2.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
    ]) {
      network.lookup.mockResolvedValue([{ address, family: 4 }]);
      await expect(downloadDashscopeAudio(AUDIO_URL)).rejects.toThrow(
        'DASHSCOPE_AUDIO_ADDRESS_REJECTED',
      );
    }
    expect(network.request).not.toHaveBeenCalled();
  });

  it('refuses mixed public/private records and IPv6-only results instead of using an unsafe fallback', async () => {
    for (const addresses of [
      [],
      [
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
      [{ address: '::1', family: 6 }],
    ]) {
      network.lookup.mockResolvedValue(addresses);
      await expect(downloadDashscopeAudio(AUDIO_URL)).rejects.toThrow(
        'DASHSCOPE_AUDIO_ADDRESS_REJECTED',
      );
    }
    expect(network.request).not.toHaveBeenCalled();
  });

  it('never follows a CDN redirect to another or private address', async () => {
    status = 302;
    headers.location = 'http://169.254.169.254/latest/meta-data/';
    expect(await synthesize()).toEqual({ ok: false, category: 'provider_error' });
    expect(network.request).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized declared lengths before reading the audio', async () => {
    headers['content-length'] = '12000001';
    await expect(downloadDashscopeAudio(AUDIO_URL)).rejects.toThrow(
      'DASHSCOPE_AUDIO_RESPONSE_REJECTED',
    );
  });

  it('bounds streamed audio even when Content-Length is absent', async () => {
    chunks = [Buffer.alloc(12_000_000), Buffer.alloc(1)];
    await expect(downloadDashscopeAudio(AUDIO_URL)).rejects.toThrow('DASHSCOPE_AUDIO_SIZE_LIMIT');
  });

  it('does not call a CDN authentication error an invalid provider key or a zero-cost synthesis', async () => {
    status = 403;
    const result = await synthesize();
    expect(result).toEqual({ ok: false, category: 'provider_error' });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('rejects an HTML body masquerading as a successful WAV response', async () => {
    chunks = [Buffer.from('<html>' + 'not audio'.repeat(10) + '</html>')];
    expect(await synthesize()).toEqual({ ok: false, category: 'provider_error' });
  });

  it('does not retry a download after the synthesis POST has succeeded', async () => {
    connectError = true;
    expect(await synthesize()).toEqual({ ok: false, category: 'provider_error' });
    expect(api).toHaveBeenCalledTimes(1);
    expect(network.request).toHaveBeenCalledTimes(1);
  });

  it('includes DNS resolution in the single overall timeout', async () => {
    vi.useFakeTimers();
    network.lookup.mockImplementation(() => new Promise(() => {}));
    const pending = expect(downloadDashscopeAudio(AUDIO_URL)).rejects.toThrow(
      'DASHSCOPE_AUDIO_TIMEOUT',
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(network.request).not.toHaveBeenCalled();
  });
});
