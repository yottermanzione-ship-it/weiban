/**
 * 模型网关的多媒体扩展（契约 ModelGatewayMediaPort，T-071；通话用的 openRealtimeAsr / streamSpeech 供 T-072）。
 *
 * 与 generateText 相同的「闸门 → 冻结 → 调用 → 结算 / 解冻 → 用量记录」流程，计价单位：
 * 语音合成 ttsChars（tts_10k_chars）、语音识别 asrSeconds（asr_minute）、图片 images（image）、搜索 searchCalls（search_call）。
 * 平台未把任何模型设为对应 defaultFor（speech_synthesis / speech_recognition / image_generation / web_search）时
 * 返回 not_configured，即「平台未开通」。
 *
 * 幂等：非流式调用复用 GenerationCache（同一用户 + 幂等键 24 小时内返回第一次的结果，不再扣费）。
 * 流式调用（实时识别、流式合成）每段 / 每次独立记账，幂等键由调用方保证唯一。
 * 假上游：目录模型 upstreamModelId 以 fake- 开头且非生产环境时走 FakeMediaAdapter，计费照常。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  BACKGROUND_PURPOSES,
  BUDGET_EXEMPT_PURPOSES,
  BillingOwner,
  Id,
  ModelPurpose,
  type BillingReservationPort,
  type DecideInput,
  type DecideOutput,
  type GatewayWebSearchInput,
  type GenerateError,
  type GenerateImageInput,
  type GenerateTextInput,
  type IdentityAccountStatusPort,
  type IdentityDirectoryPort,
  type MediaAssetReadPort,
  type MediaCallBase,
  type MediaCallResult,
  type MediaReadPort,
  type MediaSystemPort,
  type ModelGatewayMediaPort,
  type PortResult,
  type RealtimeAsrSession,
  type StreamingTtsResult,
  type SynthesizeSpeechInput,
  type TranscribeSpeechInput,
  type UsageQuantities,
  type WebSearchResultItem,
} from '@weiban/contracts';
import { APP_CONFIG, CLOCK, type AppConfig, type Clock } from '../../../platform/index.js';
import { BILLING_RESERVATION_PORT } from '../../billing/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT, IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
import { MEDIA_ASSET_READ_PORT, MEDIA_READ_PORT, MEDIA_SYSTEM_PORT } from '../../media/index.js';
import {
  FakeMediaAdapter,
  isFakeModel,
  wavFromPcm,
  type MediaAdapter,
  type MediaAdapterResult,
  type MediaFailure,
  type MediaTarget,
} from '../infra/media-adapter.js';
import { MEDIA_ADAPTER } from '../tokens.js';
import { CatalogService, type DefaultUse, type ModelFacts } from './catalog.js';
import { GenerationCache } from './generation-cache.js';
import { UpstreamService } from './upstreams.js';
import { UsageRecorder } from './usage.js';
import { unavailableReason } from '../domain/rules.js';

type Service = 'speech_synthesis' | 'speech_recognition' | 'image_generation' | 'web_search';

interface Resolved {
  modelKey: string;
  upstreamId: string;
  upstreamModelId: string;
  fake: boolean;
}

/** 一次已冻结、尚未结算的计费段。 */
interface Charge {
  usageRecordId: string;
  holdId: string;
  model: Resolved;
  startedAt: Date;
  wallStart: number;
}

type CallOutcome<T> =
  | { ok: true; value: T; actual: UsageQuantities }
  | { ok: false; category: MediaFailure; actual?: UsageQuantities };

/** 实时识别：16 kHz PCM16 单声道，每秒 32000 字节。 */
const PCM16K_BYTES_PER_SECOND = 32_000;
/** 每段冻结 1 分钟（ADR-0025「长通话分段冻结」）。 */
const ASR_SEGMENT_SECONDS = 60;
/** 断句：说话后静音 700 毫秒，或单句超过 15 秒。 */
const SILENCE_MS = 700;
const MAX_UTTERANCE_SECONDS = 15;
const SPEECH_RMS = 500;

