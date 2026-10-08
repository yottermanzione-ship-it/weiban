/**
 * 解析「这次调用用哪个模型」与模型可用状态。
 *
 * - ModelResolver.resolve()：给 D-L0-09 的网关用。按 modelRole、角色覆盖、平台默认解析出具体模型，
 *   执行**调用时的无审查模型闸门**（billing.md 第 9 节第 2 条：模型带 adult_content 时必须有 characterId
 *   且 policy.checkModelForCharacter 通过，否则 model_not_allowed，不调用上游），以及识图改用默认识图模型（3.2 节）。
 *   这样即使管理员事后给某个已被选为全局聊天模型的模型加上 adult_content，调用也绕不过闸门。
 * - ModelStatusService：GET /model/status 与 ModelGatewayPort.getModelStatus 的实现。
 *
 * 解析顺序：
 * - chat：角色覆盖 > 全局聊天 > 平台默认聊天；
 * - background：全局后台 > 用户的聊天模型（角色覆盖 > 全局聊天，「不设置时沿用聊天模型」）> 平台默认后台 > 平台默认聊天；
 * - adult：用户的成人模式模型（不回落到聊天模型，pm-rulings-2 B2）；
 * - 用途 vision：先按 modelRole 解析，模型没有 vision 能力时改用平台默认识图模型，没有则 capability_missing。
 * 选中的模型下架 / 上游故障时**不自动换**（MDL-04），直接返回 model_unavailable / provider_unavailable。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  AdultModelReadPort,
  BillingReadPort,
  GenerateError,
  ModelPurpose,
  ModelRole,
  ModelStatus,
  PortResult,
} from '@weiban/contracts';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { hasAdultContent, unavailableReason } from '../domain/rules.js';
import { MODEL_ACCESS_POLICY, type ModelPolicy } from '../tokens.js';
import { CatalogService, type ModelFacts } from './catalog.js';
import { SelectionService } from './selection.js';

export interface ResolvedModel {
  modelKey: string;
  upstreamId: string;
  upstreamModelId: string;
  capabilities: string[];
  /** 这次因为识图改用了平台默认识图模型。 */
  usedVisionDefault: boolean;
}

