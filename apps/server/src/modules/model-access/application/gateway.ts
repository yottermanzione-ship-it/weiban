/** 全系统调用上游的唯一出口：选型/闸门→占位→冻结→调用→保存结果→结算。 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BACKGROUND_PURPOSES,
  BUDGET_EXEMPT_PURPOSES,
  SAFETY_OVERDRAFT_PURPOSES,
  ModelPurpose,
  BillingOwner,
  Id,
  Timestamp,
  type GenerateTextInput,
  type ModelGatewayPort,
  type BillingReservationPort,
  type IdentityDirectoryPort,
  type IdentityAccountStatusPort,
  type MediaSystemPort,
} from '@weiban/contracts';
import { APP_CONFIG, CLOCK, type AppConfig, type Clock } from '../../../platform/index.js';
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { isFakeModel } from '../infra/media-adapter.js';
import { BILLING_RESERVATION_PORT } from '../../billing/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT, IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
import {
  GATEWAY_RETRY_WAIT,
  MODEL_GENERATION_POLICY,
  MODEL_ACCESS_POLICY,
  TEXT_ADAPTER,
  type RetryWait,
  type GenerationPolicy,
  type ModelPolicy,
} from '../tokens.js';
import {
  estimateTokens,
  type AdapterMessage,
  type TextAdapter,
  type TextResult,
} from '../infra/text-adapter.js';
import {
  GenerationCache,
  requestHash,
  type GenerationRow,
  type CachedResult,
} from './generation-cache.js';
import { ModelResolver, ModelStatusService } from './resolver.js';
import { UpstreamService } from './upstreams.js';
import { UsageRecorder } from './usage.js';
import { CatalogService } from './catalog.js';

const DEFAULT_TOKENS: Partial<Record<GenerateTextInput['purpose'], number>> = {
  chat_reply: 600,
  proactive: 400,
  simulation: 2000,
  moments: 1000,
  memory: 1000,
  safety_check: 300,
  safety_followup: 400,
  behavior_planning: 150,
  vision: 600,
  import_analysis: 6000,
};
/**
 * 调用方没传温度时的默认值（docs/refactor/03 第 2.2 B 节，沿用旧版）：
 * 聊天类 0.9、创作类后台 0.8、整理类后台 0.2、判断类 0。
 */