function unitsOf(q: UsageQuantities): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(q)) if (typeof v === 'number') out[k] = v;
  return out;
}

@Injectable()
export class ModelGatewayMedia implements ModelGatewayMediaPort {
  private readonly fakeAdapter = new FakeMediaAdapter();

  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(UpstreamService) private readonly upstreams: UpstreamService,
    @Inject(UsageRecorder) private readonly recorder: UsageRecorder,
    @Inject(GenerationCache) private readonly cache: GenerationCache,
    @Inject(BILLING_RESERVATION_PORT) private readonly billing: BillingReservationPort,
    @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory: IdentityDirectoryPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(MEDIA_READ_PORT) private readonly mediaRead: MediaReadPort,
    @Inject(MEDIA_ASSET_READ_PORT) private readonly assets: MediaAssetReadPort,
    @Inject(MEDIA_ADAPTER) private readonly adapter: MediaAdapter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---------- 服务开通 ----------

  async isServiceEnabled(
    service:
      'speech_synthesis' | 'speech_recognition' | 'image_generation' | 'web_search' | 'vision',
  ): Promise<boolean> {
    const facts = await this.catalog.defaultModel(service);
    return !!facts && unavailableReason(facts.entry, facts.upstreamStatus) === null;
  }

  // ---------- 非流式 ----------

  async synthesizeSpeech(
    input: SynthesizeSpeechInput,
  ): Promise<PortResult<MediaCallResult & { mediaId: string; durationMs: number }, GenerateError>> {
    const text = input.text.trim().slice(0, 2000);
    if (!text || !Id.safeParse(input.voiceId).success) return { ok: false, error: 'bad_request' };
    return this.cached('tts', input, async () => {
      const voice = await this.assets.getVoice(input.voiceId);
      if (!voice || !voice.enabled) return { ok: false, error: 'bad_request' };
      const model = await this.resolve('speech_synthesis', voice.modelKey);
      if (!model.ok) return model;
      const chars = [...text].length;
      return this.run(input, model.value, { ttsChars: chars }, async (target, adapter) => {
        const result = await adapter.synthesize(target, {
          text,
          voice: voice.providerVoiceKey,
          format: input.format === 'pcm16_24k' ? 'wav' : input.format,
        });
        if (!result.ok) return result;
        let bytes = result.value.bytes;
        let mimeType = result.value.mimeType;
        if (mimeType === 'audio/L16') {
          bytes = wavFromPcm(bytes, 24000);
          mimeType = 'audio/wav';
        }
        const durationMs = Math.max(1, Math.min(300_000, result.value.durationMs));
        const saved = await this.media.putObject({
          ownerUserId: input.userId,
          purpose: 'generated_voice',
          bytes,
          mimeType,
          durationMs,
        });
        return {
          ok: true,
          value: { mediaId: saved.mediaId, durationMs },
          actual: { ttsChars: chars },
        };
      });
    });
  }

  async transcribeSpeech(
    input: TranscribeSpeechInput,
  ): Promise<PortResult<MediaCallResult & { text: string }, GenerateError>> {
    if (!Id.safeParse(input.mediaId).success || !Id.safeParse(input.ownerUserId).success)
      return { ok: false, error: 'bad_request' };
    return this.cached('asr', input, async () => {
      if (!(await this.media.canUse(input.ownerUserId, input.mediaId, ['chat_voice'])))
        return { ok: false, error: 'bad_request' };
      const model = await this.resolve('speech_recognition', null);
      if (!model.ok) return model;
      const info = await this.mediaRead
        .getMedia(input.ownerUserId, input.mediaId)
        .catch(() => null);
      const seconds = Math.max(1, Math.ceil((info?.durationMs ?? 60_000) / 1000));
      return this.run(input, model.value, { asrSeconds: seconds }, async (target, adapter) => {
        const file = await this.media.readBytes(input.mediaId);
        const result = await adapter.transcribe(target, file);
        if (!result.ok) return result;
        return { ok: true, value: { text: result.value.text }, actual: { asrSeconds: seconds } };
      });
    });
  }

