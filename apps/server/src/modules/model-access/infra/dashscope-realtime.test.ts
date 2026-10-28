import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import {
  isDashscopeRealtimeModel,
  openDashscopeRealtime,
  openDashscopeRealtimeAt,
  parseRealtimeUsage,
  realtimeSessionUpdate,
  realtimeUrl,
  translateRealtimeEvent,
  type RealtimeTransportEvent,
} from './dashscope-realtime.js';

describe('百炼实时语音协议（纯函数）', () => {
  it('只认带 realtime 的 Qwen Audio / Omni 型号', () => {
    expect(isDashscopeRealtimeModel('qwen-audio-3.0-realtime-plus')).toBe(true);
    expect(isDashscopeRealtimeModel('qwen3.1-omni-flash-realtime')).toBe(true);
    expect(isDashscopeRealtimeModel('qwen-audio-3.0-tts-plus')).toBe(false);
    expect(isDashscopeRealtimeModel('qwen3.1-omni-flash')).toBe(false);
  });

  it('https 基址换成 wss 实时地址；非 https / 带账号的地址拒绝', () => {
    expect(
      realtimeUrl('https://dashscope.aliyuncs.com/api/v1', 'qwen-audio-3.0-realtime-plus'),
    ).toBe('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus');
    expect(realtimeUrl('https://ws1.cn-beijing.maas.aliyuncs.com/api/v1/', 'm')).toBe(
      'wss://ws1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=m',
    );
    // V3：旧服北京 workspace 迁入的基址以 /api 结尾
    expect(realtimeUrl('https://ws1.cn-beijing.maas.aliyuncs.com/api', 'm')).toBe(
      'wss://ws1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=m',
    );
    expect(realtimeUrl('http://dashscope.aliyuncs.com/api/v1', 'm')).toBeNull();
    expect(realtimeUrl('https://u:p@dashscope.aliyuncs.com/api/v1', 'm')).toBeNull();
  });

  it('Audio Realtime Plus 与 Omni 的会话参数结构不同（沿用旧版）', () => {
    const plus = realtimeSessionUpdate('qwen-audio-3.0-realtime-plus', {
      instructions: 'i',
      voice: 'v',
    });
    expect(plus).toMatchObject({
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 800 },
      voice: 'v',
    });
    const omni = realtimeSessionUpdate('qwen3.1-omni-flash-realtime', {
      instructions: 'i',
      voice: 'v',
    });
    expect(omni).toMatchObject({
      audio: {
        input: { format: { type: 'pcm', sample_rate: 16000 } },
        output: { format: { type: 'pcm', sample_rate: 24000 } },
      },
    });
    expect(omni).not.toHaveProperty('input_audio_format');
  });

  it('用量必须有分模态明细；缓存命中从文字输入里分出来；只有总数 = 未知', () => {
    expect(
      parseRealtimeUsage({
        input_tokens: 1300,
        output_tokens: 260,
        input_token_details: { text_tokens: 1000, audio_tokens: 300, cached_tokens: 400 },
        output_token_details: { text_tokens: 60, audio_tokens: 200 },
      }),
    ).toEqual({
      textInputTokens: 600,
      cachedTextInputTokens: 400,
      audioInputTokens: 300,
      textOutputTokens: 60,
      audioOutputTokens: 200,
    });
    expect(parseRealtimeUsage({ input_tokens: 10, output_tokens: 5 })).toBeNull();
    expect(
      parseRealtimeUsage({
        input_token_details: { text_tokens: -1 },
        output_token_details: { audio_tokens: 1 },
      }),
    ).toBeNull();
  });

  it('事件翻译：打断、转写、音频、文字累计、结束与错误', () => {
    const text = new Map<string, string>();
    const t = (e: Record<string, unknown>) => translateRealtimeEvent(e, text);
    expect(t({ type: 'input_audio_buffer.speech_started' })).toEqual({ type: 'speech_started' });
    expect(
      t({ type: 'conversation.item.input_audio_transcription.completed', transcript: ' 你好 ' }),
    ).toEqual({ type: 'user_transcript', text: '你好' });
    expect(t({ type: 'response.created', response: { id: 'r1' } })).toEqual({
      type: 'response_started',
      responseId: 'r1',
    });
    const audio = t({
      type: 'response.audio.delta',
      response_id: 'r1',
      delta: Buffer.alloc(8).toString('base64'),
    });
    expect(audio).toMatchObject({ type: 'audio', responseId: 'r1' });
    expect(
      t({
        type: 'response.audio.delta',
        response_id: 'r1',
        delta: Buffer.alloc(3).toString('base64'),
      }),
    ).toBeNull();
    expect(
      t({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: '你' }),
    ).toMatchObject({ text: '你', final: false });
    expect(
      t({ type: 'response.audio_transcript.delta', response_id: 'r1', delta: '好' }),
    ).toMatchObject({ text: '你好', final: false });
    expect(
      t({ type: 'response.audio_transcript.done', response_id: 'r1', transcript: '你好。' }),
    ).toMatchObject({ text: '你好。', final: true });
    expect(t({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } })).toEqual({
      type: 'response_done',
      responseId: 'r1',
      status: 'cancelled',
      usage: null,
    });
    expect(t({ type: 'error', error: { code: 'response_cancel_not_active' } })).toBeNull();
    expect(t({ type: 'error', error: { code: 'DataInspectionFailed' } })).toEqual({
      type: 'error',
      category: 'content_rejected',
      fatal: false,
    });
    expect(t({ type: 'error', error: { code: 'InvalidApiKey' } })).toMatchObject({
      category: 'invalid_key',
      fatal: true,
    });
  });
});

