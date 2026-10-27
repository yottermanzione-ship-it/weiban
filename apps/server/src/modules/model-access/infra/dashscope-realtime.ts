/**
 * 百炼实时语音 / Omni 实时模型的 WebSocket 传输（批 V）。服务端持有密钥并中转，客户端协议不变。
 *
 * 协议依据旧版已跑通的 `server/lib/voice/qwen_realtime_gateway.js`：
 * - 地址：把上游 `https://<host>/api/v1` 换成 `wss://<host>/api-ws/v1/realtime?model=<模型>`，`Authorization: Bearer`；
 * - 连上后发 `session.update`；收到 `session.updated` 才算就绪；
 * - `qwen-audio-*-realtime-*`：`input_audio_format/output_audio_format = pcm`，server_vad（阈值 0.5、静音 800ms）；
 *   Omni 等其它实时模型：`audio.input.format = pcm 16k`、`audio.output.format = pcm 24k`，server_vad 静音 700ms；
 * - 上行 `input_audio_buffer.append`（base64 PCM16 16k）；下行 `response.audio.delta`（base64 PCM16 24k）、
 *   `input_audio_buffer.speech_started`（用户开口 = 打断）、`response.done`（带本次回应的 token 用量）。
 *
 * 安全：只连 https 基址换出的 wss 地址，不跟随重定向；单帧上限 2 MiB；不记录上游原文、地址或密钥；
 * 解析失败的帧丢弃。用量只采信供应商在 `response.done` 里按模态报告的数字，缺模态明细 = 用量未知。
 */
import { WebSocket } from 'ws';
import type { MediaAdapterResult, MediaFailure, MediaTarget } from './media-adapter.js';

const READY_TIMEOUT_MS = 15_000;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
/** 单次 append 的最大 PCM 字节（约 1 秒 16 kHz），大块拆开发。 */
const APPEND_CHUNK_BYTES = 32_000;
/** 事件积压上限（约 1 分钟的下行音频帧）；消费方卡住时宁可结束会话，也不无界占内存。 */
const MAX_QUEUED_EVENTS = 4000;

export interface RealtimeSessionConfig {
  instructions: string;
  voice: string;
}

/** 供应商在 response.done 里报告的分模态用量。 */
export interface RealtimeUsage {
  textInputTokens: number;
  audioInputTokens: number;
  cachedTextInputTokens: number;
  textOutputTokens: number;
  audioOutputTokens: number;
}

export type RealtimeTransportEvent =
  | { type: 'speech_started' }
  | { type: 'user_transcript'; text: string }
  | { type: 'response_started'; responseId: string }
  | { type: 'audio'; responseId: string; pcm: Uint8Array }
  | { type: 'assistant_text'; responseId: string; text: string; final: boolean }
  | {
      type: 'response_done';
      responseId: string;
      status: 'completed' | 'cancelled' | 'incomplete' | 'failed';
      usage: RealtimeUsage | null;
    }
  | { type: 'error'; category: MediaFailure; fatal: boolean }
  | { type: 'closed' };

export interface RealtimeConnection {
  appendAudio(pcm16k: Uint8Array): void;
  /** 让模型主动回应一次；instructions 只对这次回应生效。 */
  createResponse(instructions?: string): void;
  cancelResponse(): void;
  updateInstructions(instructions: string): void;
  events(): AsyncIterable<RealtimeTransportEvent>;
  close(): void;
}

/** 是不是百炼实时语音 / Omni 实时模型（按上游模型名；只认带 realtime 的型号）。 */
export function isDashscopeRealtimeModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return /realtime/u.test(m) && (/^qwen-audio-/u.test(m) || /omni/u.test(m));
}

/** `https://host/api/v1` → `wss://host/api-ws/v1/realtime?model=…`；非 https 返回 null。 */
export function realtimeUrl(baseUrl: string, model: string): string | null {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' || base.username || base.password) return null;
  base.protocol = 'wss:';
  base.pathname = base.pathname.replace(/\/api\/v1\/?$/u, '/api-ws/v1/realtime');
  if (!/\/api-ws\/v1\/realtime$/u.test(base.pathname)) base.pathname = '/api-ws/v1/realtime';
  base.search = new URLSearchParams({ model }).toString();
  base.hash = '';
  return base.href;
}