  async generateImage(
    input: GenerateImageInput,
  ): Promise<PortResult<MediaCallResult & { mediaId: string }, GenerateError>> {
    const prompt = input.prompt.trim().slice(0, 2000);
    if (!prompt || !['1024x1024', '768x1024', '1024x768'].includes(input.size))
      return { ok: false, error: 'bad_request' };
    return this.cached('image', input, async () => {
      const model = await this.resolve('image_generation', null);
      if (!model.ok) return model;
      return this.run(input, model.value, { images: 1 }, async (target, adapter) => {
        const styled =
          input.style === 'classical_illustration' ? `古风插画风格，非写实。${prompt}` : prompt;
        const result = await adapter.generateImage(target, { prompt: styled, size: input.size });
        if (!result.ok) return result;
        const saved = await this.media.putObject({
          ownerUserId: input.ownerUserId,
          purpose: 'generated_image',
          bytes: result.value.bytes,
          mimeType: result.value.mimeType,
        });
        return { ok: true, value: { mediaId: saved.mediaId }, actual: { images: 1 } };
      });
    });
  }

  async webSearch(
    input: GatewayWebSearchInput,
  ): Promise<PortResult<MediaCallResult & { items: WebSearchResultItem[] }, GenerateError>> {
    const query = input.query.trim().slice(0, 300);
    if (!query) return { ok: false, error: 'bad_request' };
    const max = Math.min(Math.max(Math.floor(input.maxResults) || 1, 1), 10);
    return this.cached('search', input, async () => {
      const model = await this.resolve('web_search', null);
      if (!model.ok) return model;
      return this.run(input, model.value, { searchCalls: 1 }, async (target, adapter) => {
        const result = await adapter.search(target, { query, maxResults: max });
        if (!result.ok) return result;
        return { ok: true, value: { items: result.value.hits }, actual: { searchCalls: 1 } };
      });
    });
  }

  /** 行为规划决策（CR-18）由 T-090 实现；在此之前一律「未开通」，决策层按规则版处理。 */
  async decide(_input: DecideInput): Promise<PortResult<DecideOutput, GenerateError>> {
    return { ok: false, error: 'not_configured' };
  }

  // ---------- 流式（通话，ADR-0025） ----------

  async openRealtimeAsr(
    input: MediaCallBase & { sampleRate: 16000 },
  ): Promise<PortResult<RealtimeAsrSession, GenerateError>> {
    if (!(await this.precheck(input))) return { ok: false, error: 'bad_request' };
    const model = await this.resolve('speech_recognition', null);
    if (!model.ok) return model;
    const first = await this.reserve(input, model.value, { asrSeconds: ASR_SEGMENT_SECONDS }, 0);
    if (!first.ok) return first;
    return { ok: true, value: new RealtimeAsr(this, input, model.value, first.value) };
  }