describe('百炼实时语音 WebSocket（本机假供应商，不连外网）', () => {
  let server: WebSocketServer | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  async function fakeProvider(
    onClient: (socket: ServerSocket, headers: Record<string, unknown>) => void,
  ) {
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    server.on('connection', (socket, req) => onClient(socket, req.headers));
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    return (server.address() as AddressInfo).port;
  }

  it('非百炼账号或非 https 基址不建立连接（不发请求）', async () => {
    const result = await openDashscopeRealtime(
      {
        kind: 'openai_compatible',
        baseUrl: 'https://x/api/v1',
        apiKey: 'k',
        model: 'qwen-audio-3.0-realtime-plus',
      },
      { instructions: 'i', voice: 'v' },
    );
    expect(result).toEqual({ ok: false, category: 'bad_request', zeroCost: true });
  });

  it('握手带密钥、发 session.update、等 session.updated；上行音频与下行事件往返', async () => {
    const received: Array<Record<string, unknown>> = [];
    let auth: unknown;
    await fakeProvider((socket, headers) => {
      auth = headers.authorization;
      socket.on('message', (raw) => {
        const event = JSON.parse(String(raw)) as Record<string, unknown>;
        received.push(event);
        if (event.type === 'session.update' && received.length === 1)
          socket.send(JSON.stringify({ type: 'session.updated' }));
        if (event.type === 'response.create') {
          socket.send(JSON.stringify({ type: 'response.created', response: { id: 'r1' } }));
          socket.send(
            JSON.stringify({
              type: 'response.audio.delta',
              response_id: 'r1',
              delta: Buffer.alloc(4800).toString('base64'),
            }),
          );
          socket.send(
            JSON.stringify({
              type: 'response.done',
              response: {
                id: 'r1',
                status: 'completed',
                usage: {
                  input_token_details: { text_tokens: 10, audio_tokens: 5 },
                  output_token_details: { text_tokens: 2, audio_tokens: 7 },
                },
              },
            }),
          );
        }
      });
    });
    const port = (server!.address() as AddressInfo).port;
    const opened = await openWithLocalUrl(
      `ws://127.0.0.1:${port}/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus`,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(auth).toBe('Bearer test-key');
    expect(received[0]).toMatchObject({ type: 'session.update', session: { voice: 'Cherry' } });
    opened.value.appendAudio(new Uint8Array(40_000));
    opened.value.createResponse();
    const events: RealtimeTransportEvent[] = [];
    for await (const event of opened.value.events()) {
      events.push(event);
      if (event.type === 'response_done') break;
    }
    expect(events.map((e) => e.type)).toEqual(['response_started', 'audio', 'response_done']);
    expect(events[2]).toMatchObject({
      usage: {
        textInputTokens: 10,
        audioInputTokens: 5,
        textOutputTokens: 2,
        audioOutputTokens: 7,
      },
    });
    // 40000 字节按 32000 字节一帧拆成两次 append
    expect(received.filter((e) => e.type === 'input_audio_buffer.append')).toHaveLength(2);
    opened.value.close();
  });

  it('供应商拒绝握手（401）→ invalid_key，不重试', async () => {
    server = new WebSocketServer({
      port: 0,
      host: '127.0.0.1',
      verifyClient: (_info, cb) => cb(false, 401, 'Unauthorized'),
    });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const opened = await openWithLocalUrl(`ws://127.0.0.1:${port}/api-ws/v1/realtime?model=m`);
    expect(opened).toEqual({ ok: false, category: 'invalid_key' });
  });
});

/** 只在测试里绕过 https→wss 改写，指向本机假供应商；协议帧与生产代码完全相同。 */
async function openWithLocalUrl(url: string) {
  return openDashscopeRealtimeAt(url, 'qwen-audio-3.0-realtime-plus', 'test-key', {
    instructions: '你是测试角色',
    voice: 'Cherry',
  });
}
