/**
 * V2（2026-10-28）：百炼实时通话音色的按需复刻（声音复刻 HTTP 接口）。只在服务端调用，密钥只放 Authorization 头。
 *
 * 协议依据旧版已跑通的 `server/lib/voice/qwen_realtime_gateway.js` `prepareRealtimeVoice` 与官方文档：
 * - 地址：`{baseUrl}/services/audio/tts/customization`（基址以 /api/v1 结尾；与旧版 customizationUrl 相同）。
 * - Qwen Audio Realtime Plus（`qwen-audio-*-realtime-*`）：`model = voice-enrollment`，`input.action = create_voice`，
 *   `target_model`、`prefix`（字母数字 ≤ 10，旧版 `wb` + sha1(角色ID) 前 8 位）、`audio`（公网 URL 或 Base64 Data URI，
 *   官方推荐字段；旧版用的 `url` 字段官方称将下线）。返回 `output.voice_id`；音色要审核，`query_voice` 的 status
 *   为 OK 才可用（DEPLOYING 等待，UNDEPLOYED 失败）。
 *   https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api
 * - Omni 实时（`qwen3.5-omni-plus-realtime`、`qwen3.8-omni-flash-realtime` 等）：`model = qwen-voice-enrollment`，
 *   `input.action = create`、`target_model`、`preferred_name`（字母数字下划线 ≤ 16，旧版 `wb_` + 前 10 位）、
 *   `audio.data`（Data URI 或公网 URL）、`language = zh`；3.8 Omni 系列必须带 `parameters.voice_clone_mode`。
 *   返回 `output.voice`。0.01 元 / 个，失败不计费；每账号 1000 个；一年未用自动删除。
 *   https://help.aliyun.com/zh/model-studio/qwen-omni-voice-cloning
 *
 * 新站没有公网样本地址，样本一律转成 Data URI（官方两种复刻都支持，Data URI 编码后须 < 10 MB）。
 * 安全：只接受 https 基址，不跟随重定向；响应上限 1 MiB；不记录上游原文、地址或密钥。
 */
import { createHash } from 'node:crypto';
import type { MediaAdapterResult, MediaFailure, MediaTarget } from './media-adapter.js';

const CREATE_TIMEOUT_MS = 60_000;
const QUERY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
/** Data URI 编码后的上限（官方 < 10 MB）；转码后的 15 秒 MP3 只有约 120 KB。 */
const MAX_DATA_URI_BYTES = 9 * 1024 * 1024;
/** Realtime Plus 音色审核：最多查 15 次，每次间隔 2 秒（约 30 秒）。 */
const QUERY_ATTEMPTS = 15;
const QUERY_INTERVAL_MS = 2000;
const VOICE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export interface CloneSampleFile {
  bytes: Uint8Array;
  mimeType: string;
}

export type RealtimeCloneProtocol = 'voice-enrollment' | 'qwen-voice-enrollment';

/** 按上游模型名选复刻协议；不是这两类实时模型返回 null（不复刻）。 */
export function realtimeCloneProtocol(model: string): RealtimeCloneProtocol | null {
  const m = model.trim().toLowerCase();
  if (!/realtime/u.test(m)) return null;
  if (/^qwen-audio-[\d.]+-realtime/u.test(m)) return 'voice-enrollment';
  if (/^qwen[\d.]+-omni-[a-z]+-realtime/u.test(m)) return 'qwen-voice-enrollment';
  return null;
}

const hex = (characterId: string) => createHash('sha1').update(characterId).digest('hex');

export function sampleDataUri(sample: CloneSampleFile): string {
  return `data:${sample.mimeType};base64,${Buffer.from(sample.bytes).toString('base64')}`;
}

/** 创建音色的请求体（纯函数，便于对照旧版与官方逐字段测试）。 */
export function realtimeCloneBody(
  targetModel: string,
  characterId: string,
  audio: string,
): Record<string, unknown> | null {
  const protocol = realtimeCloneProtocol(targetModel);
  if (protocol === 'voice-enrollment')
    return {
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: targetModel,
        prefix: `wb${hex(characterId).slice(0, 8)}`,
        audio,
      },
    };
  if (protocol === 'qwen-voice-enrollment')
    return {
      model: 'qwen-voice-enrollment',
      input: {
        action: 'create',
        target_model: targetModel,
        preferred_name: `wb_${hex(characterId).slice(0, 10)}`,
        audio: { data: audio },
        language: 'zh',
      },
      // 官方：qwen3.8-omni 系列必须给复刻模式；3.5 与旧版一致不带。
      ...(/^qwen3\.8-omni-/iu.test(targetModel)
        ? { parameters: { voice_clone_mode: 'normal' } }
        : {}),
    };
  return null;
}

