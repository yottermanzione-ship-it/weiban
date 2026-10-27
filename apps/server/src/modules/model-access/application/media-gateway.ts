/**
 * 模型网关的多媒体扩展（契约 ModelGatewayMediaPort，T-071；通话用的 openRealtimeAsr / streamSpeech 供 T-072）。
 *
 * 与 generateText 相同的「闸门 → 冻结 → 调用 → 结算 / 解冻 → 用量记录」流程，计价单位：
 * 语音合成 ttsChars（tts_10k_chars）、语音识别 asrSeconds（asr_minute）、图片 images（image）、搜索 searchCalls（search_call）。
 * 3.22：语音合成 / 语音识别 / 图片生成按用户的场景配置（语音消息 / 语音识别 / 发照片，角色单独设置优先）解析，
 * 未配置返回 not_configured；联网搜索用后台指定的平台内部模型。音色必须绑定用户实际选择的语音模型，不兼容时拒绝，不静默换模型。
 * ADR-20261024：通话（实时识别 / 流式合成）在 `voice_call` 选到组合模型 `voice/cascade-call` 时改用
 * `voice_call_pipeline` 里的识别 / 合成组件；组合模型自身不调用上游，组件停用或删除时整通电话不可用。
 *
 * 幂等：非流式调用复用 GenerationCache（同一用户 + 幂等键 24 小时内返回第一次的结果，不再扣费）。
 * 流式调用（实时识别、流式合成）每段 / 每次独立记账，幂等键由调用方保证唯一。
 * 假上游：目录模型 upstreamModelId 以 fake- 开头且非生产环境时走 FakeMediaAdapter，计费照常。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
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
  type GatewayWebFetchInput,
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
  type OpenRealtimeVoiceInput,
  type RealtimeVoiceSession,
  type VoiceCallRoute,
  type StreamingTtsResult,
  type SynthesizeSpeechInput,
  type TranscribeSpeechInput,
  type UsageQuantities,
  type WebSearchResultItem,
  type RouteBillingBounds,
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
import { CatalogService, type ModelFacts } from './catalog.js';
import { ScenarioService } from './scenarios.js';
import type { ModelScenario } from '@weiban/contracts';
import { GenerationCache, requestHash, type GenerationRow } from './generation-cache.js';
import { UpstreamService } from './upstreams.js';
import { UsageRecorder } from './usage.js';
import { unavailableReason } from '../domain/rules.js';
import { voiceCallFailureError } from './voice-call-composite.js';
import { BillingBoundsService, boundsEvidence, reserveErrorToGenerate } from './billing-bounds.js';
import { pcmWavSeconds, roundAsr } from '../domain/media-billing-bounds.js';
import { probeAudioSeconds } from '../infra/audio-duration.js';
import { WebToolsStore } from './web-tools-store.js';
import { privateSearchText, publicWebUrl } from '../domain/web-search.js';
import { decisionQuestions } from '../infra/jev-adapter.js';
import type { RealtimeConnection } from '../infra/dashscope-realtime.js';
import { realtimeResponseEstimate } from './realtime-call.js';
import { RealtimeVoice } from './realtime-voice-session.js';
import { RealtimeVoiceStore } from './realtime-voices.js';

type Service = 'speech_synthesis' | 'speech_recognition' | 'image_generation' | 'web_search';
const SERVICE_SCENARIO: Record<Exclude<Service, 'web_search'>, ModelScenario> = {
  speech_synthesis: 'voice_message',
  speech_recognition: 'speech_recognition',
  image_generation: 'image_generation',
};

interface Resolved {
  modelKey: string;
  upstreamId: string;
  upstreamModelId: string;
  fake: boolean;
  billingBounds: RouteBillingBounds;
}

/** 一次已冻结、尚未结算的计费段。 */
interface Charge {
  usageRecordId: string;
  holdId: string;
  model: Resolved;
  startedAt: Date;
  wallStart: number;
  attemptId: string;
  sent: boolean;
}

type CallOutcome<T> =
  | { ok: true; value: T; actual: UsageQuantities; actualKnown?: boolean }
  | {
      ok: false;
      category: MediaFailure;
      actual?: UsageQuantities;
      reportedUsage?: UsageQuantities;
      localRateLimit?: boolean;
      zeroCost?: boolean;
    };

type PendingMediaResult = {
  ok: true;
  value: Record<string, unknown>;
  mediaSettlement: { charge: Charge; actual: UsageQuantities; actualKnown: boolean };
};

