import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./native-opus.js', () => ({
  acquireNativeOpusEncoder: async () => ({ ok: false, reason: 'unavailable' }),
}));
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAiCompatibleMediaAdapter, withMimoChatAudio } from './media-adapter.js';

// 合成数据：合成密钥、合成上游、合成音频；不连接任何真实供应商。
const KEY = 'FAKE_DASHSCOPE_KEY_FOR_OFFLINE_TEST_ONLY';
const MODEL = 'qwen-audio-3.0-tts-plus';
let server: http.Server;
let baseUrl = '';
let calls: Array<{
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}> = [];
let handler: (input: { method: string; path: string }) => {
  status: number;
  json?: unknown;
  raw?: Buffer;
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
const target = (model = MODEL, kind = 'dashscope') => ({
  kind,
  baseUrl,
  apiKey: KEY,
  model,
});

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks);
      const body: unknown = raw.length ? JSON.parse(raw.toString('utf8')) : null;
      calls.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body,
      });
      const out = handler({ method: request.method ?? '', path: request.url ?? '' });
      if (out.raw) {
        response.writeHead(out.status, { 'content-type': 'audio/wav' });
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

describe('DashScope native speech synthesis protocol', () => {
  it('posts to SpeechSynthesizer but refuses the returned localhost audio URL', async () => {
    const audio = wav(24_000, 4800);
    handler = ({ method, path }) =>
      path === '/services/audio/tts/SpeechSynthesizer'
        ? {
            status: 200,
            json: {
              output: { audio: { url: `${baseUrl}/audio/out.wav?token=1` } },
            },
          }
        : method === 'GET' && path.startsWith('/audio/')
          ? { status: 200, raw: audio }
          : { status: 404, json: {} };
    // 这里没有绕过域名检查的测试开关；本机地址必须拒绝，不能称为正向下载测试。
    const result = await adapter().synthesize(
      { ...target(), baseUrl },
      { text: '你好，百炼。', voice: 'Cherry', format: 'wav' },
    );
    // 本机地址不属于官方域名 → 必须拒绝，而不是去下载任意地址。
    expect(result).toEqual({ ok: false, category: 'provider_error' });
    expect(calls[0]!.path).toBe('/services/audio/tts/SpeechSynthesizer');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.body).toEqual({
      model: MODEL,
      input: { text: '你好，百炼。', voice: 'Cherry', format: 'wav', sample_rate: 24000 },
    });
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(0);
  });

  it('refuses retired models and unavailable OGG encoding without calling upstream', async () => {
    expect(
      await adapter().synthesize(target('qwen-audio-3.0-tts-flash'), {
        text: '你好',
        voice: 'Cherry',
        format: 'wav',
      }),
    ).toEqual({ ok: false, category: 'bad_request' });
    expect(
      await adapter().synthesize(target(), { text: '你好', voice: 'Cherry', format: 'ogg_opus' }),
    ).toEqual({ ok: false, category: 'bad_request', zeroCost: true });
    // 退役模型与缺编码器均在请求前拒绝，不能误送到 OpenAI 兼容路径。
    expect(calls).toHaveLength(0);
  });

  it('only treats dashscope tts models as native targets', async () => {
    const { isDashscopeTtsTarget } = await import('./media-adapter.js');
    expect(isDashscopeTtsTarget(target())).toBe(true);
    expect(isDashscopeTtsTarget(target('qwen-audio-3.0-tts-flash'))).toBe(false);
    expect(isDashscopeTtsTarget(target(MODEL, 'openai_compatible'))).toBe(false);
    expect(isDashscopeTtsTarget(target('qwen3.5-omni-plus-realtime'))).toBe(false);
  });

  it('maps upstream failures without leaking the key', async () => {
    handler = () => ({ status: 401, json: { error: { code: 'invalid_api_key' } } });
    const result = await adapter().synthesize(target(), {
      text: '你好',
      voice: 'Cherry',
      format: 'wav',
    });
    expect(result).toEqual({ ok: false, category: 'invalid_key' });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('treats a response without an audio url as a provider failure', async () => {
    handler = () => ({ status: 200, json: { output: {} } });
    expect(
      await adapter().synthesize(target(), { text: '你好', voice: 'Cherry', format: 'wav' }),
    ).toEqual({ ok: false, category: 'provider_error' });
  });
});