/**
 * `https://host/api/v1` → `https://host/api/v1/services/audio/tts/customization`；非 https 返回 null。
 * V3：旧服北京 workspace 迁入的基址是 `https://ws-….cn-beijing.maas.aliyuncs.com/api`，兼容模式账号是
 * `…/compatible-mode/v1`，都先去掉再拼 `/api/v1/…`（原先会拼成 `/api/api/v1/…`）。
 */
export function customizationUrl(baseUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' || base.username || base.password) return null;
  const path = base.pathname
    .replace(/\/+$/u, '')
    .replace(/\/(?:api(?:\/v1)?|compatible-mode\/v1)$/iu, '');
  base.pathname = `${path}/api/v1/services/audio/tts/customization`;
  base.search = '';
  base.hash = '';
  return base.href;
}

/** 创建结果里的音色代号：Realtime Plus 是 output.voice_id，Omni 是 output.voice（旧版两者都认）。 */
export function clonedVoiceOf(payload: unknown): string | null {
  const output = (payload as { output?: Record<string, unknown> } | null)?.output;
  const raw = output?.voice_id ?? output?.voice;
  const voice = typeof raw === 'string' ? raw.trim() : '';
  return VOICE.test(voice) ? voice : null;
}

/** 供应商错误 → 平台失败类别（与语音合成同一口径）。 */
export function cloneFailure(status: number, code: string): MediaFailure {
  const c = code.toLowerCase();
  if (status === 402 || ['arrearage', 'insufficient_quota', 'quota_exhausted'].includes(c))
    return 'quota_exhausted';
  if (status === 401 || status === 403 || c === 'invalidapikey' || c === 'invalid_api_key')
    return 'invalid_key';
  if (status === 429 || c.startsWith('throttling')) return 'rate_limited';
  if (c === 'datainspectionfailed' || c === 'data_inspection_failed') return 'content_rejected';
  if (status >= 500) return 'provider_error';
  return 'bad_request';
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

async function post(
  address: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ status: number; payload: Record<string, unknown> | null }> {
  const response = await fetch(address, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await readJson(response) };
}

const codeOf = (payload: Record<string, unknown> | null): string => {
  const err = payload?.error as { code?: unknown } | undefined;
  const code = payload?.code ?? err?.code;
  return typeof code === 'string' ? code : '';
};

export interface CloneDeps {
  /** 两次查询之间的等待（测试替换为立即返回）。 */
  wait?: (ms: number) => Promise<void>;
}

const defaultWait = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

/**
 * 复刻一个只给 target_model（= t.model）用的音色。样本须已按官方要求转码裁剪（见 realtime-clone-sample.ts）。
 * Realtime Plus 创建后查询审核状态，OK 才返回；超时仍在审核按失败处理（可下次再试）。
 */
export async function cloneDashscopeRealtimeVoice(
  t: MediaTarget,
  input: { characterId: string; sample: CloneSampleFile },
  deps: CloneDeps = {},
): Promise<MediaAdapterResult<{ voice: string }>> {
  const protocol = realtimeCloneProtocol(t.model);
  const address = customizationUrl(t.baseUrl);
  if (t.kind !== 'dashscope' || !protocol || !address)
    return { ok: false, category: 'bad_request', zeroCost: true };
  const audio = sampleDataUri(input.sample);
  if (Buffer.byteLength(audio) > MAX_DATA_URI_BYTES)
    return { ok: false, category: 'bad_request', zeroCost: true };
  const body = realtimeCloneBody(t.model, input.characterId, audio)!;
  let created: Awaited<ReturnType<typeof post>>;
  try {
    created = await post(address, t.apiKey, body, CREATE_TIMEOUT_MS);
  } catch {
    return { ok: false, category: 'network_error' };
  }
  if (created.status < 200 || created.status >= 300)
    return { ok: false, category: cloneFailure(created.status, codeOf(created.payload)) };
  const voice = clonedVoiceOf(created.payload);
  if (!voice) return { ok: false, category: 'provider_error' };
  if (protocol === 'qwen-voice-enrollment') return { ok: true, value: { voice } };
  const wait = deps.wait ?? defaultWait;
  for (let i = 0; i < QUERY_ATTEMPTS; i++) {
    let queried: Awaited<ReturnType<typeof post>>;
    try {
      queried = await post(
        address,
        t.apiKey,
        { model: 'voice-enrollment', input: { action: 'query_voice', voice_id: voice } },
        QUERY_TIMEOUT_MS,
      );
    } catch {
      queried = { status: 0, payload: null };
    }
    const output = queried.payload?.output as { status?: unknown } | undefined;
    const status = typeof output?.status === 'string' ? output.status.toUpperCase() : '';
    if (queried.status >= 200 && queried.status < 300) {
      // 没有状态字段 = 官方未要求审核（与旧版一样直接可用）。
      if (status === 'OK' || status === '') return { ok: true, value: { voice } };
      if (status === 'UNDEPLOYED') return { ok: false, category: 'content_rejected' };
    }
    await wait(QUERY_INTERVAL_MS);
  }
  return { ok: false, category: 'provider_error' };
}
