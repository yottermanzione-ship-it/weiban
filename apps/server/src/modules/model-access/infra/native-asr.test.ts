import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNativeAsrModel, nativeAsr } from './native-asr.js';
import type { MediaTarget } from './media-adapter.js';

// Entirely synthetic protocol fixtures; no sockets, real keys, decoding or vendor calls.
const KEY = 'OFFLINE_ASR_SYNTHETIC_KEY';
const MODEL = 'qwen3-asr-flash';
const fetchMock = vi.fn<typeof fetch>();
const target = (overrides: Partial<MediaTarget> = {}): MediaTarget => ({
  kind: 'dashscope',
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  apiKey: KEY,
  model: MODEL,
  ...overrides,
});
function wav(size = 364): Buffer {
  const out = Buffer.alloc(size);
  out.write('RIFF');
  out.writeUInt32LE(size - 8, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16_000, 24);
  out.writeUInt32LE(32_000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(size - 44, 40);
  return out;
}
const input = () => ({ bytes: wav(), mimeType: 'audio/wav' });
function payload(text = '你好，微伴。', seconds: unknown = 1.25) {
  return {
    request_id: 'synthetic-request',
    output: { choices: [{ message: { role: 'assistant', content: [{ text }] } }] },
    usage: { seconds, audio_tokens: 999, text_tokens: 123 },
  };
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const localRejection = { ok: false, category: 'bad_request', zeroCost: true };
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json(payload()));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('native ASR model routing is fail closed', () => {
  it.each([
    'qwen3-asr-flash',
    'qwen3-asr-flash-2025-09-08',
    'qwen-audio-3.1-asr-flash',
    'qwen-audio-3.0-asr-flash-streaming',
    'qwen3-asr-flash-filetrans',
    'qwen3-asr-flash-realtime',
    'mimo-v2.5-asr',
  ])('intercepts %s without claiming every family member is enabled', (model) => {
    expect(isNativeAsrModel(model)).toBe(true);
  });
  it.each(['whisper-1', 'FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR', 'qwen3-tts-flash'])(
    'leaves unrelated/compatible model %s untouched',
    (model) => {
      expect(isNativeAsrModel(model)).toBe(false);
    },
  );
  it.each([
    'qwen-audio-3.1-asr-flash',
    'qwen-audio-3.1-asr-flash-message',
    'qwen-audio-3.0-asr-flash',
    'qwen3-asr-flash-filetrans',
    'qwen3-asr-flash-realtime',
    'qwen3-asr-flash-2099-01-01',
    'mimo-v2.5-asr',
  ])('refuses unsupported model %s before any potentially billable POST', async (model) => {
    expect(await nativeAsr(target({ model }), input())).toEqual(localRejection);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not override an explicitly OpenAI-compatible Qwen account', async () => {
    expect(await nativeAsr(target({ kind: 'openai_compatible' }), input())).toEqual(localRejection);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('DashScope synchronous ASR protocol', () => {
  it('uses the documented native path and an inline audio-only request, preserving real seconds', async () => {
    const audio = input();
    expect(await nativeAsr(target(), audio)).toEqual({
      ok: true,
      value: { text: '你好，微伴。', asrSeconds: 1.25 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      model: MODEL,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ audio: `data:audio/wav;base64,${audio.bytes.toString('base64')}` }],
          },
        ],
      },
      parameters: { asr_options: { enable_itn: false } },
    });
    expect(String(init?.body)).not.toContain(KEY);
    expect(String(url)).not.toContain(KEY);
  });
  it.each(['qwen3-asr-flash-2025-09-08', 'qwen3-asr-flash-2026-02-10'])(
    'enables only the explicitly verified snapshot %s',
    async (model) => {
      expect((await nativeAsr(target({ model }), input())).ok).toBe(true);
    },
  );
  it.each([
    'https://dashscope-intl.aliyuncs.com/api/v1/',
    'https://synthetic-workspace.cn-beijing.maas.aliyuncs.com/api/v1',
  ])('accepts the verified native base %s', async (baseUrl) => {
    expect((await nativeAsr(target({ baseUrl }), input())).ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      '/api/v1/services/aigc/multimodal-generation/generation',
    );
  });
  it.each([undefined, null, -1, '1.25', 301])(
    'does not invent usage for invalid/missing seconds %s',
    async (seconds) => {
      const out = payload();
      out.usage.seconds = seconds;
      fetchMock.mockResolvedValue(json(out));
      expect(await nativeAsr(target(), input())).toEqual({
        ok: true,
        value: { text: '你好，微伴。' },
      });
    },
  );
  it('preserves reported zero seconds and empty silence transcripts without estimating from bytes', async () => {
    fetchMock.mockResolvedValue(json(payload('', 0)));
    expect(await nativeAsr(target(), input())).toEqual({
      ok: true,
      value: { text: '', asrSeconds: 0 },
    });
  });
  it.each([
    { text: 'not the native response' },
    { choices: [{ message: { content: 'not the native response' } }] },
    { output: null },
    { output: { choices: 'not an array' } },
    { output: { choices: [{ message: { content: [{ text: 42 }] } }] } },
  ])('rejects malformed or compatible response shapes without retry/fallback', async (out) => {
    fetchMock.mockResolvedValue(json(out));
    expect(await nativeAsr(target(), input())).toEqual({ ok: false, category: 'provider_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not silently truncate an oversized transcript', async () => {
    fetchMock.mockResolvedValue(json(payload('字'.repeat(4001))));
    expect(await nativeAsr(target(), input())).toEqual({ ok: false, category: 'provider_error' });
  });
  it('reports malformed JSON as a provider failure, not a free retry', async () => {
    fetchMock.mockResolvedValue(new Response(`not JSON ${KEY}`));
    expect(await nativeAsr(target(), input())).toEqual({ ok: false, category: 'provider_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('bounded native ASR input and endpoint validation', () => {
  it.each([
    'http://dashscope.aliyuncs.com/api/v1',
    'https://127.0.0.1/api/v1',
    'https://dashscope.aliyuncs.com.evil.test/api/v1',
    'https://dashscope.aliyuncs.com:444/api/v1',
    'https://user:password@dashscope.aliyuncs.com/api/v1',
    'https://dashscope.aliyuncs.com/api/v1?key=secret',
    'https://dashscope.aliyuncs.com/api/v1#fragment',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://unverified.us-east-1.maas.aliyuncs.com/api/v1',
  ])('rejects unsupported/unsafe base %s before sending the key', async (baseUrl) => {
    expect(await nativeAsr(target({ baseUrl }), input())).toEqual(localRejection);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    'audio/L16',
    'audio/pcm',
    'video/mp4',
    'application/octet-stream',
    'audio/wav;url=https://evil.test',
  ])('rejects non-whitelisted MIME %s', async (mimeType) => {
    expect(await nativeAsr(target(), { ...input(), mimeType })).toEqual(localRejection);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires a matching container signature, not just a MIME label', async () => {
    expect(
      await nativeAsr(target(), {
        bytes: Buffer.from('https://evil.test/private'),
        mimeType: 'audio/wav',
      }),
    ).toEqual(localRejection);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects empty/oversized inputs before Base64 encoding or contacting a provider', async () => {
    expect(await nativeAsr(target(), { bytes: new Uint8Array(), mimeType: 'audio/wav' })).toEqual(
      localRejection,
    );
    expect(
      await nativeAsr(target(), { bytes: new Uint8Array(7_000_001), mimeType: 'audio/wav' }),
    ).toEqual(localRejection);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['', 'synthetic\r\nInjected: header'])(
    'rejects an unusable key without sending it',
    async (apiKey) => {
      expect(await nativeAsr(target({ apiKey }), input())).toEqual(localRejection);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('rejects an already-aborted request without claiming an upstream call', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await nativeAsr(target(), input(), controller.signal)).toEqual(localRejection);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('native ASR failure/cancellation boundaries', () => {
  it.each([
    [401, 'InvalidApiKey', 'invalid_key'],
    [429, 'Throttling.RateQuota', 'rate_limited'],
    [400, 'Arrearage', 'quota_exhausted'],
    [400, 'DataInspectionFailed', 'content_rejected'],
    [500, 'InternalError', 'provider_error'],
    [400, 'InvalidParameter', 'bad_request'],
  ] as const)(
    'classifies HTTP %s / %s without key/body leakage or zero-cost claims',
    async (status, code, category) => {
      fetchMock.mockResolvedValue(json({ code, message: `private response ${KEY}` }, status));
      const result = await nativeAsr(target(), input());
      expect(result).toEqual({ ok: false, category });
      expect(JSON.stringify(result)).not.toContain(KEY);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it('does not follow a redirect or forward credentials to its location', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 302, headers: { location: 'https://evil.test/collect' } }),
    );
    expect(await nativeAsr(target(), input())).toEqual({ ok: false, category: 'provider_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]?.redirect).toBe('manual');
  });
  it('sanitizes thrown network details and does not retry a possibly billable request', async () => {
    fetchMock.mockRejectedValue(new Error(`secret ${KEY}`));
    expect(await nativeAsr(target(), input())).toEqual({ ok: false, category: 'network_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('cancels declared oversized responses before reading them', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-length': '65537' } }));
    expect(await nativeAsr(target(), input())).toEqual({ ok: false, category: 'provider_error' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('caps accumulated response bytes even without content-length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(65_537));
      },
      cancel,
    });
    fetchMock.mockResolvedValue(new Response(body));
    expect(await nativeAsr(target(), input())).toEqual({ ok: false, category: 'provider_error' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('enforces the 30s deadline even when headers arrived but the response body stalls', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel })));
    const result = nativeAsr(target(), input());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual({ ok: false, category: 'network_error' });
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates caller abort through the full body read without asserting zero cost', async () => {
    const cancel = vi.fn();
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            started();
          },
          cancel,
        }),
      ),
    );
    const controller = new AbortController();
    const result = nativeAsr(target(), input(), controller.signal);
    await reading;
    controller.abort();
    expect(await result).toEqual({ ok: false, category: 'network_error' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('allows at most two in-flight requests and releases capacity after completion', async () => {
    const resolve: Array<(value: Response) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve.push(done);
        }),
    );
    const first = nativeAsr(target(), input());
    const second = nativeAsr(target(), input());
    expect(await nativeAsr(target(), input())).toEqual({
      ok: false,
      category: 'rate_limited',
      zeroCost: true,
      localRateLimit: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolve[0]!(json(payload()));
    resolve[1]!(json(payload()));
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    fetchMock.mockImplementation(async () => json(payload()));
    expect((await nativeAsr(target(), input())).ok).toBe(true);
  });
});