  async streamSpeech(
    input: Omit<SynthesizeSpeechInput, 'format'> & { format: 'pcm16_24k' },
  ): Promise<PortResult<StreamingTtsResult, GenerateError>> {
    const text = input.text.trim().slice(0, 2000);
    if (!text || !(await this.precheck(input))) return { ok: false, error: 'bad_request' };
    const voice = await this.assets.getVoice(input.voiceId);
    if (!voice || !voice.enabled) return { ok: false, error: 'bad_request' };
    const model = await this.resolve('speech_synthesis', voice.modelKey);
    if (!model.ok) return model;
    const chars = [...text].length;
    const charge = await this.reserve(input, model.value, { ttsChars: chars }, 0);
    if (!charge.ok) return charge;
    const controller = new AbortController();
    const started = await this.withTarget(model.value, (target, adapter) =>
      adapter.synthesizeStream(target, { text, voice: voice.providerVoiceKey }, controller.signal),
    ).catch((): MediaAdapterResult<AsyncIterable<Uint8Array>> => ({
      ok: false,
      category: 'provider_error',
    }));
    if (!started.ok) {
      await this.fail(charge.value, started.category);
      return { ok: false, error: this.mapError(started.category) };
    }
    // 中文约每秒 4 字：24 kHz PCM16 每字约 12000 字节；打断时按已收到的音频折算字数。
    const expectedBytes = chars * 12_000;
    let received = 0;
    let settle!: (v: PortResult<MediaCallResult, GenerateError>) => void;
    const done = new Promise<PortResult<MediaCallResult, GenerateError>>((r) => (settle = r));
    const finish = async () => {
      const used = controller.signal.aborted
        ? Math.min(chars, Math.max(1, Math.ceil((chars * received) / expectedBytes)))
        : chars;
      settle(await this.succeed(charge.value, { ttsChars: used }));
    };
    const source = started.value;
    async function* audio(): AsyncIterable<Uint8Array> {
      try {
        for await (const chunk of source) {
          if (controller.signal.aborted) break;
          received += chunk.length;
          yield chunk;
        }
      } finally {
        await finish();
      }
    }
    return {
      ok: true,
      value: { audio: audio(), abort: () => controller.abort(), done },
    };
  }

  // ---------- 内部：计费流程（RealtimeAsr 也会调用） ----------

  /** 账号、ID、用途合法性（与 generateText 相同口径）。 */
  async precheck(base: MediaCallBase): Promise<boolean> {
    if (
      !Id.safeParse(base.userId).success ||
      !ModelPurpose.safeParse(base.purpose).success ||
      !BillingOwner.safeParse(base.billingOwner).success ||
      typeof base.idempotencyKey !== 'string' ||
      !base.idempotencyKey ||
      base.idempotencyKey.length > 200 ||
      (base.billingOwner === 'platform' && !base.purpose.startsWith('admin_'))
    )
      return false;
    if ((await this.accounts.getAccountStatus(base.userId)) !== 'active') return false;
    if (
      base.billingOwner === 'platform' &&
      !(await this.directory.listAdminUserIds()).includes(base.userId)
    )
      return false;
    return true;
  }

  private async resolve(
    service: Service,
    preferredModelKey: string | null,
  ): Promise<PortResult<Resolved, GenerateError>> {
    const fallback = await this.catalog.defaultModel(service as DefaultUse);
    if (!fallback) return { ok: false, error: 'not_configured' };
    let facts: ModelFacts = fallback;
    if (preferredModelKey && preferredModelKey !== fallback.modelKey) {
      const preferred = await this.catalog.fact(preferredModelKey);
      if (unavailableReason(preferred.entry, preferred.upstreamStatus) === null) facts = preferred;
    }
    const reason = unavailableReason(facts.entry, facts.upstreamStatus);
    if (reason === 'model_removed' || !facts.entry)
      return { ok: false, error: 'model_unavailable' };
    if (reason === 'provider_unavailable') return { ok: false, error: 'provider_unavailable' };
    return {
      ok: true,
      value: {
        modelKey: facts.entry.modelKey,
        upstreamId: facts.entry.upstreamId,
        upstreamModelId: facts.entry.upstreamModelId,
        fake: isFakeModel(facts.entry.upstreamModelId, this.config.nodeEnv === 'production'),
      },
    };
  }

  /** 取上游地址与密钥后调用适配器；假上游不取密钥。 */
  private async withTarget<T>(
    model: Resolved,
    fn: (target: MediaTarget, adapter: MediaAdapter) => Promise<T>,
  ): Promise<T> {
    if (model.fake)
      return fn(
        { kind: 'fake', baseUrl: '', apiKey: '', model: model.upstreamModelId },
        this.fakeAdapter,
      );
    const upstream = await this.upstreams.get(model.upstreamId);
    return this.upstreams.withApiKey(model.upstreamId, (apiKey) =>
      fn(
        { kind: upstream.kind, baseUrl: upstream.baseUrl, apiKey, model: model.upstreamModelId },
        this.adapter,
      ),
    );
  }