/** 旧版两套会话参数：Qwen Audio Realtime Plus 与 Omni 实时模型的音频格式字段结构不同。 */
export function realtimeSessionUpdate(model: string, config: RealtimeSessionConfig) {
  const common = {
    modalities: ['audio', 'text'],
    instructions: config.instructions,
    voice: config.voice,
  };
  if (/^qwen-audio-/iu.test(model.trim()))
    return {
      ...common,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 800 },
    };
  return {
    ...common,
    turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
    audio: {
      input: { format: { type: 'pcm', sample_rate: 16000 } },
      output: { format: { type: 'pcm', sample_rate: 24000 } },
    },
  };
}

const nonNegativeInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

/**
 * response.done 的 usage → 分模态用量。必须有输入 / 输出两边的模态明细（text_tokens / audio_tokens），
 * 只有总数时无法分模态计价，按「用量未知」处理（不猜、不把音频按文字价收）。
 */
export function parseRealtimeUsage(raw: unknown): RealtimeUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const usage = raw as Record<string, unknown>;
  const input = usage.input_token_details as Record<string, unknown> | undefined;
  const output = usage.output_token_details as Record<string, unknown> | undefined;
  if (!input || typeof input !== 'object' || !output || typeof output !== 'object') return null;
  const textIn = nonNegativeInt(input.text_tokens ?? 0);
  const audioIn = nonNegativeInt(input.audio_tokens ?? 0);
  const cached = nonNegativeInt(input.cached_tokens ?? 0);
  const textOut = nonNegativeInt(output.text_tokens ?? 0);
  const audioOut = nonNegativeInt(output.audio_tokens ?? 0);
  if ([textIn, audioIn, cached, textOut, audioOut].some((v) => v === null)) return null;
  if (input.text_tokens === undefined && input.audio_tokens === undefined) return null;
  if (output.text_tokens === undefined && output.audio_tokens === undefined) return null;
  return {
    textInputTokens: Math.max(0, textIn! - Math.min(cached!, textIn!)),
    cachedTextInputTokens: Math.min(cached!, textIn!),
    audioInputTokens: audioIn!,
    textOutputTokens: textOut!,
    audioOutputTokens: audioOut!,
  };
}

/** 供应商错误码 → 平台失败类别。 */
export function realtimeFailure(code: string, status = 0): MediaFailure {
  const c = code.toLowerCase();
  if (
    status === 402 ||
    ['arrearage', 'insufficient_quota', 'insufficient_balance', 'quota_exhausted'].includes(c)
  )
    return 'quota_exhausted';
  if (['data_inspection_failed', 'datainspectionfailed', 'content_filter'].includes(c))
    return 'content_rejected';
  if (
    status === 401 ||
    status === 403 ||
    ['invalid_api_key', 'invalidapikey', 'accessdenied', 'access_denied'].includes(c)
  )
    return 'invalid_key';
  if (status === 429 || c.startsWith('throttling') || c === 'rate_limit_exceeded')
    return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'provider_error';
}

/** 不影响会话的协议提示（例如取消一个已经结束的回应）。 */
const BENIGN_ERRORS = new Set([
  'response_cancel_not_active',
  'input_audio_buffer_commit_empty',
  'conversation_already_has_active_response',
]);

