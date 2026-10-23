import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  OpenAiCompatibleMediaAdapter,
  isMimoChatAudioModel,
  pcmFromWav,
  withMimoChatAudio,
} from './media-adapter.js';

// 合成数据：合成密钥、合成供应商、合成音频，不连接任何真实上游。
const KEY = 'FAKE_MIMO_KEY_FOR_OFFLINE_TEST_ONLY';
const MIMO = 'mimo-v2.5-tts';
let server: http.Server;
let baseUrl = '';
let calls: Array<{ path: string; headers: http.IncomingHttpHeaders; body: unknown }> = [];
let handler: (input: { path: string; body: unknown }) => {
  status: number;
  json?: unknown;
  raw?: Buffer;
  contentType?: string;
};

function wav(sampleRate: number, samples: number): Buffer {
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const adapter = () => withMimoChatAudio(new OpenAiCompatibleMediaAdapter(async () => true));
const target = (model = MIMO) => ({ kind: 'openai_compatible', baseUrl, apiKey: KEY, model });

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks);
      const body: unknown = raw.length ? JSON.parse(raw.toString('utf8')) : null;
      calls.push({ path: request.url ?? '', headers: request.headers, body });
      const out = handler({ path: request.url ?? '', body });
      if (out.raw) {
        response.writeHead(out.status, {
          'content-type': out.contentType ?? 'application/octet-stream',
        });
        response.end(out.raw);
        return;
      }
      response.writeHead(out.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(out.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  calls = [];
  handler = () => ({ status: 500, json: { error: { code: 'unexpected' } } });
});

describe('MiMo native speech synthesis protocol', () => {
  it('uses chat/completions with both auth headers and returns decoded wav', async () => {
    const audio = wav(24_000, 24_000);
    handler = () => ({
      status: 200,
      json: {
        choices: [
          {
            message: {
              audio: { data: audio.toString('base64'), duration_seconds: 1.5 },
            },
          },
        ],
      },
    });
    const result = await adapter().synthesize(target(), {
      text: '你好，这是合成语音。',
      voice: 'voice-synthetic',
      format: 'wav',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mimeType).toBe('audio/wav');
    expect(result.value.durationMs).toBe(1500);
    expect(Buffer.from(result.value.bytes).equals(audio)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/chat/completions');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.headers['api-key']).toBe(KEY);
    const body = calls[0]!.body as { model: string; messages: unknown[]; audio: unknown };
    expect(body.model).toBe(MIMO);
    expect(body.audio).toEqual({ format: 'wav', voice: 'voice-synthetic' });
    expect(body.messages).toHaveLength(2);
    expect((body.messages[1] as { content: string }).content).toBe('你好，这是合成语音。');
  });

  it('strips the wav container for 24 kHz PCM requests', async () => {
    const audio = wav(24_000, 24_000);
    handler = () => ({ status: 200, json: { audio: { data: audio.toString('base64') } } });
    const result = await adapter().synthesize(target(), {
      text: '你好',
      voice: 'v',
      format: 'pcm16_24k',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mimeType).toBe('audio/L16');
    expect(result.value.bytes.length).toBe(24_000 * 2);
    expect(result.value.durationMs).toBe(Math.round((24_000 * 2) / 48));
  });

  it('refuses ogg_opus instead of pretending the container is supported', async () => {
    const result = await adapter().synthesize(target(), {
      text: '你好',
      voice: 'v',
      format: 'ogg_opus',
    });
    expect(result).toEqual({ ok: false, category: 'bad_request' });
    expect(calls).toHaveLength(0);
  });

  it('rejects a wav whose sample rate does not match instead of resampling', async () => {
    handler = () => ({
      status: 200,
      json: { audio: { data: wav(48_000, 4800).toString('base64') } },
    });
    expect(pcmFromWav(wav(48_000, 100), 24_000)).toBeNull();
    const result = await adapter().synthesize(target(), {
      text: '你好',
      voice: 'v',
      format: 'pcm16_24k',
    });
    expect(result).toEqual({ ok: false, category: 'bad_request' });
  });

  it('maps upstream failures without leaking the key', async () => {
    handler = () => ({ status: 401, json: { error: { code: 'invalid_api_key' } } });
    const result = await adapter().synthesize(target(), {
      text: '你好',
      voice: 'v',
      format: 'wav',
    });
    expect(result).toEqual({ ok: false, category: 'invalid_key' });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('treats a response without audio as a provider failure', async () => {
    handler = () => ({ status: 200, json: { choices: [{ message: { content: 'no audio' } }] } });
    expect(
      await adapter().synthesize(target(), { text: '你好', voice: 'v', format: 'wav' }),
    ).toEqual({
      ok: false,
      category: 'provider_error',
    });
  });

  it('streams MiMo audio as PCM chunks and delegates other models to /audio/speech', async () => {
    const audio = wav(24_000, 4800);
    handler = ({ path }) =>
      path === '/chat/completions'
        ? { status: 200, json: { audio: { data: audio.toString('base64') } } }
        : { status: 200, raw: Buffer.alloc(4800, 1), contentType: 'audio/wav' };
    const streamed = await adapter().synthesizeStream(
      target(),
      { text: '你好', voice: 'v' },
      new AbortController().signal,
    );
    expect(streamed.ok).toBe(true);
    let total = 0;
    if (streamed.ok) for await (const chunk of streamed.value) total += chunk.length;
    expect(total).toBe(4800 * 2);
    expect(calls[0]!.path).toBe('/chat/completions');

    calls = [];
    const other = await adapter().synthesize(target('qwen-audio-3.0-tts-plus'), {
      text: '你好',
      voice: 'v',
      format: 'wav',
    });
    expect(other.ok).toBe(true);
    expect(calls[0]!.path).toBe('/audio/speech');
    expect(calls[0]!.headers['api-key']).toBeUndefined();
    expect(isMimoChatAudioModel(MIMO)).toBe(true);
    expect(isMimoChatAudioModel('qwen-audio-3.0-tts-plus')).toBe(false);
  });
});