  async reserve(
    base: MediaCallBase,
    model: Resolved,
    estimate: UsageQuantities,
    segment: number,
  ): Promise<PortResult<Charge, GenerateError>> {
    const key = `media:${base.idempotencyKey}${segment ? `:seg${segment}` : ''}`;
    const usage = await this.recorder.start({
      input: {
        userId: base.userId,
        purpose: base.purpose,
        billingOwner: base.billingOwner,
        modelRole: 'chat',
        characterId: base.characterId,
        conversationId: base.conversationId,
        idempotencyKey: key,
        countAsBackground: base.countAsBackground,
      },
      modelKey: model.modelKey,
      upstreamId: model.upstreamId,
      upstreamModelId: model.upstreamModelId,
      countsAsBackground:
        !BUDGET_EXEMPT_PURPOSES.includes(base.purpose) &&
        (BACKGROUND_PURPOSES.includes(base.purpose) || base.countAsBackground === true),
    });
    if (!usage.created) return { ok: false, error: 'bad_request' };
    const startedAt = this.clock.now();
    const reserve = await this.billing.estimateAndReserve({
      account:
        base.billingOwner === 'user' ? { kind: 'user', userId: base.userId } : { kind: 'platform' },
      purpose: base.purpose,
      modelKey: model.modelKey,
      characterId: base.characterId,
      estimate,
      idempotencyKey: key,
      countAsBackground: base.countAsBackground,
    });
    if (!reserve.ok) {
      const error = reserve.error === 'price_missing' ? 'model_unavailable' : reserve.error;
      await this.recorder.finish(usage.record.id, {
        status: 'failed',
        errorCode: error,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        estimated: false,
        latencyMs: 0,
        retryCount: 0,
      });
      return { ok: false, error };
    }
    await this.recorder.attachHold(usage.record.id, reserve.value);
    return {
      ok: true,
      value: {
        usageRecordId: usage.record.id,
        holdId: reserve.value.holdId,
        model,
        startedAt,
        wallStart: performance.now(),
      },
    };
  }

  async succeed(
    charge: Charge,
    actual: UsageQuantities,
  ): Promise<PortResult<MediaCallResult, GenerateError>> {
    const latencyMs = Math.round(performance.now() - charge.wallStart);
    const settled = await this.billing.settle({
      holdId: charge.holdId,
      usageRecordId: charge.usageRecordId,
      actual,
      startedAt: charge.startedAt.toISOString(),
      upstreamId: charge.model.upstreamId,
    });
    await this.recorder.finish(charge.usageRecordId, {
      status: 'succeeded',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimated: false,
      latencyMs,
      retryCount: 0,
      mediaUnits: unitsOf(actual),
    });
    await this.recorder.writeSettleSnapshot(charge.usageRecordId, settled);
    return {
      ok: true,
      value: {
        modelKey: charge.model.modelKey,
        chargedMicros: settled.amountMicros,
        latencyMs,
        usageRecordId: charge.usageRecordId,
      },
    };
  }

  async fail(
    charge: Charge,
    category: MediaFailure,
    upstreamUsage?: UsageQuantities,
  ): Promise<void> {
    const release = await this.billing.release({
      holdId: charge.holdId,
      reason: category === 'content_rejected' ? 'call_rejected' : 'call_failed',
      upstreamUsage,
      usageRecordId: charge.usageRecordId,
      startedAt: charge.startedAt.toISOString(),
      upstreamId: charge.model.upstreamId,
    });
    await this.recorder.writeReleaseSnapshot(charge.usageRecordId, release);
    await this.recorder.finish(charge.usageRecordId, {
      status: 'failed',
      errorCode: category,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimated: false,
      latencyMs: Math.round(performance.now() - charge.wallStart),
      retryCount: 0,
      ...(upstreamUsage ? { mediaUnits: unitsOf(upstreamUsage) } : {}),
    });
    if (!charge.model.fake && !['content_rejected', 'bad_request'].includes(category))
      await this.upstreams.reportStatus(
        charge.model.upstreamId,
        category === 'invalid_key'
          ? 'invalid'
          : category === 'quota_exhausted'
            ? 'quota_exhausted'
            : 'unavailable',
        'gateway',
        category === 'rate_limited' ? 'provider_error' : category,
      );
  }