class EventQueue<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  overflowed = false;
  push(item: T): void {
    if (this.ended) return;
    if (this.items.length >= MAX_QUEUED_EVENTS) {
      this.overflowed = true;
      return;
    }
    this.items.push(item);
    this.notify();
  }
  end(item?: T): void {
    if (this.ended) return;
    if (item) this.items.push(item);
    this.ended = true;
    this.notify();
  }
  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
  async *iterate(): AsyncIterable<T> {
    for (;;) {
      const next = this.items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}

/** 把一条供应商 JSON 事件翻译成平台事件（纯函数，便于测试）。返回 null = 不关心的事件。 */
export function translateRealtimeEvent(
  event: Record<string, unknown>,
  text: Map<string, string>,
): RealtimeTransportEvent | null {
  const type = typeof event.type === 'string' ? event.type : '';
  const responseIdOf = (): string => {
    const response = event.response as Record<string, unknown> | undefined;
    const id = event.response_id ?? response?.id;
    return typeof id === 'string' ? id.slice(0, 128) : '';
  };
  switch (type) {
    case 'input_audio_buffer.speech_started':
      return { type: 'speech_started' };
    case 'conversation.item.input_audio_transcription.completed': {
      const transcript = typeof event.transcript === 'string' ? event.transcript.trim() : '';
      return transcript ? { type: 'user_transcript', text: transcript.slice(0, 2000) } : null;
    }
    case 'response.created':
      return { type: 'response_started', responseId: responseIdOf() };
    case 'response.audio.delta': {
      if (typeof event.delta !== 'string' || !event.delta) return null;
      const pcm = Buffer.from(event.delta, 'base64');
      if (!pcm.length || pcm.length % 2) return null;
      return { type: 'audio', responseId: responseIdOf(), pcm: new Uint8Array(pcm) };
    }
    case 'response.audio_transcript.delta':
    case 'response.text.delta': {
      if (typeof event.delta !== 'string') return null;
      const id = responseIdOf();
      const next = ((text.get(id) ?? '') + event.delta).slice(0, 4000);
      text.set(id, next);
      return { type: 'assistant_text', responseId: id, text: next, final: false };
    }
    case 'response.audio_transcript.done':
    case 'response.text.done': {
      const id = responseIdOf();
      const done =
        typeof event.transcript === 'string'
          ? event.transcript
          : typeof event.text === 'string'
            ? event.text
            : (text.get(id) ?? '');
      text.delete(id);
      return { type: 'assistant_text', responseId: id, text: done.slice(0, 4000), final: true };
    }
    case 'response.done': {
      const response = (event.response ?? {}) as Record<string, unknown>;
      const raw = typeof response.status === 'string' ? response.status : 'completed';
      const status =
        raw === 'cancelled' || raw === 'incomplete' || raw === 'failed' ? raw : 'completed';
      const id = responseIdOf();
      text.delete(id);
      return {
        type: 'response_done',
        responseId: id,
        status,
        usage: parseRealtimeUsage(response.usage),
      };
    }
    case 'error': {
      const err = (event.error ?? {}) as Record<string, unknown>;
      const code = String(err.code ?? err.type ?? '');
      if (BENIGN_ERRORS.has(code.toLowerCase())) return null;
      const category = realtimeFailure(code);
      // 内容拦截只影响这次回应；其余错误按会话故障处理。
      return { type: 'error', category, fatal: category !== 'content_rejected' };
    }
    default:
      return null;
  }
}

/** 连接百炼实时会话；就绪（session.updated）后返回。失败不重试。 */
export async function openDashscopeRealtime(
  t: MediaTarget,
  config: RealtimeSessionConfig,
): Promise<MediaAdapterResult<RealtimeConnection>> {
  if (t.kind !== 'dashscope' || !isDashscopeRealtimeModel(t.model))
    return { ok: false, category: 'bad_request', zeroCost: true };
  const address = realtimeUrl(t.baseUrl, t.model);
  if (!address) return { ok: false, category: 'bad_request', zeroCost: true };
  const socket = new WebSocket(address, {
    headers: { Authorization: `Bearer ${t.apiKey}` },
    maxPayload: MAX_FRAME_BYTES,
    handshakeTimeout: READY_TIMEOUT_MS,
    followRedirects: false,
    perMessageDeflate: false,
  });
  const queue = new EventQueue<RealtimeTransportEvent>();
  const transcripts = new Map<string, string>();
  let counter = 0;
  const send = (payload: Record<string, unknown>) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ event_id: `wb_${Date.now()}_${++counter}`, ...payload }));
  };
  const ready = await new Promise<MediaFailure | null>((resolve) => {
    const timer = setTimeout(() => resolve('network_error'), READY_TIMEOUT_MS);
    const settle = (value: MediaFailure | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.once('unexpected-response', (_req, res) => {
      settle(realtimeFailure('', res.statusCode ?? 0));
      res.resume();
    });
    socket.once('error', () => settle('network_error'));
    socket.once('close', () => settle('network_error'));
    socket.once('open', () =>
      send({ type: 'session.update', session: realtimeSessionUpdate(t.model, config) }),
    );
    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      } catch {
        return;
      }
      if (event.type === 'session.updated') {
        settle(null);
        return;
      }
      if (event.type === 'error') {
        const err = (event.error ?? {}) as Record<string, unknown>;
        settle(realtimeFailure(String(err.code ?? err.type ?? '')));
        return;
      }
      const translated = translateRealtimeEvent(event, transcripts);
      if (translated) queue.push(translated);
      if (queue.overflowed) socket.terminate();
    });
  });
  socket.removeAllListeners('unexpected-response');
  if (ready) {
    socket.removeAllListeners();
    socket.on('error', () => undefined);
    socket.terminate();
    return { ok: false, category: ready };
  }
  socket.removeAllListeners('error');
  socket.removeAllListeners('close');
  socket.on('error', () => undefined);
  socket.on('close', () => queue.end({ type: 'closed' }));
  return {
    ok: true,
    value: {
      appendAudio(pcm) {
        for (let offset = 0; offset < pcm.length; offset += APPEND_CHUNK_BYTES)
          send({
            type: 'input_audio_buffer.append',
            audio: Buffer.from(pcm.subarray(offset, offset + APPEND_CHUNK_BYTES)).toString(
              'base64',
            ),
          });
      },
      createResponse(instructions) {
        send({
          type: 'response.create',
          response: {
            modalities: ['audio', 'text'],
            ...(instructions ? { instructions } : {}),
          },
        });
      },
      cancelResponse() {
        send({ type: 'response.cancel' });
      },
      updateInstructions(instructions) {
        send({ type: 'session.update', session: { instructions } });
      },
      events: () => queue.iterate(),
      close() {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
          socket.close(1000);
        setTimeout(() => socket.terminate(), 2000).unref();
      },
    },
  };
}

