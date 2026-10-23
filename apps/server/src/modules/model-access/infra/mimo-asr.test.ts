import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMimoAsrModel, mimoAsr } from './mimo-asr.js';
import { OpenAiCompatibleMediaAdapter, withMimoChatAudio } from './media-adapter.js';
import type { MediaTarget } from './media-adapter.js';

// 合成协议夹具：不连任何真实供应商，不包含真实密钥或用户音频。
const KEY = 'OFFLINE_MIMO_ASR_SYNTHETIC_KEY';
const MODEL = 'mimo-v2.5-asr';
const fetchMock = vi.fn<typeof fetch>();
const target = (overrides: Partial<MediaTarget> = {}): MediaTarget => ({
  kind: 'openai_compatible',
  baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
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

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function payload(text = '你好，微伴。', seconds: unknown = 1.25) {
  return {
    id: 'synthetic-chat-completion',
    choices: [{ message: { role: 'assistant', content: text } }],
    usage: { seconds, prompt_tokens: 10, completion_tokens: 5 },
  };
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

describe('MiMo ASR model routing is model-name scoped', () => {
  it.each(['mimo-v2.5-asr', 'mimo-v2.5-asr-latest', 'mimo-v2-asr'])(
    'claims the MiMo ASR family member %s',
    (model) => {
      expect(isMimoAsrModel(model)).toBe(true);
    },
  );
  it.each([
    'mimo-v2.5-tts',
    'mimo-v2.5-tts-voiceclone',
    'qwen3-asr-flash',
    'FunAudioLLM/SenseVoiceSmall',
    'TeleAI/TeleSpeechASR',
    'whisper-1',
    'gpt-4o-transcribe',
  ])('leaves unrelated model %s on its existing adapter', (model) => {
    expect(isMimoAsrModel(model)).toBe(false);
  });
});

describe('MiMo legacy chat-completions ASR protocol', () => {
  it('posts an inline input_audio data URL with both auth headers and asr_options', async () => {
    const audio = input();
    expect(await mimoAsr(target(), audio)).toEqual({
      ok: true,
      value: { text: '你好，微伴。', asrSeconds: 1.25 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://token-plan-cn.xiaomimimo.com/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: {
        'api-key': KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: `data:audio/wav;base64,${audio.bytes.toString('base64')}`,
              },
            },
          ],
        },
      ],
      asr_options: { language: null },
    });
    expect(String(init?.body)).not.toContain(KEY);
    expect(String(url)).not.toContain(KEY);
  });

  it('joins a base URL that already ends with a slash without duplicating it', async () => {
    await mimoAsr(target({ baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/' }), input());
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
    );
  });

  it('accepts the legacy top-level text shape as well as chat message content', async () => {
    fetchMock.mockResolvedValue(json({ text: ' 旧版顶层文本 ' }));
    expect(await mimoAsr(target(), input())).toEqual({
      ok: true,
      value: { text: '旧版顶层文本' },
    });
  });

  it('joins chat content parts when the response uses the array shape', async () => {
    fetchMock.mockResolvedValue(
      json({ choices: [{ message: { content: [{ text: '你' }, { text: '好' }] } }] }),
    );
    expect(await mimoAsr(target(), input())).toEqual({ ok: true, value: { text: '你好' } });
  });

  it.each([undefined, null, -1, '1.25', 301])(
    'does not invent usage seconds when the provider value is %s',
    async (seconds) => {
      const body = payload('你好，微伴。');
      body.usage.seconds = seconds;
      fetchMock.mockResolvedValue(json(body));
      expect(await mimoAsr(target(), input())).toEqual({
        ok: true,
        value: { text: '你好，微伴。' },
      });
    },
  );

  it('preserves a reported zero and an empty silence transcript', async () => {
    fetchMock.mockResolvedValue(json(payload('', 0)));
    expect(await mimoAsr(target(), input())).toEqual({
      ok: true,
      value: { text: '', asrSeconds: 0 },
    });
  });

  it.each([
    { choices: [] },
    { choices: [{ message: { content: 42 } }] },
    { choices: [{ message: { content: [{ text: 42 }] } }] },
    { output: { choices: [{ message: { content: 'not the chat shape' } }] } },
    { text: 42 },
  ])('rejects an unexpected success shape without retry/fallback', async (body) => {
    fetchMock.mockResolvedValue(json(body));
    expect(await mimoAsr(target(), input())).toEqual({
      ok: false,
      category: 'provider_error',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports malformed JSON as a provider failure, not a free retry', async () => {
    fetchMock.mockResolvedValue(new Response(`not JSON ${KEY}`));
    const result = await mimoAsr(target(), input());
    expect(result).toEqual({ ok: false, category: 'provider_error' });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('bounded MiMo input and endpoint validation', () => {
  it('rejects empty and over-12MB audio before encoding or contacting the provider', async () => {
    expect(await mimoAsr(target(), { bytes: new Uint8Array(), mimeType: 'audio/wav' })).toEqual(
      localRejection,
    );
    expect(
      await mimoAsr(target(), { bytes: new Uint8Array(12_000_001), mimeType: 'audio/wav' }),
    ).toEqual(localRejection);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['application/octet-stream', 'video/mp4', 'audio/wav;codecs=opus'])(
    'rejects non-plain audio MIME %s before sending the key',
    async (mimeType) => {
      expect(await mimoAsr(target(), { ...input(), mimeType })).toEqual(localRejection);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'synthetic\r\nInjected: header'])(
    'rejects an unusable key without sending it',
    async (apiKey) => {
      expect(await mimoAsr(target({ apiKey }), input())).toEqual(localRejection);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    'file:///tmp/key',
    'https://user:password@token-plan-cn.xiaomimimo.com/v1',
    'https://token-plan-cn.xiaomimimo.com/v1?key=secret',
    'not a url',
  ])('rejects unsafe base %s before sending anything', async (baseUrl) => {
    expect(await mimoAsr(target({ baseUrl }), input())).toEqual(localRejection);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MiMo ASR failure/cancellation boundaries', () => {
  it.each([
    [401, 'invalid_api_key', 'invalid_key'],
    [403, 'forbidden', 'invalid_key'],
    [429, 'rate_limit_exceeded', 'rate_limited'],
    [402, '', 'quota_exhausted'],
    [400, 'insufficient_quota', 'quota_exhausted'],
    [400, 'data_inspection_failed', 'content_rejected'],
    [500, 'internal_error', 'provider_error'],
    [400, 'invalid_parameter', 'bad_request'],
  ] as const)('classifies HTTP %s / %s without leaking the key', async (status, code, category) => {
    fetchMock.mockResolvedValue(json({ code, message: `private response ${KEY}` }, status));
    const result = await mimoAsr(target(), input());
    expect(result).toEqual({ ok: false, category });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a 200 response carrying an error object as a classified failure', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'insufficient_quota' } }));
    expect(await mimoAsr(target(), input())).toEqual({
      ok: false,
      category: 'quota_exhausted',
    });
  });

  it('does not follow a redirect or forward credentials to its location', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 302, headers: { location: 'https://evil.test/collect' } }),
    );
    expect(await mimoAsr(target(), input())).toEqual({
      ok: false,
      category: 'provider_error',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]?.redirect).toBe('manual');
  });

  it('sanitizes thrown network details and does not retry a possibly billable request', async () => {
    fetchMock.mockRejectedValue(new Error(`secret ${KEY}`));
    const result = await mimoAsr(target(), input());
    expect(result).toEqual({ ok: false, category: 'network_error' });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels declared oversized responses before reading them', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'content-length': '65537' } }));
    expect(await mimoAsr(target(), input())).toEqual({
      ok: false,
      category: 'provider_error',
    });
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
    expect(await mimoAsr(target(), input())).toEqual({
      ok: false,
      category: 'provider_error',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('enforces the 30s deadline even when headers arrived but the response body stalls', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel })));
    const result = mimoAsr(target(), input());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual({ ok: false, category: 'network_error' });
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('media adapter routing keeps other ASR providers unchanged', () => {
  const adapter = () => withMimoChatAudio(new OpenAiCompatibleMediaAdapter());

  it('sends MiMo ASR to chat completions instead of multipart', async () => {
    fetchMock.mockResolvedValue(json(payload('你好，微伴。')));
    expect(await adapter().transcribe(target(), input())).toEqual({
      ok: true,
      value: { text: '你好，微伴。', asrSeconds: 1.25 },
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
    );
  });

  it.each(['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR'])(
    'keeps SiliconFlow model %s on the compatible multipart path',
    async (model) => {
      fetchMock.mockResolvedValue(json({ text: '你好', usage: { seconds: 2 } }));
      expect(
        await adapter().transcribe(
          target({ kind: 'openai_compatible', baseUrl: 'https://api.siliconflow.cn/v1', model }),
          input(),
        ),
      ).toEqual({ ok: true, value: { text: '你好', asrSeconds: 2 } });
      expect(String(fetchMock.mock.calls[0]![0])).toBe(
        'https://api.siliconflow.cn/v1/audio/transcriptions',
      );
    },
  );

  it('does not divert a MiMo TTS model into the ASR adapter', async () => {
    fetchMock.mockResolvedValue(json({ text: '不应使用 ASR', usage: { seconds: 2 } }));
    expect(
      await adapter().transcribe(
        target({ baseUrl: 'https://api.siliconflow.cn/v1', model: 'mimo-v2.5-tts' }),
        input(),
      ),
    ).toEqual({ ok: true, value: { text: '不应使用 ASR', asrSeconds: 2 } });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.siliconflow.cn/v1/audio/transcriptions',
    );
  });
});