  mapError(category: MediaFailure): GenerateError {
    return category === 'content_rejected'
      ? 'content_rejected'
      : category === 'bad_request'
        ? 'bad_request'
        : 'provider_unavailable';
  }

  /** 识别一段 PCM（实时识别断句后调用）。 */
  async transcribePcm(
    model: Resolved,
    pcm: Uint8Array,
  ): Promise<MediaAdapterResult<{ text: string }>> {
    const file = { bytes: wavFromPcm(pcm, 16000), mimeType: 'audio/wav' };
    return this.withTarget(model, (target, adapter) => adapter.transcribe(target, file));
  }

  /** 冻结 → 调用 → 结算 / 解冻。 */
  private async run<T>(
    base: MediaCallBase,
    model: Resolved,
    estimate: UsageQuantities,
    call: (target: MediaTarget, adapter: MediaAdapter) => Promise<CallOutcome<T>>,
  ): Promise<PortResult<T & MediaCallResult, GenerateError>> {
    const charge = await this.reserve(base, model, estimate, 0);
    if (!charge.ok) return charge;
    let outcome: CallOutcome<T>;
    try {
      outcome = await this.withTarget(model, call);
    } catch {
      outcome = { ok: false, category: 'provider_error' };
    }
    if (!outcome.ok) {
      await this.fail(charge.value, outcome.category, outcome.actual);
      return { ok: false, error: this.mapError(outcome.category) };
    }
    const done = await this.succeed(charge.value, outcome.actual);
    if (!done.ok) return done;
    return { ok: true, value: { ...outcome.value, ...done.value } };
  }

  /** 非流式调用的 24 小时幂等（复用文本网关的结果缓存，键加 media: 前缀以免与文本冲突）。 */
  private async cached<T>(
    kind: string,
    input: MediaCallBase,
    fn: () => Promise<PortResult<T, GenerateError>>,
  ): Promise<PortResult<T, GenerateError>> {
    if (!(await this.precheck(input))) return { ok: false, error: 'bad_request' };
    const pseudo = {
      ...input,
      idempotencyKey: `media:${kind}:${input.idempotencyKey}`,
    } as unknown as GenerateTextInput;
    const claim = await this.cache.claim(pseudo);
    if (!claim.created) {
      for (let i = 0; i < 900; i++) {
        const row = await this.cache.get(claim.row.id);
        if (!row) break;
        if (row.phase === 'complete')
          return (await this.cache.open(row)) as unknown as PortResult<T, GenerateError>;
        if (this.clock.nowMs() - row.createdAt.getTime() > 120_000) break;
        await new Promise<void>((r) => setTimeout(r, 100));
      }
      return { ok: false, error: 'provider_unavailable' };
    }
    let result: PortResult<T, GenerateError>;
    try {
      result = await fn();
    } catch {
      result = { ok: false, error: 'provider_unavailable' };
    }
    await this.cache.save(claim.row, result as never, 'complete');
    return result;
  }
}

/**
 * 实时语音识别会话：按能量做简单断句，每句交给识别上游；按分钟分段冻结、结算（ADR-0025）。
 * 余额不足以冻结下一分钟时结束结果流（ai-runtime 据此让角色道别）。
 */
class RealtimeAsr implements RealtimeAsrSession {
  private chain: Promise<void> = Promise.resolve();
  private utterance: Uint8Array[] = [];
  private utteranceBytes = 0;
  private silenceMs = 0;
  private speaking = false;
  private totalBytes = 0;
  private segment = 0;
  private charge: Charge | null;
  private closed = false;
  private closing: Promise<MediaCallResult> | null = null;
  private readonly queue: Array<{ text: string; final: boolean }> = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private chargedMicros = 0;