/**
 * 开发 / 测试用假实时会话（upstreamModelId 以 fake- 开头且非生产时）：不连网络。
 * 收到约 0.5 秒以上的声音后再停顿 300ms，当作用户说完一句：出转写并自动回应；用量按字节数确定性给出。
 */
export function openFakeRealtime(_config: RealtimeSessionConfig): RealtimeConnection {
  const queue = new EventQueue<RealtimeTransportEvent>();
  let heard = 0;
  let idle: NodeJS.Timeout | null = null;
  let active: string | null = null;
  let seq = 0;
  let closed = false;
  const respond = () => {
    if (closed || active) return;
    const id = `fake_resp_${++seq}`;
    active = id;
    const audioIn = Math.round((heard / 32_000) * 25);
    heard = 0;
    queue.push({ type: 'response_started', responseId: id });
    for (let i = 0; i < 4; i++)
      queue.push({ type: 'audio', responseId: id, pcm: new Uint8Array(12_000) });
    queue.push({ type: 'assistant_text', responseId: id, text: '（假回应）嗯，我在听。', final: true });
    setTimeout(() => {
      if (active !== id) return;
      active = null;
      queue.push({
        type: 'response_done',
        responseId: id,
        status: 'completed',
        usage: {
          textInputTokens: 200,
          cachedTextInputTokens: 0,
          audioInputTokens: audioIn,
          textOutputTokens: 12,
          audioOutputTokens: 25,
        },
      });
    }, 50);
  };
  return {
    appendAudio(pcm) {
      if (closed) return;
      if (heard === 0) queue.push({ type: 'speech_started' });
      heard += pcm.length;
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => {
        if (heard < 16_000) return;
        queue.push({ type: 'user_transcript', text: '（假识别）用户说了一句话' });
        respond();
      }, 300);
    },
    createResponse: () => respond(),
    cancelResponse() {
      const id = active;
      if (!id) return;
      active = null;
      queue.push({
        type: 'response_done',
        responseId: id,
        status: 'cancelled',
        usage: {
          textInputTokens: 200,
          cachedTextInputTokens: 0,
          audioInputTokens: 0,
          textOutputTokens: 4,
          audioOutputTokens: 10,
        },
      });
    },
    updateInstructions: () => undefined,
    events: () => queue.iterate(),
    close() {
      closed = true;
      if (idle) clearTimeout(idle);
      queue.end({ type: 'closed' });
    },
  };
}
