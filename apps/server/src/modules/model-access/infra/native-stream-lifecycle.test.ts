import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleMediaAdapter, wavFromPcm, withMimoChatAudio } from './media-adapter.js';

const adapter = () => withMimoChatAudio(new OpenAiCompatibleMediaAdapter());
const target = (mimo = true) => ({
  kind: mimo ? 'openai_compatible' : 'dashscope',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'offline-test-key',
  model: mimo ? 'mimo-v2.5-tts' : 'qwen-audio-3.0-tts-plus',
});
afterEach(() => vi.unstubAllGlobals());

describe('native ASR integration routing', () => {
  it.each(['qwen-audio-3.1-asr-flash', 'mimo-v2.5-asr', 'qwen3-asr-flash'])(
    'never tries multipart for unverified native/compatible ASR model %s',
    async (model) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      expect(
        await adapter().transcribe(
          { ...target(), model },
          { bytes: wavFromPcm(new Uint8Array(320), 16000), mimeType: 'audio/wav' },
        ),
      ).toEqual({ ok: false, category: 'bad_request', zeroCost: true });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('routes supported DashScope ASR through the native JSON path and retains provider seconds', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: { choices: [{ message: { content: [{ text: '你好' }] } }] },
          usage: { seconds: 0.01 },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    expect(
      await adapter().transcribe(
        {
          ...target(false),
          baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
          model: 'qwen3-asr-flash',
        },
        { bytes: wavFromPcm(new Uint8Array(320), 16000), mimeType: 'audio/wav' },
      ),
    ).toEqual({ ok: true, value: { text: '你好', asrSeconds: 0.01 } });
    expect(fetch.mock.calls[0]![0]).toContain('/services/aigc/multimodal-generation/generation');
  });
});

describe('compatible ASR real usage propagation', () => {
  it.each([2, undefined, -1, '2'])(
    'returns only valid supplier seconds, never an invented duration (%s)',
    async (seconds) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ text: '你好，微伴。', usage: { seconds } }));
      vi.stubGlobal('fetch', fetch);
      expect(
        await adapter().transcribe(
          { ...target(), model: 'FunAudioLLM/SenseVoiceSmall' },
          {
            bytes: wavFromPcm(new Uint8Array(69120), 24000),
            mimeType: 'audio/wav',
          },
        ),
      ).toEqual({
        ok: true,
        value: { text: '你好，微伴。', ...(seconds === 2 ? { asrSeconds: 2 } : {}) },
      });
      expect(fetch.mock.calls[0]![0]).toContain('/audio/transcriptions');
    },
  );
});

describe('native cascade synthesis cancellation', () => {
  it.each([true, false])('does not send a pre-cancelled native request (MiMo=%s)', async (mimo) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();
    expect(
      await adapter().synthesizeStream(
        target(mimo),
        { text: '你好', voice: 'system' },
        controller.signal,
      ),
    ).toEqual({ ok: false, category: 'bad_request', zeroCost: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'propagates cancellation to an already sent request without claiming free usage (MiMo=%s)',
    async (mimo) => {
      const controller = new AbortController();
      let receivedSignal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init: RequestInit) => {
          receivedSignal = init.signal as AbortSignal;
          return new Promise<Response>((_resolve, reject) => {
            receivedSignal!.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true,
            });
          });
        }),
      );
      const pending = adapter().synthesizeStream(
        target(mimo),
        { text: '你好', voice: 'system' },
        controller.signal,
      );
      controller.abort();
      expect(await pending).toEqual({ ok: false, category: 'network_error' });
      expect(receivedSignal?.aborted).toBe(true);
    },
  );
});