  constructor(
    private readonly gateway: ModelGatewayMedia,
    private readonly base: MediaCallBase,
    private readonly model: Resolved,
    first: Charge,
  ) {
    this.charge = first;
  }

  pushAudio(chunk: Uint8Array): void {
    if (this.closed || this.ended || !chunk.length) return;
    const data = new Uint8Array(chunk);
    this.chain = this.chain.then(() => this.accept(data)).catch(() => undefined);
  }

  async *results(): AsyncIterable<{ text: string; final: boolean }> {
    for (;;) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((r) => (this.wake = r));
    }
  }

  close(): Promise<MediaCallResult> {
    this.closing ??= this.finish();
    return this.closing;
  }

  private emit(item: { text: string; final: boolean } | null): void {
    if (item) this.queue.push(item);
    else this.ended = true;
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private async accept(chunk: Uint8Array): Promise<void> {
    const before = this.totalBytes;
    this.totalBytes += chunk.length;
    // 跨过分钟边界：结算这一分钟，冻结下一分钟。
    const boundary = (this.segment + 1) * ASR_SEGMENT_SECONDS * PCM16K_BYTES_PER_SECOND;
    if (before < boundary && this.totalBytes >= boundary && this.charge) {
      const done = await this.gateway.succeed(this.charge, { asrSeconds: ASR_SEGMENT_SECONDS });
      if (done.ok) this.chargedMicros += done.value.chargedMicros;
      this.segment++;
      const next = await this.gateway.reserve(
        this.base,
        this.model,
        { asrSeconds: ASR_SEGMENT_SECONDS },
        this.segment,
      );
      this.charge = next.ok ? next.value : null;
      if (!next.ok) {
        await this.flush();
        this.emit(null);
        return;
      }
    }
    // 能量断句。
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let sum = 0;
    const samples = Math.floor(chunk.length / 2);
    for (let i = 0; i < samples; i++) {
      const v = view.getInt16(i * 2, true);
      sum += v * v;
    }
    const rms = samples ? Math.sqrt(sum / samples) : 0;
    const chunkMs = (chunk.length / PCM16K_BYTES_PER_SECOND) * 1000;
    if (rms >= SPEECH_RMS) {
      this.speaking = true;
      this.silenceMs = 0;
    } else if (this.speaking) this.silenceMs += chunkMs;
    if (this.speaking) {
      this.utterance.push(chunk);
      this.utteranceBytes += chunk.length;
    }
    if (
      this.speaking &&
      (this.silenceMs >= SILENCE_MS ||
        this.utteranceBytes >= MAX_UTTERANCE_SECONDS * PCM16K_BYTES_PER_SECOND)
    )
      await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.utteranceBytes) return;
    const pcm = new Uint8Array(Buffer.concat(this.utterance));
    this.utterance = [];
    this.utteranceBytes = 0;
    this.speaking = false;
    this.silenceMs = 0;
    const result = await this.gateway.transcribePcm(this.model, pcm).catch(() => null);
    if (result?.ok && result.value.text.trim())
      this.emit({ text: result.value.text.trim(), final: true });
  }

  private async finish(): Promise<MediaCallResult> {
    this.closed = true;
    await this.chain;
    await this.flush().catch(() => undefined);
    let usageRecordId = this.charge?.usageRecordId ?? '';
    if (this.charge) {
      const usedBytes =
        this.totalBytes - this.segment * ASR_SEGMENT_SECONDS * PCM16K_BYTES_PER_SECOND;
      const seconds = Math.max(1, Math.ceil(usedBytes / PCM16K_BYTES_PER_SECOND));
      const done = await this.gateway.succeed(this.charge, {
        asrSeconds: Math.min(ASR_SEGMENT_SECONDS, seconds),
      });
      if (done.ok) {
        this.chargedMicros += done.value.chargedMicros;
        usageRecordId = done.value.usageRecordId;
      }
      this.charge = null;
    }
    this.emit(null);
    return {
      modelKey: this.model.modelKey,
      chargedMicros: this.chargedMicros,
      latencyMs: 0,
      usageRecordId,
    };
  }
}