@Injectable()
export class ModelResolver implements AdultModelReadPort {
  async getAdultModelStatus(
    userId: string,
    characterId: string,
  ): ReturnType<AdultModelReadPort['getAdultModelStatus']> {
    const result = await this.resolve({
      userId,
      characterId,
      modelRole: 'adult',
      purpose: 'chat_reply',
    });
    if (result.ok) return { available: true, reason: null };
    const reason =
      result.error === 'model_unavailable'
        ? 'model_removed'
        : result.error === 'provider_unavailable'
          ? 'provider_unavailable'
          : result.error === 'model_not_allowed'
            ? 'model_not_allowed'
            : 'not_configured';
    return { available: false, reason };
  }
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(SelectionService) private readonly selection: SelectionService,
    @Inject(MODEL_ACCESS_POLICY) private readonly policy: ModelPolicy,
  ) {}

  /** 按用户选择解析出模型键（不检查可用性）；null = 没有任何可用的选择。 */
  async pick(
    userId: string,
    role: ModelRole,
    characterId: string | null,
  ): Promise<{ facts: ModelFacts; source: 'override' | 'user' | 'platform_default' } | null> {
    const raw = await this.selection.raw(userId);
    const override = characterId ? await this.selection.rawOverride(userId, characterId) : null;
    const userChat = override
      ? { key: override, source: 'override' as const }
      : raw.chat
        ? { key: raw.chat, source: 'user' as const }
        : null;
    const chosen: { key: string; source: 'override' | 'user' } | null =
      role === 'adult'
        ? raw.adult
          ? { key: raw.adult, source: 'user' }
          : null
        : role === 'background'
          ? raw.background
            ? { key: raw.background, source: 'user' }
            : userChat
          : userChat;
    if (chosen) return { facts: await this.catalog.fact(chosen.key), source: chosen.source };
    if (role === 'adult') return null;
    const fallback =
      (role === 'background' ? await this.catalog.defaultModel('background') : null) ??
      (await this.catalog.defaultModel('chat'));
    return fallback ? { facts: fallback, source: 'platform_default' } : null;
  }

  async resolve(input: {
    userId: string;
    modelRole: ModelRole;
    purpose: ModelPurpose;
    characterId?: string;
  }): Promise<PortResult<ResolvedModel, GenerateError>> {
    const picked = await this.pick(input.userId, input.modelRole, input.characterId ?? null);
    if (!picked) return { ok: false, error: 'not_configured' };
    let facts = picked.facts;
    let usedVisionDefault = false;
    const checkUsable = (f: ModelFacts): GenerateError | null => {
      const reason = unavailableReason(f.entry, f.upstreamStatus);
      if (reason === 'model_removed') return 'model_unavailable';
      if (reason === 'provider_unavailable') return 'provider_unavailable';
      return null;
    };
    const first = checkUsable(facts);
    if (first) return { ok: false, error: first };
    if (input.purpose === 'vision' && !facts.entry?.capabilities.includes('vision')) {
      const visionDefault = await this.catalog.defaultModel('vision');
      if (!visionDefault) return { ok: false, error: 'capability_missing' };
      const err = checkUsable(visionDefault);
      if (err) return { ok: false, error: err };
      facts = visionDefault;
      usedVisionDefault = true;
    }
    const entry = facts.entry;
    if (!entry) return { ok: false, error: 'model_unavailable' };
    // 调用时的无审查模型闸门（billing.md 第 9 节第 2 条）
    if (hasAdultContent(entry.capabilities)) {
      if (!input.characterId) return { ok: false, error: 'model_not_allowed' };
      const decision = await this.policy.checkModelForCharacter({
        userId: input.userId,
        characterId: input.characterId,
        modelHasAdultContent: true,
      });
      if (!decision.allowed) return { ok: false, error: 'model_not_allowed' };
    }
    return {
      ok: true,
      value: {
        modelKey: entry.modelKey,
        upstreamId: entry.upstreamId,
        upstreamModelId: entry.upstreamModelId,
        capabilities: entry.capabilities,
        usedVisionDefault,
      },
    };
  }
}

@Injectable()
export class ModelStatusService {
  constructor(
    @Inject(ModelResolver) private readonly resolver: ModelResolver,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
  ) {}

  /** GET /model/status：某角色（或全局）当前能否回复，用于私聊顶部横条。 */
  async getStatus(userId: string, characterId: string | null): Promise<ModelStatus> {
    const picked = await this.resolver.pick(userId, 'chat', characterId);
    if (!picked) {
      return {
        characterId,
        available: false,
        reason: 'not_configured',
        canFallbackToDefault: false,
      };
    }
    const reason = unavailableReason(picked.facts.entry, picked.facts.upstreamStatus);
    if (reason) {
      let canFallbackToDefault = false;
      if (picked.source === 'override') {
        // 角色单独设置的模型不可用：看全局（或平台默认）聊天模型是否正常
        const global = await this.resolver.pick(userId, 'chat', null);
        canFallbackToDefault =
          global !== null &&
          unavailableReason(global.facts.entry, global.facts.upstreamStatus) === null;
      }
      return { characterId, available: false, reason, canFallbackToDefault };
    }
    const spend = await this.billing.getSpendStatus(userId);
    if (spend.insufficient) {
      return {
        characterId,
        available: false,
        reason: 'insufficient_balance',
        canFallbackToDefault: false,
      };
    }
    return { characterId, available: true, reason: null, canFallbackToDefault: false };
  }

  /** 契约 ModelGatewayPort.getModelStatus 的实现（D-L0-09 的网关类直接转调）。 */
  async getModelStatus(
    userId: string,
    characterId: string | null,
  ): Promise<{ available: boolean; reason: ModelStatus['reason'] }> {
    const s = await this.getStatus(userId, characterId);
    return { available: s.available, reason: s.reason };
  }
}
