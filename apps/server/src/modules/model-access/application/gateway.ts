/** 全系统调用上游的唯一出口：选型/闸门→占位→冻结→调用→保存结果→结算。 */
import { Inject, Injectable } from '@nestjs/common';
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
} from '@weiban/contracts';
import { CLOCK, type Clock } from '../../../platform/index.js';
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
import { estimateTokens, type TextAdapter, type TextResult } from '../infra/text-adapter.js';
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
@Injectable()
export class ModelGateway implements ModelGatewayPort {
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
  ) {}
  getModelStatus(userId: string, characterId: string | null) {
    return this.status.getModelStatus(userId, characterId);
  }
  async generateText(input: GenerateTextInput): Promise<CachedResult> {
    if (!this.valid(input) || (await this.accounts.getAccountStatus(input.userId)) !== 'active')
      return { ok: false, error: 'bad_request' };
    if (
      input.billingOwner === 'platform' &&
      !(await this.directory.listAdminUserIds()).includes(input.userId)
    )
      return { ok: false, error: 'bad_request' };
    if (input.modelRole === 'adult') {
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
    const resolved = await this.resolver.resolve(input);
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
        inputTokens: estimateTokens(input.messages.map((m) => m.content).join('\n')),
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
    let answer: TextResult = { ok: false, category: 'network_error', retryable: true };
    let retryCount = 0;
    // AbortSignal 超时覆盖读正文；performance 只测耗时，业务日期始终由 CLOCK 提供。
    const wallStart = performance.now();
    const budgetMs = input.deadlineAt
      ? Math.max(0, Math.min(60000, Date.parse(input.deadlineAt) - this.clock.nowMs()))
      : 60000;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const remaining = Math.floor(budgetMs - (performance.now() - wallStart));
      if (remaining <= 0) break;
      answer = await this.upstreams.withApiKey(model.upstreamId, (apiKey) =>
        this.adapter.generate({
          baseUrl: upstream.baseUrl,
          apiKey,
          model: model.upstreamModelId,
          messages: input.messages,
          maxOutputTokens,
          temperature: input.temperature,
          responseFormat: input.responseFormat,
          idempotencyKey: `gateway:${row.id}`,
          timeoutMs: Math.min(20000, remaining),
        }),
      );
      if (answer.ok || !answer.retryable || attempt === 3) break;
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
      if (category !== 'content_rejected' && category !== 'bad_request')
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
  private valid(i: GenerateTextInput): boolean {
    return (
      Id.safeParse(i.userId).success &&
      ModelPurpose.safeParse(i.purpose).success &&
      BillingOwner.safeParse(i.billingOwner).success &&
      ['chat', 'background', 'adult'].includes(i.modelRole) &&
      typeof i.idempotencyKey === 'string' &&
      i.idempotencyKey.length > 0 &&
      i.idempotencyKey.length <= 200 &&
      Array.isArray(i.messages) &&
      i.messages.length > 0 &&
      i.messages.length <= 500 &&
      i.messages.every(
        (m) =>
          m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string',
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