/** 实时识别：16 kHz PCM16 单声道，每秒 32000 字节。 */
const PCM16K_BYTES_PER_SECOND = 32_000;
/** 每段冻结 1 分钟（ADR-0025「长通话分段冻结」）。 */

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
  private readonly activeGenerations = new WeakMap<object, GenerationRow>();

  constructor(
    @Inject(WebToolsStore) private readonly webTools: WebToolsStore,
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
    @Optional() @Inject(BillingBoundsService) private readonly bounds?: BillingBoundsService,
    @Optional() @Inject(ScenarioService) private readonly scenarios?: ScenarioService,
    @Optional() @Inject(RealtimeVoiceStore) private readonly realtimeVoices?: RealtimeVoiceStore,
  ) {}

  // ---------- 服务开通 ----------

  async isServiceEnabled(
    service:
      'speech_synthesis' | 'speech_recognition' | 'image_generation' | 'web_search' | 'vision',
  ): Promise<boolean> {
    // 3.22：平台是否「开通」= 有可用于该场景的模型（以推荐模型为代表；没有推荐时看任一启用模型）。
    const facts =
      service === 'web_search'
        ? await this.catalog.internalModel('web_search')
        : await this.anyScenarioModel(service === 'vision' ? 'vision' : SERVICE_SCENARIO[service]);
    if (!facts?.entry || unavailableReason(facts.entry, facts.upstreamStatus) !== null)
      return false;
    if (
      service === 'web_search' &&
      !isFakeModel(facts.entry.upstreamModelId, this.config.nodeEnv === 'production')
    ) {
      const upstream = await this.upstreams.get(facts.entry.upstreamId);
      if (!['deepseek_search', 'bocha_search'].includes(upstream.kind)) return false;
    }
    const bounds = await this.bounds?.get(
      facts.entry.modelKey,
      facts.entry.upstreamId,
      facts.entry.upstreamModelId,
    );
    return !!(service === 'speech_synthesis'
      ? bounds?.tts
      : service === 'speech_recognition'
        ? bounds?.asr
        : service === 'image_generation'
          ? bounds?.image
          : service === 'web_search'
            ? bounds?.search
            : bounds?.text);
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
      const model = await this.resolve(
        'speech_synthesis',
        voice.modelKey,
        input,
        undefined,
        voice.tags?.includes('legacy') === true,
      );
      if (!model.ok) return model;
      const providerVoice = await this.providerVoice(voice);
      if (providerVoice === null) return { ok: false, error: 'bad_request' };
      const chars = this.ttsUnits(model.value, text);
      if (chars === null) return { ok: false, error: 'model_unavailable' };
      return this.run(
        input,
        model.value,
        { ttsChars: this.ttsEstimate(model.value, text, chars) },
        async (target, adapter) => {
          const result = await adapter.synthesize(target, {
            text,
            voice: providerVoice,
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
          const saved = await this.media
            .putObject({
              ownerUserId: input.userId,
              purpose: 'generated_voice',
              bytes,
              mimeType,
              durationMs,
            })
            .catch(() => null);
          if (!saved)
            return { ok: false, category: 'provider_error', reportedUsage: result.reportedUsage };
          return {
            ok: true,
            value: { mediaId: saved.mediaId, durationMs },
            actual: { ttsChars: result.reportedUsage?.ttsChars ?? chars },
            actualKnown: result.reportedUsage?.ttsChars !== undefined,
          };
        },
      );
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
      const model = await this.resolve('speech_recognition', null, input);
      if (!model.ok) return model;
      const info = await this.mediaRead
        .getMedia(input.ownerUserId, input.mediaId)
        .catch(() => null);
      const file = await this.media.readBytes(input.mediaId);
      // 浏览器录音是 webm/mp4，旧版会把原文件直接交给识别；这里用容器真实时长做冻结估算，
      // 不再因为缺少 WAV 头而拒绝识别（结算仍以供应商上报秒数为准）。
      const duration =
        pcmWavSeconds(file.bytes) ??
        (await probeAudioSeconds(file.bytes)) ??
        (info?.durationMs ? info.durationMs / 1000 : null);
      const profile = model.value.billingBounds.asr;
      if (!info || duration === null || !profile || duration > profile.maxSeconds)
        return { ok: false, error: 'model_unavailable' };
      const seconds = roundAsr(duration, profile.billingStepSeconds);
      return this.run(input, model.value, { asrSeconds: seconds }, async (target, adapter) => {
        const result = await adapter.transcribe(target, file);
        if (!result.ok) return result;
        const measured = result.value.asrSeconds;
        if (measured !== undefined && (!Number.isFinite(measured) || measured < 0))
          return { ok: false, category: 'provider_error' };
        return {
          ok: true,
          value: { text: result.value.text },
          actual: {
            asrSeconds:
              measured === undefined ? seconds : roundAsr(measured, profile.billingStepSeconds),
          },
          actualKnown: measured !== undefined,
        };
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
      const model = await this.resolve('image_generation', null, input);
      if (!model.ok) return model;
      if (!model.value.billingBounds.image?.sizes.includes(input.size))
        return { ok: false, error: 'model_unavailable' };
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
    if (
      !query ||
      privateSearchText(query) ||
      privateSearchText(input.originalQuestion ?? '') ||
      input.billingOwner !== 'platform'
    )
      return { ok: false, error: 'bad_request' };
    const max = Math.min(Math.max(Math.floor(input.maxResults) || 1, 1), 10);
    return this.cached('search', input, async () => {
      const model = await this.resolve('web_search', null, input);
      if (!model.ok) return model;
      const search = model.value.billingBounds.search;
      if (!search || max > search.maxResults) return { ok: false, error: 'model_unavailable' };
      const key = this.webTools.key(
        model.value.modelKey,
        input.purpose,
        query,
        max,
        input.originalQuestion,
      );
      // 请求正文不进长期共享缓存；需要正文的调用仍受每用户幂等保护。
      const claim = input.needContent ? null : await this.webTools.claim(key, input.purpose);
      if (claim?.kind === 'hit') return { ok: true, value: claim.value };
      if (claim?.kind === 'busy') return { ok: false, error: 'provider_unavailable' };
      try {
        const result = await this.run(
          input,
          model.value,
          { searchCalls: 1 },
          async (target, adapter) => {
            const found = await adapter.search(target, {
              query,
              maxResults: max,
              needContent: input.needContent,
              originalQuestion: input.originalQuestion,
              ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
            });
            if (!found.ok)
              return { ...found, ...(found.zeroCost ? { actual: { searchCalls: 0 } } : {}) };
            return {
              ok: true,
              value: {
                items: found.value.hits.filter(
                  (hit) => !privateSearchText(`${hit.title} ${hit.snippet} ${hit.content ?? ''}`),
                ),
              },
              actual: {
                searchCalls: (found.value.billable ?? found.value.hits.length > 0) ? 1 : 0,
              },
            };
          },
        );
        if (claim?.kind === 'claimed')
          await this.webTools.finish(
            key,
            claim.token,
            input.purpose,
            result.ok ? result.value : null,
          );
        return result;
      } catch (error) {
        if (claim?.kind === 'claimed')
          await this.webTools.finish(key, claim.token, input.purpose, null);
        throw error;
      }
    });
  }

  async webFetch(
    input: GatewayWebFetchInput,
  ): Promise<PortResult<MediaCallResult & { title: string; content: string }, GenerateError>> {
    const url = publicWebUrl(input.url);
    if (
      !url ||
      privateSearchText(url) ||
      input.billingOwner !== 'platform' ||
      !input.purpose.startsWith('admin_')
    )
      return { ok: false, error: 'bad_request' };
    return this.cached('fetch', input, async () => {
      const model = await this.resolve('web_search', null, input);
      if (!model.ok) return model;
      return this.run(input, model.value, { searchCalls: 1 }, async (target, adapter) => {
        if (!adapter.fetchPage || target.kind !== 'deepseek_search')
          return { ok: false, category: 'bad_request', actual: { searchCalls: 0 } };
        const result = await adapter.fetchPage(target, { url });
        if (!result.ok)
          return { ...result, ...(result.zeroCost ? { actual: { searchCalls: 0 } } : {}) };
        const value = privateSearchText(`${result.value.title} ${result.value.content}`)
          ? { title: '', content: '' }
          : result.value;
        return { ok: true, value, actual: { searchCalls: result.value.content.trim() ? 1 : 0 } };
      });
    });
  }

  /**
   * 行为规划决策（CR-18，T-090）：模型由调用方按决策层配置指定（目录中登记的 Jev 模型）；按输入 token 计价，
   * 与其他调用相同的冻结 / 结算 / 用量记录。假上游（fake-）时确定性输出。真实 Jev 接口「待配置后验证」。
   */
  async decide(input: DecideInput): Promise<PortResult<DecideOutput, GenerateError>> {
    return this.decision(input, false);
  }

  /**
   * 4.3（批 EJ）：能否做原生判定。与 decision() 同一口径：目录在、未下架、上游可用、非成人模型、
   * 主线路有核准的 billingBounds.decision。capabilities 不参与（Jev 目录条目的 capabilities 本来为空）。
   */
  async decisionModelStatus(modelKey: string): Promise<{
    ready: boolean;
    reason:
      'not_decision_model' | 'model_removed' | 'provider_unavailable' | 'model_not_allowed' | null;
  }> {
    const facts = await this.catalog.fact(modelKey);
    const reason = unavailableReason(facts.entry, facts.upstreamStatus);
    if (!facts.entry || reason === 'model_removed')
      return { ready: false, reason: 'model_removed' };
    if (facts.entry.capabilities.includes('adult_content'))
      return { ready: false, reason: 'model_not_allowed' };
    const bounds = await this.bounds?.get(
      facts.entry.modelKey,
      facts.entry.upstreamId,
      facts.entry.upstreamModelId,
    );
    if (!bounds?.decision) return { ready: false, reason: 'not_decision_model' };
    if (reason === 'provider_unavailable') return { ready: false, reason: 'provider_unavailable' };
    return { ready: true, reason: null };
  }

  /** 4.3（批 EJ）：语音动作预检，与 synthesizeSpeech 同一解析（音色登记模型必须等于用户所选），不调上游。 */
  async speechSynthesisReady(input: {
    userId: string;
    characterId: string;
    voiceId: string;
  }): Promise<boolean> {
    if (!Id.safeParse(input.voiceId).success) return false;
    const voice = await this.assets.getVoice(input.voiceId).catch(() => null);
    if (!voice || !voice.enabled) return false;
    const model = await this.resolve(
      'speech_synthesis',
      voice.modelKey,
      {
        userId: input.userId,
        characterId: input.characterId,
        purpose: 'voice',
        billingOwner: 'user',
        idempotencyKey: `tts-ready:${input.userId}:${input.characterId}`,
      },
      undefined,
      voice.tags?.includes('legacy') === true,
    );
    if (!model.ok) return false;
    // 预检不读参考音频字节；只核对与 providerVoice 相同的登记关系，真正合成时再完整校验。
    if (!voice.providerVoiceKey.startsWith('mimo-reference:')) return true;
    const sampleId = voice.providerVoiceKey.slice('mimo-reference:'.length);
    return (
      Id.safeParse(sampleId).success &&
      sampleId === voice.sampleMediaId &&
      !!voice.modelKey?.startsWith('xiaomi/mimo-')
    );
  }

  async decidePublicImage(input: {
    userId: string;
    idempotencyKey: string;
    deadlineAt: string;
    clueCount: number;
    needsFacts: boolean;
  }): Promise<PortResult<DecideOutput, GenerateError>> {
    if (
      !Number.isInteger(input.clueCount) ||
      input.clueCount < 1 ||
      input.clueCount > 4 ||
      typeof input.needsFacts !== 'boolean'
    )
      return { ok: false, error: 'bad_request' };
    const model = await this.catalog.internalModel('planner');
    if (!model) return { ok: false, error: 'not_configured' };
    return this.decision(
      {
        userId: input.userId,
        purpose: 'behavior_planning',
        billingOwner: 'platform',
        modelKey: model.modelKey,
        idempotencyKey: input.idempotencyKey,
        deadlineAt: input.deadlineAt,
        state: { approvedPublicWorkCount: input.clueCount, needsExternalFacts: input.needsFacts },
        questions: [
          {
            questionId: 'public_clues',
            kind: 'yes_no',
            prompt: '已通过本地规则核实有公开作品标题。是否足以按标题查询公开作品资料？',
          },
          {
            questionId: 'external_facts',
            kind: 'yes_no',
            prompt:
              'needsExternalFacts 表示当前问题需要作品资料之外的新事实。是否需要查询？false 时回答 no。',
          },
        ],
      },
      true,
    );
  }

  private async decision(
    input: DecideInput,
    publicImage: boolean,
  ): Promise<PortResult<DecideOutput, GenerateError>> {
    if (
      input.purpose !== 'behavior_planning' ||
      !input.modelKey ||
      !Array.isArray(input.questions) ||
      input.questions.length === 0 ||
      input.questions.length > 20
    )
      return { ok: false, error: 'bad_request' };
    const timeoutMs = input.deadlineAt
      ? Math.min(10000, Date.parse(input.deadlineAt) - this.clock.nowMs())
      : 10000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { ok: false, error: 'bad_request' };
    return this.cached(publicImage ? 'public-image-decision' : 'decide', input, async () => {
      const facts = await this.catalog.fact(input.modelKey);
      const reason = unavailableReason(facts.entry, facts.upstreamStatus);
      if (!facts.entry || reason === 'model_removed')
        return { ok: false, error: 'model_unavailable' };
      if (reason === 'provider_unavailable') return { ok: false, error: 'provider_unavailable' };
      if (facts.entry.capabilities.includes('adult_content'))
        return { ok: false, error: 'model_not_allowed' };
      const billingBounds = await this.bounds?.get(
        facts.entry.modelKey,
        facts.entry.upstreamId,
        facts.entry.upstreamModelId,
      );
      if (!billingBounds?.decision) return { ok: false, error: 'model_unavailable' };
      const model: Resolved = {
        modelKey: facts.entry.modelKey,
        upstreamId: facts.entry.upstreamId,
        upstreamModelId: facts.entry.upstreamModelId,
        fake: isFakeModel(facts.entry.upstreamModelId, this.config.nodeEnv === 'production'),
        billingBounds,
      };
      const estimateTokens = billingBounds.decision.maxInputTokens;
      const questions = input.questions.map((q) => ({
        questionId: q.questionId,
        kind: q.kind,
        prompt: q.prompt,
        options:
          q.kind === 'yes_no'
            ? ['yes', 'no']
            : q.kind === 'scale' &&
                Number.isInteger(q.scaleSize) &&
                q.scaleSize! >= 2 &&
                q.scaleSize! <= 10
              ? Array.from({ length: q.scaleSize! }, (_, i) => String(i))
              : (q.options ?? []),
      }));
      if (
        !decisionQuestions(questions) ||
        input.questions.some(
          (q) =>
            q.kind === 'scale' &&
            (!Number.isInteger(q.scaleSize) || q.scaleSize! < 2 || q.scaleSize! > 10),
        )
      )
        return { ok: false, error: 'bad_request' };
      return this.run(
        input,
        model,
        { inputTokens: estimateTokens, outputTokens: 0 },
        async (target, adapter) => {
          const remaining = input.deadlineAt
            ? Math.min(timeoutMs, Date.parse(input.deadlineAt) - this.clock.nowMs())
            : timeoutMs;
          if (remaining <= 0)
            return {
              ok: false,
              category: 'bad_request',
              actual: { inputTokens: 0, outputTokens: 0 },
            };
          const result = await adapter.decide(target, {
            state: input.state,
            questions,
            timeoutMs: remaining,
          });
          if (!result.ok)
            return {
              ...result,
              ...(result.zeroCost ? { actual: { inputTokens: 0, outputTokens: 0 } } : {}),
            };
          return {
            ok: true,
            value: { answers: result.value.answers },
            actual: { inputTokens: result.value.inputTokens, outputTokens: 0 },
            actualKnown: result.value.inputTokensEstimated !== true,
          };
        },
      );
    });
  }

  // ---------- 流式（通话，ADR-0025） ----------

  async openRealtimeAsr(
    input: MediaCallBase & { sampleRate: 16000 },
  ): Promise<PortResult<RealtimeAsrSession, GenerateError>> {
    if (!(await this.precheck(input))) return { ok: false, error: 'bad_request' };
    const model = await this.resolve('speech_recognition', null, input, 'asr');
    if (!model.ok) return model;
    const profile = model.value.billingBounds.asr!;
    const first = await this.reserve(
      input,
      model.value,
      {
        asrSeconds: roundAsr(
          Math.min(MAX_UTTERANCE_SECONDS, profile.maxSeconds),
          profile.billingStepSeconds,
        ),
      },
      0,
    );
    if (!first.ok) return first;
    return { ok: true, value: new RealtimeAsr(this, input, model.value, first.value) };
  }

  // ---------- 实时语音 / Omni 通话（批 V，契约 4.5） ----------

  async voiceCallRoute(input: { userId: string; characterId: string }): Promise<VoiceCallRoute> {
    const plan = this.scenarios
      ? await this.scenarios.voiceCallPlan(input.userId, input.characterId)
      : null;
    if (plan?.kind !== 'realtime') return { kind: 'cascade' };
    const model = await this.resolveRealtime(plan.facts);
    return model.ok
      ? { kind: 'realtime', modelKey: model.value.modelKey }
      : { kind: 'unavailable', error: model.error };
  }

  async openRealtimeVoice(
    input: OpenRealtimeVoiceInput,
  ): Promise<PortResult<RealtimeVoiceSession, GenerateError>> {
    const instructions = input.instructions.trim().slice(0, 20_000);
    if (
      !instructions ||
      input.sampleRate !== 16000 ||
      !Id.safeParse(input.characterId).success ||
      !(await this.precheck(input))
    )
      return { ok: false, error: 'bad_request' };
    const plan = this.scenarios
      ? await this.scenarios.voiceCallPlan(input.userId, input.characterId)
      : null;
    if (plan?.kind !== 'realtime') return { ok: false, error: 'not_configured' };
    const model = await this.resolveRealtime(plan.facts);
    if (!model.ok) return model;
    const bounds = model.value.billingBounds.realtime!;
    if (!model.value.fake) {
      const upstream = await this.upstreams.get(model.value.upstreamId);
      if (upstream.kind !== 'dashscope') return { ok: false, error: 'model_unavailable' };
    }
    const voice = await this.realtimeVoices?.voiceFor(input.characterId, model.value.modelKey);
    if (!voice) return { ok: false, error: 'not_configured' };
    const estimate = realtimeResponseEstimate(bounds, instructions.length);
    const first = await this.reserve(input, model.value, estimate, 0);
    if (!first.ok) return first;
    // 握手与会话参数不计费（供应商按回应计费）；冻结段在回应真正开始时才标记已发送。
    const opened = await this.withTarget(model.value, async (target, adapter) =>
      adapter.openRealtime
        ? adapter.openRealtime(target, { instructions, voice })
        : ({ ok: false, category: 'bad_request', zeroCost: true } as const),
    ).catch((): MediaAdapterResult<RealtimeConnection> => ({
      ok: false,
      category: 'network_error',
    }));
    if (!opened.ok) {
      await this.cancelCharge(first.value);
      if (opened.category === 'invalid_key' || opened.category === 'quota_exhausted')
        await this.upstreams
          .reportStatus(
            model.value.upstreamId,
            opened.category === 'invalid_key' ? 'invalid' : 'quota_exhausted',
            'gateway',
            opened.category,
          )
          .catch(() => undefined);
      return { ok: false, error: this.mapError(opened.category) };
    }
    const session = new RealtimeVoice<Charge>(
      {
        reserve: (segment) => this.reserve(input, model.value, estimate, segment),
        beginCharge: (charge) => this.beginCharge(charge),
        succeed: (charge, actual, known) => this.succeed(charge, actual, known),
        failUnknown: (charge) => this.fail(charge, 'provider_error', undefined, false),
        cancelCharge: (charge) => this.cancelCharge(charge),
      },
      { modelKey: model.value.modelKey, bounds },
      opened.value,
      first.value,
    );
    session.start();
    return { ok: true, value: session };
  }

  /** 实时通话模型的线路：目录启用、上游可用、核准了 realtime 计费上限。不换别的模型。 */
  private async resolveRealtime(facts: ModelFacts): Promise<PortResult<Resolved, GenerateError>> {
    const reason = unavailableReason(facts.entry, facts.upstreamStatus);
    if (reason === 'model_removed' || !facts.entry)
      return { ok: false, error: 'model_unavailable' };
    if (reason === 'provider_unavailable') return { ok: false, error: 'provider_unavailable' };
    const billingBounds = await this.bounds?.get(
      facts.entry.modelKey,
      facts.entry.upstreamId,
      facts.entry.upstreamModelId,
    );
    if (!billingBounds?.realtime) return { ok: false, error: 'model_unavailable' };
    return {
      ok: true,
      value: {
        modelKey: facts.entry.modelKey,
        upstreamId: facts.entry.upstreamId,
        upstreamModelId: facts.entry.upstreamModelId,
        fake: isFakeModel(facts.entry.upstreamModelId, this.config.nodeEnv === 'production'),
        billingBounds,
      },
    };
  }

  async streamSpeech(
    input: Omit<SynthesizeSpeechInput, 'format'> & { format: 'pcm16_24k' },
  ): Promise<PortResult<StreamingTtsResult, GenerateError>> {
    const text = input.text.trim().slice(0, 2000);
    if (!text || !(await this.precheck(input))) return { ok: false, error: 'bad_request' };
    const voice = await this.assets.getVoice(input.voiceId);
    if (!voice || !voice.enabled) return { ok: false, error: 'bad_request' };
    const model = await this.resolve(
      'speech_synthesis',
      voice.modelKey,
      input,
      'tts',
      voice.tags?.includes('legacy') === true,
    );
    if (!model.ok) return model;
    const providerVoice = await this.providerVoice(voice);
    if (providerVoice === null) return { ok: false, error: 'bad_request' };
    const chars = this.ttsUnits(model.value, text);
    if (chars === null) return { ok: false, error: 'model_unavailable' };
    const charge = await this.reserve(
      input,
      model.value,
      { ttsChars: this.ttsEstimate(model.value, text, chars) },
      0,
    );
    if (!charge.ok) return charge;
    if (!(await this.beginCharge(charge.value))) {
      await this.fail(charge.value, 'provider_error');
      return { ok: false, error: 'model_unavailable' };
    }
    const controller = new AbortController();
    const started = await this.withTarget(model.value, (target, adapter) =>
      adapter.synthesizeStream(target, { text, voice: providerVoice }, controller.signal),
    ).catch((): MediaAdapterResult<AsyncIterable<Uint8Array>> => ({
      ok: false,
      category: 'provider_error',
    }));
    if (!started.ok) {
      await this.fail(
        charge.value,
        started.category,
        started.zeroCost ? { ttsChars: 0 } : started.reportedUsage,
      );
      return { ok: false, error: this.mapError(started.category) };
    }
    let settle!: (v: PortResult<MediaCallResult, GenerateError>) => void;
    const done = new Promise<PortResult<MediaCallResult, GenerateError>>((r) => (settle = r));
    let finishing: Promise<void> | null = null;
    let delivered = false;
    const actualChars = started.reportedUsage?.ttsChars ?? chars;
    const usageReported = started.reportedUsage?.ttsChars !== undefined;
    const finish = () =>
      (finishing ??= (async () => {
        // Native whole-utterance synthesis may already have reported all billable units.
        // Playback cancellation cannot erase those units or estimate them from delivered bytes.
        if (completed && !controller.signal.aborted && !delivered) {
          await this.fail(charge.value, 'provider_error', started.reportedUsage);
          settle({ ok: false, error: 'provider_unavailable' });
          return;
        }
        settle(await this.succeed(charge.value, { ttsChars: actualChars }, usageReported));
      })());
    const source = started.value;
    let completed = false;
    async function* audio(): AsyncIterable<Uint8Array> {
      try {
        for await (const chunk of source) {
          if (controller.signal.aborted) break;
          delivered ||= chunk.length > 0;
          yield chunk;
        }
        completed = !controller.signal.aborted;
      } finally {
        await finish();
      }
    }
    return {
      ok: true,
      value: {
        audio: audio(),
        abort: () => {
          controller.abort();
          void finish();
        },
        done,
      },
    };
  }

  // ---------- 内部：计费流程（RealtimeAsr 也会调用） ----------

  /** 账号、ID、用途合法性（与 generateText 相同口径）。 */
  async precheck(
    base: MediaCallBase,
    platformSearch = false,
    publicImage = false,
  ): Promise<boolean> {
    const candidate = platformSearch && base.purpose === 'search_candidates';
    if (
      !Id.safeParse(base.userId).success ||
      !ModelPurpose.safeParse(base.purpose).success ||
      !BillingOwner.safeParse(base.billingOwner).success ||
      typeof base.idempotencyKey !== 'string' ||
      !base.idempotencyKey ||
      base.idempotencyKey.length > 200 ||
      (base.billingOwner === 'platform' &&
        !base.purpose.startsWith('admin_') &&
        !candidate &&
        !publicImage)
    )
      return false;
    if ((await this.accounts.getAccountStatus(base.userId)) !== 'active') return false;
    // 3.22（批 E2 遗留）：封禁账号不产生用户付费调用（生态发语音 / 发照片等后台任务跳过、不扣积分）。
    if (
      (base.billingOwner === 'user' || candidate || publicImage) &&
      (await this.accounts.isBanned?.(base.userId))
    )
      return false;
    if (
      base.billingOwner === 'platform' &&
      !candidate &&
      !publicImage &&
      !(await this.directory.listAdminUserIds()).includes(base.userId)
    )
      return false;
    return true;
  }

  /** 可用于某场景的代表模型：推荐模型优先，否则任一启用且标注该场景的模型。 */
  /** MiMo uses the stored reference bytes on each request, never a persistent clone id. */
  private async providerVoice(
    voice: NonNullable<Awaited<ReturnType<MediaAssetReadPort['getVoice']>>>,
  ): Promise<string | null> {
    if (!voice.providerVoiceKey.startsWith('mimo-reference:')) return voice.providerVoiceKey;
    const sampleId = voice.providerVoiceKey.slice('mimo-reference:'.length);
    if (
      !Id.safeParse(sampleId).success ||
      sampleId !== voice.sampleMediaId ||
      !voice.modelKey?.startsWith('xiaomi/mimo-')
    )
      return null;
    try {
      const sample = await this.media.readBytes(sampleId);
      if (
        !['audio/mpeg', 'audio/wav'].includes(sample.mimeType) ||
        sample.bytes.length === 0 ||
        sample.bytes.length > 7 * 1024 * 1024
      )
        return null;
      return `data:${sample.mimeType};base64,${Buffer.from(sample.bytes).toString('base64')}`;
    } catch {
      return null;
    }
  }

  private async anyScenarioModel(scenario: ModelScenario): Promise<ModelFacts | null> {
    const recommended = await this.catalog.recommendedModel(scenario);
    if (recommended) return recommended;
    const first = (await this.catalog.listModels(undefined, scenario)).find((m) => m.available);
    return first ? this.catalog.fact(first.modelKey) : null;
  }

  /**
   * 按场景配置解析媒体模型（执行与计费共用）。音色代号仅在其登记的模型上有效；
   * 与用户/角色实际选择不一致或缺少绑定时拒绝，绝不偷偷跨模型或跨供应商。
   * `callComponent` 只由通话的实时识别 / 流式合成传入：`voice_call` 选到组合模型时改用
   * `voice_call_pipeline` 的对应组件，组件不可用直接返回原因，不退回普通场景。
   */
  private async resolve(
    service: Service,
    preferredModelKey: string | null,
    base: MediaCallBase,
    callComponent?: 'asr' | 'tts',
    legacyVoice = false,
  ): Promise<PortResult<Resolved, GenerateError>> {
    let picked: ModelFacts | null;
    if (service === 'web_search') picked = await this.catalog.internalModel('web_search');
    else {
      const plan =
        callComponent && this.scenarios
          ? await this.scenarios.voiceCallPlan(base.userId, base.characterId ?? null)
          : null;
      if (plan?.kind === 'unavailable')
        return { ok: false, error: voiceCallFailureError(plan.failure) };
      if (plan?.kind === 'composite' && callComponent) picked = plan.components[callComponent];
      else {
        const scenario = SERVICE_SCENARIO[service];
        picked =
          (await this.scenarios?.pick(base.userId, scenario, base.characterId ?? null))?.facts ??
          null;
        if (!picked && base.purpose.startsWith('admin_'))
          picked = await this.catalog.recommendedModel(scenario);
      }
    }
    // Migrated character voices carry their own supplier/model identity. Use exactly that
    // registered model (and its billing rates), never send a Qwen key to MiMo or vice versa.
    // Ordinary manually selected voices retain the strict scenario-matching behavior below.
    if (service === 'speech_synthesis' && legacyVoice && preferredModelKey) {
      const legacy = await this.catalog.fact(preferredModelKey);
      if (
        !legacy.entry?.capabilities.includes('voice_output') ||
        !legacy.entry.scenarios.includes('voice_message')
      )
        return { ok: false, error: 'model_unavailable' };
      picked = legacy;
    }
    if (!picked) return { ok: false, error: 'not_configured' };
    // A provider voice is scoped to its registered model. Never silently replace the user's
    // scenario/character selection (including for calls), nor send its key to another provider.
    if (service === 'speech_synthesis' && preferredModelKey !== picked.modelKey)
      return { ok: false, error: 'model_unavailable' };
    const facts: ModelFacts = picked;
    const reason = unavailableReason(facts.entry, facts.upstreamStatus);
    if (reason === 'model_removed' || !facts.entry)
      return { ok: false, error: 'model_unavailable' };
    if (reason === 'provider_unavailable') return { ok: false, error: 'provider_unavailable' };
    if (
      service === 'web_search' &&
      !isFakeModel(facts.entry.upstreamModelId, this.config.nodeEnv === 'production')
    ) {
      const upstream = await this.upstreams.get(facts.entry.upstreamId);
      if (!['deepseek_search', 'bocha_search'].includes(upstream.kind))
        return { ok: false, error: 'not_configured' };
    }
    const billingBounds = await this.bounds?.get(
      facts.entry.modelKey,
      facts.entry.upstreamId,
      facts.entry.upstreamModelId,
    );
    const profile =
      service === 'speech_synthesis'
        ? billingBounds?.tts
        : service === 'speech_recognition'
          ? billingBounds?.asr
          : service === 'image_generation'
            ? billingBounds?.image
            : billingBounds?.search;
    if (!billingBounds || !profile) return { ok: false, error: 'model_unavailable' };
    return {
      ok: true,
      value: {
        modelKey: facts.entry.modelKey,
        upstreamId: facts.entry.upstreamId,
        upstreamModelId: facts.entry.upstreamModelId,
        fake: isFakeModel(facts.entry.upstreamModelId, this.config.nodeEnv === 'production'),
        billingBounds,
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
    const key = `media:${base.userId}:${boundsEvidence([base.idempotencyKey, model.modelKey, base.purpose])}${segment ? `:seg${segment}` : ''}`;
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
      ceiling: { usage: estimate, evidence: boundsEvidence(model.billingBounds) },
      idempotencyKey: key,
      countAsBackground: base.countAsBackground,
      ecologyTask: base.ecologyTask,
    });
    if (!reserve.ok) {
      const error = reserveErrorToGenerate(reserve.error);
      await this.recorder.writeReleaseSnapshot(usage.record.id, {
        absorbedCostMicros: 0,
        costKnown: true,
      });
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
    const attemptId = await this.recorder.startAttempt({
      generationId: this.activeGenerations.get(base)?.id ?? usage.record.id,
      userId: base.userId,
      ordinal: 0,
      modelKey: model.modelKey,
      upstreamId: model.upstreamId,
      upstreamModelId: model.upstreamModelId,
      usageRecordId: usage.record.id,
      holdId: reserve.value.holdId,
      boundSnapshot: {
        bounds: model.billingBounds,
        usage: estimate,
        priceVersionId: reserve.value.priceVersionId,
      },
    });
    return {
      ok: true,
      value: {
        usageRecordId: usage.record.id,
        holdId: reserve.value.holdId,
        model,
        startedAt,
        wallStart: performance.now(),
        attemptId,
        sent: false,
      },
    };
  }

  async succeed(
    charge: Charge,
    actual: UsageQuantities,
    actualKnown = true,
  ): Promise<PortResult<MediaCallResult, GenerateError>> {
    const latencyMs = Math.round(performance.now() - charge.wallStart);
    // 3.26（G3-2）：上游没报用量但本地有估算数量（例 决策调用按本地分词估算输入 token）时按估算计费、标记估算，
    // 不再算「成本未知」；连估算数量都没有的才保持未知（成本待核，线路照常使用）。
    const estimated =
      !actualKnown && Object.values(actual).some((v) => typeof v === 'number' && v > 0);
    const settled = await this.billing.settle({
      holdId: charge.holdId,
      usageRecordId: charge.usageRecordId,
      actual,
      actualKnown: actualKnown || estimated,
      ...(estimated ? { actualEstimated: true } : {}),
      startedAt: charge.startedAt.toISOString(),
      upstreamId: charge.model.upstreamId,
    });
    await this.recorder.finish(charge.usageRecordId, {
      status: 'succeeded',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimated: !actualKnown,
      latencyMs,
      retryCount: 0,
      mediaUnits: unitsOf(actual),
    });
    await this.recorder.writeSettleSnapshot(charge.usageRecordId, settled);
    await this.recorder.finishAttempt(
      charge.attemptId,
      actual,
      actualKnown,
      null,
      actualKnown ? 'reported' : estimated ? 'estimated' : 'unknown',
    );
    // 未知的由 billing.call_cost_unknown 事件计入；这里只记已报 / 估算两种
    if (actualKnown || estimated)
      await this.bounds
        ?.recordUsage(charge.model.modelKey, charge.model, actualKnown ? 'reported' : 'missing')
        .catch(() => undefined);
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
    reportUpstream = true,
  ): Promise<void> {
    const release = await this.billing.release({
      holdId: charge.holdId,
      reason: category === 'content_rejected' ? 'call_rejected' : 'call_failed',
      upstreamUsage: charge.sent ? upstreamUsage : {},
      usageRecordId: charge.usageRecordId,
      startedAt: charge.startedAt.toISOString(),
      upstreamId: charge.model.upstreamId,
    });
    await this.recorder.writeReleaseSnapshot(charge.usageRecordId, release);
    await this.recorder.finishAttempt(
      charge.attemptId,
      upstreamUsage ?? null,
      release.costKnown === true,
      category,
    );
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
    if (
      charge.sent &&
      !charge.model.fake &&
      reportUpstream &&
      !['content_rejected', 'bad_request'].includes(category)
    )
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
  ): Promise<MediaAdapterResult<{ text: string; asrSeconds?: number }>> {
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
    const generation = this.activeGenerations.get(base);
    if (generation) {
      await this.cache.attach(
        generation.id,
        charge.value.usageRecordId,
        charge.value.holdId,
        model.upstreamId,
      );
      // 结算缓存恢复时必须与本次冻结一致；只写数据库会让内存里的行仍是 null，
      // 导致真实媒体调用在供应商成功后被“媒体结算缓存关联不一致”错误拒绝。
      generation.usageRecordId = charge.value.usageRecordId;
      generation.holdId = charge.value.holdId;
    }
    if (!(await this.beginCharge(charge.value))) {
      await this.fail(charge.value, 'provider_error');
      return { ok: false, error: 'model_unavailable' };
    }
    let outcome: CallOutcome<T>;
    try {
      outcome = await this.withTarget(model, call);
    } catch {
      outcome = { ok: false, category: 'provider_error' };
    }
    if (!outcome.ok) {
      const actual = outcome.zeroCost
        ? Object.fromEntries(Object.keys(estimate).map((unit) => [unit, 0]))
        : (outcome.reportedUsage ?? outcome.actual);
      await this.fail(charge.value, outcome.category, actual, !outcome.localRateLimit);
      return { ok: false, error: this.mapError(outcome.category) };
    }
    if (generation) {
      const pending: PendingMediaResult = {
        ok: true,
        value: outcome.value as Record<string, unknown>,
        mediaSettlement: {
          charge: charge.value,
          actual: outcome.actual,
          actualKnown: outcome.actualKnown !== false,
        },
      };
      await this.cache.save(generation, pending as never, 'result');
      return this.restoreMediaResult(generation, pending) as Promise<
        PortResult<T & MediaCallResult, GenerateError>
      >;
    }
    const done = await this.succeed(charge.value, outcome.actual, outcome.actualKnown !== false);
    if (!done.ok) return done;
    return { ok: true, value: { ...outcome.value, ...done.value } };
  }

  /** 加密缓存先存供应商结果；崩溃后只重放结算，不再次调用媒体供应商。 */
  async restoreMediaResult(
    row: GenerationRow,
    source: unknown,
  ): Promise<PortResult<Record<string, unknown> & MediaCallResult, GenerateError>> {
    const pending = source as PendingMediaResult;
    if (!pending.ok || !pending.mediaSettlement || !pending.value)
      throw new Error('媒体结算缓存缺失');
    const { charge, actual, actualKnown } = pending.mediaSettlement;
    charge.startedAt = new Date(charge.startedAt);
    charge.wallStart =
      performance.now() - Math.max(0, this.clock.nowMs() - charge.startedAt.getTime());
    if (row.holdId !== charge.holdId || row.usageRecordId !== charge.usageRecordId)
      throw new Error('媒体结算缓存关联不一致');
    const settled = await this.succeed(charge, actual, actualKnown);
    const complete = settled.ok
      ? { ok: true as const, value: { ...pending.value, ...settled.value } }
      : settled;
    await this.cache.save(row, complete as never, 'complete');
    return complete;
  }

  async beginCharge(charge: Charge): Promise<boolean> {
    const current = await this.bounds?.get(
      charge.model.modelKey,
      charge.model.upstreamId,
      charge.model.upstreamModelId,
    );
    if (
      !current ||
      boundsEvidence(current) !== boundsEvidence(charge.model.billingBounds) ||
      !this.billing.beginCall
    )
      return false;
    charge.sent = await this.billing.beginCall({
      holdId: charge.holdId,
      usageRecordId: charge.usageRecordId,
      upstreamId: charge.model.upstreamId,
      upstreamModelId: charge.model.upstreamModelId,
    });
    if (charge.sent) await this.recorder.markAttemptSent(charge.attemptId);
    return charge.sent;
  }

  async cancelCharge(charge: Charge): Promise<void> {
    const release = await this.billing.release({
      holdId: charge.holdId,
      reason: 'cancelled',
      usageRecordId: charge.usageRecordId,
    });
    await this.recorder.writeReleaseSnapshot(charge.usageRecordId, release);
    await this.recorder.finishAttempt(
      charge.attemptId,
      null,
      release.costKnown === true,
      'cancelled',
    );
    await this.recorder.finish(charge.usageRecordId, {
      status: 'failed',
      errorCode: 'cancelled',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimated: false,
      latencyMs: 0,
      retryCount: 0,
    });
  }

  private ttsEstimate(model: Resolved, text: string, units: number): number {
    // Qwen Plus can count a Chinese character as more than one billable unit.
    // UTF-8 length is a conservative input ceiling here, never the settled supplier quantity.
    return /^qwen-audio-[\d.]+-tts/iu.test(model.upstreamModelId)
      ? Math.max(units, Buffer.byteLength(text, 'utf8'))
      : units;
  }

  private ttsUnits(model: Resolved, text: string): number | null {
    const profile = model.billingBounds.tts;
    if (!profile || Buffer.byteLength(text, 'utf8') > profile.maxTextBytes) return null;
    return profile.counting === 'codepoints'
      ? [...text].length
      : profile.counting === 'utf16'
        ? text.length
        : Buffer.byteLength(text, 'utf8');
  }

  /** 非流式调用的 24 小时幂等（复用文本网关的结果缓存，键加 media: 前缀以免与文本冲突）。 */
  private async cached<T>(
    kind: string,
    input: MediaCallBase,
    fn: () => Promise<PortResult<T, GenerateError>>,
  ): Promise<PortResult<T, GenerateError>> {
    if (!(await this.precheck(input, kind === 'search', kind === 'public-image-decision')))
      return { ok: false, error: 'bad_request' };
    const pseudo = {
      ...input,
      idempotencyKey: `media:${kind}:${input.idempotencyKey}`,
    } as unknown as GenerateTextInput;
    const claim = await this.cache.claim(pseudo);
    if (claim.row.requestHash !== requestHash(pseudo)) return { ok: false, error: 'bad_request' };
    if (!claim.created) {
      for (let i = 0; i < 900; i++) {
        const deadlineAt = (input as MediaCallBase & { deadlineAt?: string }).deadlineAt;
        if (deadlineAt && Date.parse(deadlineAt) <= this.clock.nowMs())
          return { ok: false, error: 'provider_unavailable' };
        const row = await this.cache.get(claim.row.id);
        if (!row) break;
        if (row.phase === 'result')
          return this.restoreMediaResult(row, await this.cache.open(row)) as Promise<
            PortResult<T, GenerateError>
          >;
        if (row.phase === 'complete')
          return (await this.cache.open(row)) as unknown as PortResult<T, GenerateError>;
        if (this.clock.nowMs() - row.createdAt.getTime() > 120_000) break;
        await new Promise<void>((r) => setTimeout(r, 100));
      }
      return { ok: false, error: 'provider_unavailable' };
    }
    let result: PortResult<T, GenerateError>;
    this.activeGenerations.set(input, claim.row);
    try {
      result = await fn();
    } catch {
      // 若结果已落盘，保留result阶段供恢复，不用失败覆盖已成功的供应商结果。
      const stored = await this.cache.get(claim.row.id);
      if (stored?.phase === 'result') return { ok: false, error: 'provider_unavailable' };
      result = { ok: false, error: 'provider_unavailable' };
    } finally {
      this.activeGenerations.delete(input);
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
  private segment = 0;
  private charge: Charge | null;
  private closed = false;
  private closing: Promise<MediaCallResult> | null = null;
  private readonly queue: Array<{ text: string; final: boolean }> = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private failed = false;
  private chargedMicros = 0;
  private lastUsageId: string;
  constructor(
    private readonly gateway: ModelGatewayMedia,
    private readonly base: MediaCallBase,
    private readonly model: Resolved,
    first: Charge,
  ) {
    this.charge = first;
    this.lastUsageId = first.usageRecordId;
  }
  pushAudio(chunk: Uint8Array): void {
    if (this.closed || this.ended || !chunk.length) return;
    // 有界PCM帧；一个大chunk也必须拆帧，不能越过已核单请求时长。
    if (chunk.length % 2 || chunk.length > PCM16K_BYTES_PER_SECOND * 60) {
      void this.close();
      return;
    }
    const data = new Uint8Array(chunk);
    this.chain = this.chain
      .then(async () => {
        for (let offset = 0; offset < data.length && !this.ended; offset += 3200)
          await this.accept(data.slice(offset, offset + 3200));
      })
      .catch(() => {
        this.failed = true;
        this.emit(null);
      });
  }
  async *results(): AsyncIterable<{ text: string; final: boolean }> {
    for (;;) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.ended) {
        if (this.failed) throw new Error('ASR_SESSION_FAILED');
        return;
      }
      await new Promise<void>((resolve) => (this.wake = resolve));
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
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let sum = 0;
    const samples = chunk.length / 2;
    for (let index = 0; index < samples; index++) {
      const value = view.getInt16(index * 2, true);
      sum += value * value;
    }
    const rms = samples ? Math.sqrt(sum / samples) : 0;
    if (rms >= SPEECH_RMS) {
      this.speaking = true;
      this.silenceMs = 0;
    } else if (this.speaking) this.silenceMs += (chunk.length / PCM16K_BYTES_PER_SECOND) * 1000;
    if (this.speaking) {
      this.utterance.push(chunk);
      this.utteranceBytes += chunk.length;
    }
    const maximumSeconds = Math.min(
      MAX_UTTERANCE_SECONDS,
      this.model.billingBounds.asr!.maxSeconds,
    );
    if (
      this.speaking &&
      (this.silenceMs >= SILENCE_MS ||
        this.utteranceBytes >= maximumSeconds * PCM16K_BYTES_PER_SECOND)
    )
      await this.flush();
  }
  private async flush(): Promise<void> {
    if (!this.utteranceBytes || this.ended) return;
    const pcm = new Uint8Array(Buffer.concat(this.utterance));
    this.utterance = [];
    this.utteranceBytes = 0;
    this.speaking = false;
    this.silenceMs = 0;
    const profile = this.model.billingBounds.asr!;
    const actual = {
      asrSeconds: roundAsr(pcm.length / PCM16K_BYTES_PER_SECOND, profile.billingStepSeconds),
    };
    if (!this.charge) {
      const next = await this.gateway.reserve(this.base, this.model, actual, ++this.segment);
      if (!next.ok) {
        this.emit(null);
        return;
      }
      this.charge = next.value;
    }
    const charge = this.charge;
    this.charge = null;
    this.lastUsageId = charge.usageRecordId;
    if (!(await this.gateway.beginCharge(charge))) {
      await this.gateway.cancelCharge(charge);
      this.failed = true;
      this.emit(null);
      return;
    }
    const result = await this.gateway.transcribePcm(this.model, pcm).catch(() => null);
    if (!result?.ok) {
      await this.gateway.fail(
        charge,
        result?.category ?? 'provider_error',
        result && !result.ok && result.zeroCost ? { asrSeconds: 0 } : undefined,
      );
      this.failed = true;
      this.emit(null);
      return;
    }
    const measured = result.value.asrSeconds;
    const done = await this.gateway.succeed(
      charge,
      {
        asrSeconds:
          measured === undefined
            ? actual.asrSeconds
            : roundAsr(measured, profile.billingStepSeconds),
      },
      measured !== undefined,
    );
    if (!done.ok) {
      this.failed = true;
      this.emit(null);
      return;
    }
    this.chargedMicros += done.value.chargedMicros;
    if (!this.closed && result.value.text.trim())
      this.emit({ text: result.value.text.trim(), final: true });
  }
  private async finish(): Promise<MediaCallResult> {
    this.closed = true;
    await this.chain;
    await this.flush();
    if (this.charge) {
      await this.gateway.cancelCharge(this.charge);
      this.charge = null;
    }
    this.emit(null);
    return {
      modelKey: this.model.modelKey,
      chargedMicros: this.chargedMicros,
      latencyMs: 0,
      usageRecordId: this.lastUsageId,
    };
  }
}