const DEFAULT_TEMPERATURE: Partial<Record<GenerateTextInput['purpose'], number>> = {
  chat_reply: 0.9,
  proactive: 0.9,
  safety_followup: 0.9,
  simulation: 0.8,
  moments: 0.8,
  memory: 0.2,
  import_analysis: 0.2,
  behavior_planning: 0,
  safety_check: 0,
  vision: 0,
};
/** 空输出时允许换备用模型的用途：后台整理 / 创作类。聊天、规划（有规则兜底）、安全检查不换。 */
const FALLBACK_PURPOSES: readonly GenerateTextInput['purpose'][] = [
  'memory',
  'simulation',
  'moments',
];
@Injectable()
export class ModelGateway implements ModelGatewayPort {
  private readonly logger = new Logger('ModelGateway');
  constructor(
    @Inject(ModelResolver) private readonly resolver: ModelResolver,
    @Inject(ModelStatusService) private readonly status: ModelStatusService,
    @Inject(UpstreamService) private readonly upstreams: UpstreamService,
    @Inject(UsageRecorder) private readonly recorder: UsageRecorder,
    @Inject(GenerationCache) private readonly cache: GenerationCache,
    @Inject(BILLING_RESERVATION_PORT) private readonly billing: BillingReservationPort,
    @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory: IdentityDirectoryPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(MODEL_GENERATION_POLICY) private readonly policy: GenerationPolicy,
    @Inject(MODEL_ACCESS_POLICY) private readonly modelPolicy: ModelPolicy,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(TEXT_ADAPTER) private readonly adapter: TextAdapter,
    @Inject(GATEWAY_RETRY_WAIT) private readonly wait: RetryWait,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  getModelStatus(userId: string, characterId: string | null) {
    return this.status.getModelStatus(userId, characterId);
  }
  /**
   * internal 只供网关自己的降级使用（不属于契约）：fallbackModelKey = 空输出后改用的备用模型。
   */
  async generateText(
    input: GenerateTextInput,
    internal?: { fallbackModelKey?: string },
  ): Promise<CachedResult> {
    if (!this.valid(input) || (await this.accounts.getAccountStatus(input.userId)) !== 'active')
      return { ok: false, error: 'bad_request' };
    if (
      input.billingOwner === 'platform' &&
      !(await this.directory.listAdminUserIds()).includes(input.userId)
    )
      return { ok: false, error: 'bad_request' };
    if (
      input.modelRole === 'adult' ||
      (input.purpose === 'memory' && input.meta?.scenarioMode === 'adult')
    ) {
      if (!input.characterId || !input.conversationId) return { ok: false, error: 'policy_denied' };
      const decision = await this.policy.checkAdultGeneration({
        userId: input.userId,
        characterId: input.characterId,
        conversationId: input.conversationId,
      });
      if (!decision.allowed) return { ok: false, error: 'policy_denied' };
    }
    const claim = await this.cache.claim(input);
    if (claim.row.requestHash !== requestHash(input)) return { ok: false, error: 'bad_request' };
    if (!claim.created) {
      const result = await this.replay(claim.row);
      if (result.ok) {
        // 财务结算可以重放，但不能因缓存而绕过后来收紧的角色或模型分类。
        const facts = await this.catalog.fact(result.value.modelKey);
        if (!facts.entry) return { ok: false, error: 'model_unavailable' };
        if (facts.entry.capabilities.includes('adult_content')) {
          if (!input.characterId) return { ok: false, error: 'model_not_allowed' };
          const decision = await this.modelPolicy.checkModelForCharacter({
            userId: input.userId,
            characterId: input.characterId,
            modelHasAdultContent: true,
          });
          if (!decision.allowed) return { ok: false, error: 'model_not_allowed' };
        }
      }
      return result;
    }
    const row = claim.row;
    if (input.deadlineAt && Date.parse(input.deadlineAt) <= this.clock.nowMs()) {
      const result: CachedResult = { ok: false, error: 'provider_unavailable' };
      await this.cache.save(row, result, 'complete');
      return result;
    }
    const imageCount = input.messages.reduce((n, m) => n + (m.images?.length ?? 0), 0);
    const resolved = await this.resolver.resolve({
      ...input,
      hasImages: imageCount > 0,
      ...(internal?.fallbackModelKey ? { fallbackModelKey: internal.fallbackModelKey } : {}),
    });
    if (!resolved.ok) {
      await this.cache.save(row, resolved, 'complete');
      return resolved;
    }
    const model = resolved.value;
    const maxOutputTokens = input.maxOutputTokens ?? DEFAULT_TOKENS[input.purpose] ?? 8000;
    const startedAt = this.clock.now();
    const usage = await this.recorder.start({
      input: { ...input, idempotencyKey: `gateway:${row.id}` },
      ...model,
      countsAsBackground:
        !BUDGET_EXEMPT_PURPOSES.includes(input.purpose) &&
        (BACKGROUND_PURPOSES.includes(input.purpose) || input.countAsBackground === true),
    });
    const reserve = await this.billing.estimateAndReserve({
      account:
        input.billingOwner === 'user'
          ? { kind: 'user', userId: input.userId }
          : { kind: 'platform' },
      purpose: input.purpose,
      modelKey: model.modelKey,
      characterId: input.characterId,
      estimate: {
        // T-071：每张图按约 1000 token 估算（实际以上游返回的用量结算）。
        inputTokens:
          estimateTokens(input.messages.map((m) => m.content).join('\n')) + imageCount * 1000,
        outputTokens: maxOutputTokens,
      },
      idempotencyKey: `gateway:${row.id}`,
      safetyOverdraft: input.safetyPriority,
      countAsBackground: input.countAsBackground,
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
      const result: CachedResult = { ok: false, error };
      await this.cache.save(row, result, 'complete');
      return result;
    }
    const hold = reserve.value;
    await this.cache.attach(row.id, usage.record.id, hold.holdId, model.upstreamId);
    await this.recorder.attachHold(usage.record.id, hold);
    const upstream = await this.upstreams.get(model.upstreamId);
    const wire = await this.wireMessages(input);
    const fake = isFakeModel(model.upstreamModelId, this.config.nodeEnv === 'production');
    let answer: TextResult = { ok: false, category: 'network_error', retryable: true };
    let retryCount = 0;
    // AbortSignal 超时覆盖读正文；performance 只测耗时，业务日期始终由 CLOCK 提供。
    const wallStart = performance.now();
    const budgetMs = input.deadlineAt
      ? Math.max(0, Math.min(60000, Date.parse(input.deadlineAt) - this.clock.nowMs()))
      : 60000;
    // 空输出 / 截断（docs/refactor/03 第 1.4 B「三步降级」第 2 步）：同模型只重试 1 次，输出额度 ×1.5（思考始终关）。
    let outputBudget = maxOutputTokens;
    let emptyRetried = false;
    const temperature = input.temperature ?? DEFAULT_TEMPERATURE[input.purpose];
    for (let attempt = 0; attempt <= 3; attempt++) {
      const remaining = Math.floor(budgetMs - (performance.now() - wallStart));
      if (remaining <= 0) break;
      answer = fake
        ? fakeAnswer(input)
        : await this.upstreams.withApiKey(model.upstreamId, (apiKey) =>
            this.adapter.generate({
              baseUrl: upstream.baseUrl,
              apiKey,
              model: model.upstreamModelId,
              messages: wire,
              maxOutputTokens: outputBudget,
              temperature,
              responseFormat: input.responseFormat,
              idempotencyKey: emptyRetried ? `gateway:${row.id}:e` : `gateway:${row.id}`,
              timeoutMs: Math.min(20000, remaining),
              thinking: 'off',
            }),
          );
      if (answer.ok || !answer.retryable || attempt === 3) break;
      if (answer.category === 'empty_output' || answer.category === 'truncated') {
        if (emptyRetried) break;
        emptyRetried = true;
        outputBudget = Math.min(32000, Math.ceil(maxOutputTokens * 1.5));
        retryCount++;
        continue;
      }
      const delay = [2000, 5000, 15000][attempt]! * (0.85 + Math.random() * 0.3);
      if (performance.now() - wallStart + delay >= budgetMs) break;
      await this.wait(Math.round(delay));
      retryCount++;
    }
    const latencyMs = Math.round(performance.now() - wallStart);
    if (!answer.ok) {
      const category = answer.category;
      const release = await this.billing.release({
        holdId: hold.holdId,
        reason: category === 'content_rejected' ? 'call_rejected' : 'call_failed',
        upstreamUsage: answer.usage
          ? {
              inputTokens: answer.usage.inputTokens,
              cachedInputTokens: answer.usage.cachedInputTokens,
              outputTokens: answer.usage.outputTokens,
            }
          : undefined,
        usageRecordId: usage.record.id,
        startedAt: startedAt.toISOString(),
        upstreamId: model.upstreamId,
      });
      await this.recorder.writeReleaseSnapshot(usage.record.id, release);
      await this.recorder.finish(usage.record.id, {
        status: 'failed',
        errorCode: category,
        ...(answer.usage ?? {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          estimated: false,
        }),
        latencyMs,
        retryCount,
      });
      const emptyLike = category === 'empty_output' || category === 'truncated';
      if (emptyLike) {
        // 第 3 步：模型本身的问题（不是上游故障），不改上游状态；告警后台任务换备用模型再试一次。
        this.logger.warn(
          `model_empty_output purpose=${input.purpose} model=${model.modelKey} category=${category}`,
        );
        const fallback = await this.emptyOutputFallback(input, model.modelKey, internal);
        if (fallback) {
          await this.cache.save(row, fallback, 'complete');
          return fallback;
        }
      }
      if (category !== 'content_rejected' && category !== 'bad_request' && !emptyLike)
        await this.upstreams.reportStatus(
          model.upstreamId,
          category === 'invalid_key'
            ? 'invalid'
            : category === 'quota_exhausted'
              ? 'quota_exhausted'
              : 'unavailable',
          'gateway',
          category === 'rate_limited' ? 'provider_error' : category,
        );
      const result: CachedResult = {
        ok: false,
        error:
          category === 'content_rejected'
            ? 'content_rejected'
            : category === 'bad_request'
              ? 'bad_request'
              : 'provider_unavailable',
      };
      await this.cache.save(row, result, 'complete');
      return result;
    }
    const result: CachedResult = {
      ok: true,
      value: {
        text: answer.text,
        modelKey: model.modelKey,
        usage: answer.usage,
        chargedMicros: 0,
        latencyMs,
        usageRecordId: usage.record.id,
      },
    };
    // 保存网络结果后再扣款；崩溃恢复走 finalize，不再调用供应商。
    await this.cache.save(row, result, 'result');
    await this.recorder.finish(usage.record.id, {
      status: 'succeeded',
      ...answer.usage,
      latencyMs,
      retryCount,
    });
    return this.finalize((await this.cache.get(row.id))!, result);
  }
  async finalize(row: GenerationRow, result: CachedResult): Promise<CachedResult> {
    if (!result.ok || !row.holdId || !row.upstreamId) throw new Error('网关待结算结果缺失');
    const settled = await this.billing.settle({
      holdId: row.holdId,
      usageRecordId: result.value.usageRecordId,
      actual: {
        inputTokens: result.value.usage.inputTokens,
        cachedInputTokens: result.value.usage.cachedInputTokens,
        outputTokens: result.value.usage.outputTokens,
      },
      startedAt: row.createdAt.toISOString(),
      upstreamId: row.upstreamId,
    });
    const record = await this.recorder.byIdempotencyKey(`gateway:${row.id}`);
    if (record?.status === 'pending') {
      await this.recorder.finish(result.value.usageRecordId, {
        status: 'succeeded',
        ...result.value.usage,
        latencyMs: result.value.latencyMs,
        retryCount: record.retryCount,
      });
    }
    await this.recorder.writeSettleSnapshot(result.value.usageRecordId, settled);
    const complete: CachedResult = {
      ok: true,
      value: { ...result.value, chargedMicros: settled.amountMicros },
    };
    await this.cache.save(row, complete, 'complete');
    return complete;
  }
  /**
   * 三步降级第 3 步（docs/refactor/03 第 1.4 B）：只对后台整理类用途、且不是成人范围时，
   * 改用平台默认后台模型（与当前不同时；否则平台默认聊天模型）再调用一次；聊天类用途永不换模型（MDL-04）。
   * 备用调用是独立的一次网关调用（独立幂等键、冻结、用量记录），失败就返回 null 由调用方按原失败处理。
   */
  private async emptyOutputFallback(
    input: GenerateTextInput,
    currentModelKey: string,
    internal?: { fallbackModelKey?: string },
  ): Promise<CachedResult | null> {
    if (internal?.fallbackModelKey) return null;
    if (!FALLBACK_PURPOSES.includes(input.purpose) || input.modelRole !== 'background') return null;
    if (input.meta?.scenarioMode === 'adult') return null;
    const candidates = [
      await this.catalog.defaultModel('background'),
      await this.catalog.defaultModel('chat'),
    ];
    const target = candidates.find(
      (f) =>
        f?.entry &&
        f.entry.modelKey !== currentModelKey &&
        !f.entry.capabilities.includes('adult_content'),
    );
    if (!target?.entry) return null;
    const result = await this.generateText(
      { ...input, idempotencyKey: `${input.idempotencyKey}:fb`.slice(0, 200) },
      { fallbackModelKey: target.entry.modelKey },
    );
    return result.ok ? result : null;
  }
  private async replay(first: GenerationRow): Promise<CachedResult> {
    let row = first;
    for (let i = 0; i < 600; i++) {
      if (row.phase === 'complete') return this.cache.open(row);
      if (row.phase === 'result') return this.finalize(row, await this.cache.open(row));
      // 不确定的在途调用不重发，避免进程崩溃后重复向供应商付费。
      if (this.clock.nowMs() - row.createdAt.getTime() > 90000)
        return { ok: false, error: 'provider_unavailable' };
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      const next = await this.cache.get(row.id);
      if (!next) return { ok: false, error: 'bad_request' };
      row = next;
    }
    return { ok: false, error: 'provider_unavailable' };
  }
  /** T-071：把 images 读成 data URL（只在服务器内部，不落日志）。读取失败的图片跳过。 */
  private async wireMessages(input: GenerateTextInput): Promise<AdapterMessage[]> {
    const out: AdapterMessage[] = [];
    for (const m of input.messages) {
      if (!m.images?.length) {
        out.push({ role: m.role, content: m.content });
        continue;
      }
      const urls: string[] = [];
      for (const ref of m.images) {
        try {
          const file = await this.media.readBytes(ref.mediaId);
          if (!file.mimeType.startsWith('image/') || file.bytes.length > 8_000_000) continue;
          urls.push(`data:${file.mimeType};base64,${Buffer.from(file.bytes).toString('base64')}`);
        } catch {
          // 媒体已删除：当作没有这张图。
        }
      }
      out.push({ role: m.role, content: m.content, ...(urls.length ? { images: urls } : {}) });
    }
    return out;
  }
  private valid(i: GenerateTextInput): boolean {
    return (
      Id.safeParse(i.userId).success &&
      ModelPurpose.safeParse(i.purpose).success &&
      BillingOwner.safeParse(i.billingOwner).success &&
      ['chat', 'background', 'adult', 'adult_check'].includes(i.modelRole) &&
      (i.modelRole !== 'adult_check' ||
        (i.purpose === 'safety_check' && !!i.characterId && !i.safetyPriority)) &&
      (i.modelKeyOverride === undefined ||
        (i.purpose === 'behavior_planning' &&
          typeof i.modelKeyOverride === 'string' &&
          i.modelKeyOverride.length > 0 &&
          i.modelKeyOverride.length <= 120)) &&
      typeof i.idempotencyKey === 'string' &&
      i.idempotencyKey.length > 0 &&
      i.idempotencyKey.length <= 200 &&
      Array.isArray(i.messages) &&
      i.messages.length > 0 &&
      i.messages.length <= 500 &&
      i.messages.every(
        (m) =>
          m &&
          ['system', 'user', 'assistant'].includes(m.role) &&
          typeof m.content === 'string' &&
          (m.images === undefined ||
            (m.role === 'user' &&
              Array.isArray(m.images) &&
              m.images.length <= 4 &&
              m.images.every((img) => Id.safeParse(img?.mediaId).success))),
      ) &&
      i.messages.reduce((n, m) => n + m.content.length, 0) <= 200000 &&
      (i.deadlineAt === undefined || Timestamp.safeParse(i.deadlineAt).success) &&
      (i.maxOutputTokens === undefined ||
        (Number.isInteger(i.maxOutputTokens) &&
          i.maxOutputTokens > 0 &&
          i.maxOutputTokens <= 32000)) &&
      (i.temperature === undefined ||
        (Number.isFinite(i.temperature) && i.temperature >= 0 && i.temperature <= 2)) &&
      (i.responseFormat === undefined || ['text', 'json'].includes(i.responseFormat)) &&
      (!i.safetyPriority ||
        (i.billingOwner === 'user' && SAFETY_OVERDRAFT_PURPOSES.includes(i.purpose))) &&
      (i.billingOwner !== 'platform' || i.purpose.startsWith('admin_'))
    );
  }
}

/** 开发 / 测试假上游（upstreamModelId 以 fake- 开头，生产不启用）：确定性回答，用量按估算记。 */
function fakeAnswer(input: GenerateTextInput): TextResult {
  const text =
    input.purpose === 'vision'
      ? JSON.stringify({
          description: '一张图片（假识图，未真正识别内容）',
          people: [],
          kind: 'photo',
          textInImage: '',
        })
      : input.responseFormat === 'json'
        ? '{}'
        : '嗯嗯，我在呢（假回复）';
  return {
    ok: true,
    text,
    usage: {
      inputTokens: estimateTokens(input.messages.map((m) => m.content).join('\n')),
      cachedInputTokens: 0,
      outputTokens: estimateTokens(text),
      estimated: true,
    },
  };
}
