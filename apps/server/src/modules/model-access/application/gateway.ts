/** 全系统调用上游的唯一出口：选型/闸门→占位→冻结→调用→保存结果→结算。 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
  type ReserveInput,
  type ModelGatewayPlatformPort,
} from '@weiban/contracts';
import { APP_CONFIG, CLOCK, type AppConfig, type Clock } from '../../../platform/index.js';
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { isFakeModel } from '../infra/media-adapter.js';
import { applySystemMessageMode } from '../domain/system-messages.js';
import { simulatePrefixCache } from '../domain/prefix-cache.js';
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
import { ModelResolver, ModelStatusService, type ResolvedModel } from './resolver.js';
import { FAILOVER_CATEGORIES, UpstreamScheduler } from './scheduler.js';
import { UpstreamService } from './upstreams.js';
import { UsageRecorder } from './usage.js';
import { CatalogService } from './catalog.js';
import { BillingBoundsService, boundsEvidence, type VerifiedRoute } from './billing-bounds.js';

type TextCeiling = NonNullable<ReserveInput['ceiling']>;
type GatewayInternal = {
  fallbackModelKey?: string;
  billingPlan?: TextCeiling;
  priceVersionId?: string;
  retry?: boolean;
  trustedPlatform?: boolean;
};

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
    @Inject(UpstreamScheduler) private readonly scheduler: UpstreamScheduler,
    @Inject(TEXT_ADAPTER) private readonly adapter: TextAdapter,
    @Inject(GATEWAY_RETRY_WAIT) private readonly wait: RetryWait,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(BillingBoundsService) private readonly bounds?: BillingBoundsService,
  ) {}
  getModelStatus(userId: string, characterId: string | null) {
    return this.status.getModelStatus(userId, characterId);
  }
  async generatePlatformText(
    input: Parameters<ModelGatewayPlatformPort['generatePlatformText']>[0],
  ): Promise<CachedResult> {
    const caps = {
      safety_check: 300,
      safety_followup: 400,
      small_v: 800,
      search_candidates: 500,
    } as const;
    if (!(input.purpose in caps)) return { ok: false, error: 'bad_request' };
    const cap = caps[input.purpose];
    return this.generateText(
      {
        ...input,
        billingOwner: 'platform',
        safetyPriority: false,
        modelRole:
          input.purpose === 'safety_check' && input.modelRole === 'adult_check'
            ? 'adult_check'
            : 'background',
        modelKeyOverride: undefined,
        maxOutputTokens: Math.min(input.maxOutputTokens ?? cap, cap),
      },
      { trustedPlatform: true },
    );
  }
  /**
   * internal 只供网关自己的降级使用（不属于契约）：fallbackModelKey = 空输出后改用的备用模型。
   */
  async generateText(input: GenerateTextInput, internal?: GatewayInternal): Promise<CachedResult> {
    if (
      !this.valid(input, internal?.trustedPlatform === true) ||
      (await this.accounts.getAccountStatus(input.userId)) !== 'active'
    )
      return { ok: false, error: 'bad_request' };
    if (
      input.billingOwner === 'platform' &&
      !internal?.trustedPlatform &&
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
    if (
      (input.purpose === 'small_v' || input.purpose === 'search_candidates') &&
      !(await this.bounds?.consumePurpose(input.userId, input.purpose))
    ) {
      const result: CachedResult = { ok: false, error: 'budget_exceeded' };
      await this.cache.save(row, result, 'complete');
      return result;
    }
    if (input.deadlineAt && Date.parse(input.deadlineAt) <= this.clock.nowMs()) {
      const result: CachedResult = { ok: false, error: 'provider_unavailable' };
      await this.cache.save(row, result, 'complete');
      return result;
    }
    const imageCount = input.messages.reduce((n, m) => n + (m.images?.length ?? 0), 0);
    const resolved = await this.resolver.resolve({
      ...input,
      platformTask: internal?.trustedPlatform === true,
      hasImages: imageCount > 0,
      ...(internal?.fallbackModelKey ? { fallbackModelKey: internal.fallbackModelKey } : {}),
    });
    if (!resolved.ok) {
      await this.cache.save(row, resolved, 'complete');
      return resolved;
    }
    const model = resolved.value;
    // v3.4（ADR-0032）：上游账号池——按优先级 / 权重 / 粘性会话排出候选账号，失败自动切换。
    let candidates = await this.scheduler.plan(model.modelKey, input.conversationId ?? null);
    if (candidates.length === 0) {
      // 没有路由（理论上 0089 已迁移）：沿用目录上的主上游，状态必须正常
      const primary = await this.upstreams.get(model.upstreamId).catch(() => null);
      const now = this.clock.nowMs();
      if (
        primary &&
        primary.enabled &&
        primary.status === 'active' &&
        !(primary.cooldownUntil && primary.cooldownUntil.getTime() > now)
      )
        candidates = [
          {
            upstreamId: primary.id,
            upstreamModelId: model.upstreamModelId,
            baseUrl: primary.baseUrl,
            maxConcurrency: primary.maxConcurrency,
            rpmLimit: primary.rpmLimit,
            probing: false,
          },
        ];
    }
    const requested = input.maxOutputTokens ?? DEFAULT_TOKENS[input.purpose] ?? 8000;
    const verified = await this.bounds?.text(model.modelKey, candidates, imageCount, requested);
    if (!verified) {
      const result: CachedResult = { ok: false, error: 'model_unavailable' };
      await this.cache.save(row, result, 'complete');
      return result;
    }
    let ceiling: TextCeiling = internal?.billingPlan ?? {
      ...verified.ceiling,
      pricingModels: [model.modelKey],
    };
    if (
      internal?.billingPlan &&
      (!internal.billingPlan.pricingModels?.includes(model.modelKey) ||
        (Object.keys(verified.ceiling.usage) as (keyof typeof verified.ceiling.usage)[]).some(
          (unit) => (verified.ceiling.usage[unit] ?? 0) > (internal.billingPlan!.usage[unit] ?? 0),
        ))
    ) {
      const result: CachedResult = { ok: false, error: 'model_unavailable' };
      await this.cache.save(row, result, 'complete');
      return result;
    }
    if (
      !internal?.billingPlan &&
      FALLBACK_PURPOSES.includes(input.purpose) &&
      input.modelRole === 'background' &&
      input.meta?.scenarioMode !== 'adult'
    ) {
      const alternatives = [
        await this.catalog.defaultModel('background'),
        await this.catalog.defaultModel('chat'),
      ];
      const fallback = alternatives.find(
        (entry) =>
          entry?.entry &&
          entry.entry.modelKey !== model.modelKey &&
          !entry.entry.capabilities.includes('adult_content'),
      );
      if (fallback?.entry) {
        const routes = await this.scheduler.plan(
          fallback.entry.modelKey,
          input.conversationId ?? null,
        );
        const proof = await this.bounds!.text(
          fallback.entry.modelKey,
          routes,
          imageCount,
          requested,
        );
        if (proof)
          ceiling = {
            usage: {
              inputTokens: Math.max(
                ceiling.usage.inputTokens ?? 0,
                proof.ceiling.usage.inputTokens ?? 0,
              ),
              outputTokens: Math.max(
                ceiling.usage.outputTokens ?? 0,
                proof.ceiling.usage.outputTokens ?? 0,
              ),
            },
            pricingModels: [model.modelKey, fallback.entry.modelKey].sort(),
            evidence: boundsEvidence([ceiling.evidence, proof.ceiling.evidence]),
          };
      }
    }
    if (!(await this.scheduler.acquireUser(input.userId))) {
      // 没有可用账号，或超过每用户并发 / 每分钟上限：按「模型暂时不可用」返回，不冻结、不扣费
      const result: CachedResult = { ok: false, error: 'provider_unavailable' };
      await this.cache.save(row, result, 'complete');
      return result;
    }
    try {
      return await this.callUpstreams(input, internal, row, model, verified.routes, ceiling);
    } finally {
      this.scheduler.releaseUser(input.userId);
    }
  }

  /** 冻结 → 按候选账号调用（失败切换）→ 记账。v3.4 从 generateText 拆出。 */
  private async callUpstreams(
    input: GenerateTextInput,
    internal: GatewayInternal | undefined,
    row: GenerationRow,
    model: ResolvedModel,
    candidates: VerifiedRoute[],
    ceiling: TextCeiling,
  ): Promise<CachedResult> {
    const maximum = input.maxOutputTokens ?? DEFAULT_TOKENS[input.purpose] ?? 8000;
    const wire = applySystemMessageMode(await this.wireMessages(input), model.systemMessageMode);
    const wallStart = performance.now();
    const deadlineAt = new Date(
      Math.min(
        row.createdAt.getTime() + 60000,
        input.deadlineAt ? Date.parse(input.deadlineAt) : Infinity,
      ),
    ).toISOString();
    const budgetMs = Math.max(0, Date.parse(deadlineAt) - this.clock.nowMs());
    let outputBudget = maximum,
      emptyRetried = false,
      index = 0;
    let priceVersionId = internal?.priceVersionId;
    let answer: TextResult = { ok: false, category: 'network_error', retryable: false };
    const maximumAttempts = 3 + candidates.length;
    const completeFailure = async (
      error:
        | 'model_unavailable'
        | 'provider_unavailable'
        | 'insufficient_balance'
        | 'budget_exceeded'
        | 'content_rejected'
        | 'bad_request',
    ): Promise<CachedResult> => {
      const result: CachedResult = { ok: false, error };
      await this.cache.save(row, result, 'complete');
      return result;
    };
    for (let ordinal = 0; ordinal < maximumAttempts; ordinal++) {
      const remaining = Math.floor(budgetMs - (performance.now() - wallStart));
      if (remaining <= 0) break;
      let candidate = candidates[index];
      while (candidate && !this.scheduler.acquireAccount(candidate))
        candidate = candidates[++index];
      if (!candidate) break;
      const route = candidate;
      const key = 'gateway:' + row.id + ':attempt:' + ordinal;
      const startedAt = this.clock.now();
      const usage = await this.recorder.start({
        input: { ...input, idempotencyKey: key },
        ...model,
        upstreamId: route.upstreamId,
        upstreamModelId: route.upstreamModelId,
        countsAsBackground:
          !BUDGET_EXEMPT_PURPOSES.includes(input.purpose) &&
          (BACKGROUND_PURPOSES.includes(input.purpose) || input.countAsBackground === true),
      });
      try {
        if (!usage.created) return completeFailure('provider_unavailable');
        const reserve = await this.billing.estimateAndReserve({
          account:
            input.billingOwner === 'user'
              ? { kind: 'user', userId: input.userId }
              : { kind: 'platform' },
          purpose: input.purpose,
          modelKey: model.modelKey,
          characterId: input.characterId,
          estimate: ceiling.usage,
          ceiling,
          idempotencyKey: key,
          countAsBackground: input.countAsBackground,
          ecologyTask: input.ecologyTask,
          reservePlatformRisk: ordinal > 0 || internal?.retry === true,
          priceVersionId,
        });
        if (!reserve.ok) {
          await this.recorder.writeReleaseSnapshot(usage.record.id, {
            absorbedCostMicros: 0,
            costKnown: true,
          });
          await this.recorder.finish(usage.record.id, {
            status: 'failed',
            errorCode: reserve.error,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            estimated: false,
            latencyMs: 0,
            retryCount: ordinal,
          });
          return completeFailure(
            reserve.error === 'price_missing' ? 'model_unavailable' : reserve.error,
          );
        }
        const hold = reserve.value;
        priceVersionId ??= hold.priceVersionId;
        await this.cache.attach(row.id, usage.record.id, hold.holdId, route.upstreamId);
        await this.recorder.attachHold(usage.record.id, hold);
        const attemptId = await this.recorder.startAttempt({
          generationId: row.id,
          userId: input.userId,
          ordinal,
          modelKey: model.modelKey,
          upstreamId: route.upstreamId,
          upstreamModelId: route.upstreamModelId,
          usageRecordId: usage.record.id,
          holdId: hold.holdId,
          boundSnapshot: { ceiling, route: route.billingBounds, priceVersionId },
        });
        const currentProof = await this.bounds!.get(
          model.modelKey,
          route.upstreamId,
          route.upstreamModelId,
        );
        const sent =
          !!currentProof &&
          boundsEvidence(currentProof) === boundsEvidence(route.billingBounds) &&
          !!this.billing.beginCall &&
          (await this.billing.beginCall({
            holdId: hold.holdId,
            usageRecordId: usage.record.id,
            upstreamId: route.upstreamId,
            upstreamModelId: route.upstreamModelId,
          }));
        if (sent) {
          await this.recorder.markAttemptSent(attemptId);
          try {
            answer = isFakeModel(route.upstreamModelId, this.config.nodeEnv === 'production')
              ? fakeAnswer(input, wire)
              : await this.upstreams.withApiKey(route.upstreamId, (apiKey) =>
                  this.adapter.generate({
                    baseUrl: route.baseUrl,
                    apiKey,
                    model: route.upstreamModelId,
                    messages: wire,
                    maxOutputTokens: Math.min(
                      outputBudget,
                      route.billingBounds.text!.maxOutputTokens,
                    ),
                    outputParameter: route.billingBounds.text!.outputParameter,
                    temperature: input.temperature ?? DEFAULT_TEMPERATURE[input.purpose],
                    responseFormat: input.responseFormat,
                    idempotencyKey: key,
                    timeoutMs: Math.min(20000, remaining),
                    thinking: 'off',
                  }),
                );
          } catch {
            answer = { ok: false, category: 'network_error', retryable: true };
          }
        } else answer = { ok: false, category: 'provider_error', retryable: false };
        const known = !!answer.usage && !answer.usage.estimated;
        await this.recorder.finishAttempt(
          attemptId,
          answer.usage ?? null,
          known,
          answer.ok ? null : answer.category,
        );
        const latencyMs = Math.round(performance.now() - wallStart);
        if (answer.ok) {
          const result: CachedResult = {
            ok: true,
            value: {
              text: answer.text,
              modelKey: model.modelKey,
              ...(model.usedVisionDefault ? { usedVisionDefault: true } : {}),
              usage: answer.usage,
              chargedMicros: 0,
              latencyMs,
              usageRecordId: usage.record.id,
            },
          };
          // 先保存结果；结算重放不能再次发送供应商。
          await this.cache.save(row, result, 'result');
          await this.recorder.finish(usage.record.id, {
            status: 'succeeded',
            ...answer.usage,
            latencyMs,
            retryCount: ordinal,
          });
          await this.scheduler.recordSuccess(route.upstreamId).catch(() => undefined);
          const completed = await this.finalize((await this.cache.get(row.id))!, result);
          if (!known)
            await this.bounds!.pauseUnknown(model.modelKey, route, {
              checkedAt: startedAt.toISOString(),
            });
          return completed;
        }
        const released = await this.billing.release({
          holdId: hold.holdId,
          reason: sent
            ? answer.category === 'content_rejected'
              ? 'call_rejected'
              : 'call_failed'
            : 'cancelled',
          upstreamUsage: !sent ? {} : known ? answer.usage : undefined,
          usageRecordId: usage.record.id,
          startedAt: startedAt.toISOString(),
          upstreamId: route.upstreamId,
        });
        await this.recorder.writeReleaseSnapshot(usage.record.id, released);
        await this.recorder.finish(usage.record.id, {
          status: 'failed',
          errorCode: sent ? answer.category : 'route_risk_blocked',
          ...(answer.usage ?? {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            estimated: false,
          }),
          latencyMs,
          retryCount: ordinal,
        });
        if (sent && !known)
          await this.bounds!.pauseUnknown(model.modelKey, route, {
            checkedAt: startedAt.toISOString(),
          });
        if (!sent) {
          index++;
          continue;
        }
        if (answer.category === 'content_rejected' || answer.category === 'bad_request')
          return completeFailure(answer.category);
        const empty = answer.category === 'empty_output' || answer.category === 'truncated';
        if (!known || FAILOVER_CATEGORIES.includes(answer.category)) {
          await this.scheduler
            .recordFailure(route.upstreamId, answer.category)
            .catch(() => undefined);
          index++;
          if (index < candidates.length) continue;
          break;
        }
        if (empty && !emptyRetried) {
          emptyRetried = true;
          const platformCap =
            input.purpose === 'safety_check'
              ? 300
              : input.purpose === 'safety_followup'
                ? 400
                : input.purpose === 'small_v'
                  ? 800
                  : 500;
          outputBudget = Math.min(
            32000,
            Math.ceil(maximum * 1.5),
            internal?.trustedPlatform ? platformCap : Infinity,
          );
          continue;
        }
        if (empty || !answer.retryable) break;
        const delay = [2000, 5000, 15000][Math.min(ordinal, 2)]!;
        if (performance.now() - wallStart + delay >= budgetMs) break;
        await this.wait(delay);
      } finally {
        this.scheduler.releaseAccount(route.upstreamId);
      }
    }
    if (!answer.ok && (answer.category === 'empty_output' || answer.category === 'truncated')) {
      const fallback = await this.emptyOutputFallback({ ...input, deadlineAt }, model.modelKey, {
        ...internal,
        billingPlan: ceiling,
        priceVersionId,
        retry: true,
      });
      if (fallback) {
        await this.cache.save(row, fallback, 'complete');
        return fallback;
      }
    }
    return completeFailure('provider_unavailable');
  }
  async finalize(row: GenerationRow, result: CachedResult): Promise<CachedResult> {
    if (!result.ok || !row.holdId || !row.upstreamId) throw new Error('网关待结算结果缺失');
    const record = await this.recorder.byId(result.value.usageRecordId);
    const settled = await this.billing.settle({
      holdId: row.holdId,
      usageRecordId: result.value.usageRecordId,
      actualKnown: !result.value.usage.estimated,
      actual: {
        inputTokens: result.value.usage.inputTokens,
        cachedInputTokens: result.value.usage.cachedInputTokens,
        outputTokens: result.value.usage.outputTokens,
      },
      startedAt: (record?.createdAt ?? row.createdAt).toISOString(),
      upstreamId: row.upstreamId,
    });
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
    internal?: GatewayInternal,
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
      { ...input, idempotencyKey: `fallback:${boundsEvidence(input.idempotencyKey)}` },
      { ...internal, fallbackModelKey: target.entry.modelKey },
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
  private valid(i: GenerateTextInput, trustedPlatform = false): boolean {
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
      (i.billingOwner !== 'platform' ||
        i.purpose.startsWith('admin_') ||
        (trustedPlatform &&
          ['safety_check', 'safety_followup', 'small_v', 'search_candidates'].includes(
            i.purpose,
          ))) &&
      (!['safety_check', 'safety_followup', 'small_v', 'search_candidates'].includes(i.purpose) ||
        trustedPlatform)
    );
  }
}

/** 开发 / 测试假上游（upstreamModelId 以 fake- 开头，生产不启用）：确定性回答，用量按估算记（含前缀缓存模拟）。 */
function fakeAnswer(input: GenerateTextInput, wire: AdapterMessage[]): TextResult {
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
  const cache = simulatePrefixCache(
    `${input.userId}:${input.characterId ?? ''}:${input.purpose}`,
    wire,
  );
  return {
    ok: true,
    text,
    usage: {
      inputTokens: cache.total - cache.cached,
      cachedInputTokens: cache.cached,
      outputTokens: estimateTokens(text),
      estimated: true,
    },
  };
}
