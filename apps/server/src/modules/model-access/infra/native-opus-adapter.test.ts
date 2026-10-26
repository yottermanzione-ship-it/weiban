import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const codec = vi.hoisted(() => ({
  acquire: vi.fn(),
  encode: vi.fn(),
  release: vi.fn(),
  download: vi.fn(),
}));
vi.mock('./native-opus.js', () => ({ acquireNativeOpusEncoder: codec.acquire }));
vi.mock('./dashscope-audio.js', () => ({ downloadDashscopeAudio: codec.download }));
import { OpenAiCompatibleMediaAdapter, withMimoChatAudio } from './media-adapter.js';

function wav(): Buffer {
  const b = Buffer.alloc(9644);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(9600, 40);
  return b;
}
let api: ReturnType<typeof vi.fn>;
const adapter = () => withMimoChatAudio(new OpenAiCompatibleMediaAdapter(async () => true));
const target = (kind = 'openai_compatible', model = 'mimo-v2.5-tts') => ({
  kind,
  model,
  baseUrl: 'https://provider.example/v1',
  apiKey: 'FAKE_ROUTE_TEST_KEY',
});
const input = { text: '你好', voice: 'synthetic', format: 'ogg_opus' as const };
beforeEach(() => {
  vi.clearAllMocks();
  codec.acquire.mockResolvedValue({
    ok: true,
    lease: { encode: codec.encode, release: codec.release },
  });
  // Intentionally fake routing marker, not a claim that these three bytes are a valid Opus file.
  codec.encode.mockResolvedValue(new Uint8Array([1, 2, 3]));
  codec.download.mockResolvedValue(new Uint8Array(wav()));
  api = vi.fn(async () => Response.json({ audio: { data: wav().toString('base64') } }));
  vi.stubGlobal('fetch', api);
});
afterEach(() => vi.unstubAllGlobals());

describe('native TTS -> declared ogg_opus routing', () => {
  it('gets an encoder lease first, requests MiMo WAV/PCM and returns encoded bytes, not the WAV', async () => {
    const result = await adapter().synthesize(target(), input);
    expect(result).toEqual({
      ok: true,
      value: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/ogg', durationMs: 200 },
    });
    expect(codec.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      api.mock.invocationCallOrder[0]!,
    );
    expect(codec.encode).toHaveBeenCalledWith(new Uint8Array(9600));
    expect(JSON.parse((api.mock.calls[0]![1] as RequestInit).body as string).audio).toEqual({
      format: 'wav',
      voice: 'synthetic',
    });
    expect(codec.release).toHaveBeenCalledTimes(1);
  });
  it('also encodes downloaded DashScope audio through the same PCM path', async () => {
    api.mockResolvedValue(
      Response.json({ output: { audio: { url: 'https://fixture.aliyuncs.com/audio.wav' } } }),
    );
    const result = await adapter().synthesize(
      target('dashscope', 'qwen-audio-3.0-tts-plus'),
      input,
    );
    expect(result).toEqual({
      ok: true,
      value: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/ogg', durationMs: 200 },
    });
    expect(codec.download).toHaveBeenCalledTimes(1);
    expect(codec.encode).toHaveBeenCalledWith(new Uint8Array(9600));
    expect(codec.release).toHaveBeenCalledTimes(1);
  });
  it('rejects missing codec without a potentially billable provider request', async () => {
    codec.acquire.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect(await adapter().synthesize(target(), input)).toEqual({
      ok: false,
      category: 'bad_request',
      zeroCost: true,
    });
    expect(api).not.toHaveBeenCalled();
    expect(codec.encode).not.toHaveBeenCalled();
    expect(codec.release).not.toHaveBeenCalled();
  });
  it('reports local saturation without billing or changing provider health', async () => {
    codec.acquire.mockResolvedValue({ ok: false, reason: 'busy' });
    expect(await adapter().synthesize(target(), input)).toEqual({
      ok: false,
      category: 'rate_limited',
      zeroCost: true,
      localRateLimit: true,
    });
    expect(api).not.toHaveBeenCalled();
    expect(codec.release).not.toHaveBeenCalled();
  });
  it('releases the encoder if the provider fails and does not try encoding or another provider', async () => {
    api.mockResolvedValue(Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 }));
    expect(await adapter().synthesize(target(), input)).toEqual({
      ok: false,
      category: 'invalid_key',
    });
    expect(api).toHaveBeenCalledTimes(1);
    expect(codec.encode).not.toHaveBeenCalled();
    expect(codec.release).toHaveBeenCalledTimes(1);
  });
  it('does not claim zero cost or retry when encoding fails after the synthesis', async () => {
    codec.encode.mockRejectedValue(new Error('synthetic encoding error'));
    expect(await adapter().synthesize(target(), input)).toEqual({
      ok: false,
      category: 'provider_error',
    });
    expect(api).toHaveBeenCalledTimes(1);
    expect(codec.encode).toHaveBeenCalledTimes(1);
    expect(codec.release).toHaveBeenCalledTimes(1);
  });
  it('preserves supplier-reported characters when local Opus encoding fails after a billable Qwen synthesis', async () => {
    api.mockResolvedValue(
      Response.json({
        output: { audio: { url: 'https://fixture.aliyuncs.com/audio.wav' } },
        usage: { characters: 10 },
      }),
    );
    codec.encode.mockRejectedValue(new Error('local encoder failed'));
    expect(
      await adapter().synthesize(target('dashscope', 'qwen-audio-3.0-tts-plus'), input),
    ).toEqual({ ok: false, category: 'provider_error', reportedUsage: { ttsChars: 10 } });
    expect(api).toHaveBeenCalledTimes(1);
    expect(codec.release).toHaveBeenCalledTimes(1);
  });

  it('leaves explicit WAV requests on their existing path without reserving an encoder', async () => {
    const result = await adapter().synthesize(target(), { ...input, format: 'wav' });
    expect(result.ok).toBe(true);
    expect(codec.acquire).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.value.mimeType).toBe('audio/wav');
      expect(Buffer.from(result.value.bytes)).toEqual(wav());
    }
  });
});
