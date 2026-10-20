/**
 * 解析「这次调用用哪个模型」与模型可用状态。
 *
 * - ModelResolver.resolve()：给 D-L0-09 的网关用。按 modelRole、角色覆盖、平台默认解析出具体模型，
 *   执行**调用时的无审查模型闸门**（billing.md 第 9 节第 2 条：模型带 adult_content 时必须有 characterId
 *   且 policy.checkModelForCharacter 通过，否则 model_not_allowed，不调用上游），以及识图改用默认识图模型（3.2 节）。
 *   这样即使管理员事后给某个已被选为全局聊天模型的模型加上 adult_content，调用也绕不过闸门。
 * - ModelStatusService：GET /model/status 与 ModelGatewayPort.getModelStatus 的实现。
 *
 * 解析顺序（3.22 起按场景，见 scenarios.ts；没有平台兜底默认）：
 * - chat：场景「文本聊天」（input.scenario 指定时用它，例 通话 = voice_call）；
 * - background：同一角色的「文本聊天」（后台文字任务跟随文本聊天，不再有单独的后台模型）；
 * - adult：场景「私密模式」；
 * - 每个场景：角色单独设置 > 用户场景配置 > not_configured。管理员自己的 admin_* 调用没配置时用场景推荐模型；
 * - 平台任务（安全、小V、平台内容）、行为规划、成人检查：后台指定的「平台内部模型」；
 * - 3.24：不再有「图片识别」场景。带图（或 purpose = vision）就交给本次解析出的模型（文本聊天 / 私密模式），
 *   它没有 vision 能力时 capability_missing（后台要求这两类模型具备识图能力，缺了会提示）。
 * 选中的模型下架 / 上游故障时**不自动换**（MDL-04），直接返回 model_unavailable / provider_unavailable。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  AdultModelReadPort,
  BillingQuotePort,
  BillingReadPort,
  GenerateError,
  ModelPurpose,
  ModelQuotePort,
  ModelRole,
  ModelScenario,
  ModelStatus,
  PlatformInternalUse,
  PortResult,
  SystemMessageMode,
  UsageQuantities,
} from '@weiban/contracts';
import { asSystemMessageMode } from '../domain/system-messages.js';
import { BILLING_QUOTE_PORT, BILLING_READ_PORT } from '../../billing/index.js';
import { hasAdultContent, unavailableReason } from '../domain/rules.js';
import { MODEL_ACCESS_POLICY, type ModelPolicy } from '../tokens.js';
import { CatalogService, type ModelFacts } from './catalog.js';
import { ScenarioService } from './scenarios.js';
import { BillingBoundsService } from './billing-bounds.js';

/** 3.22：一次调用按哪个场景解析。 */
export function scenarioFor(
  role: ModelRole,
  purpose: ModelPurpose,
  scenario?: ModelScenario,
): ModelScenario {
  if (role === 'adult') return 'private';
  // 3.24：图片识别场景已去掉（旧调用方传 vision 也按文本聊天解析）
  if (role === 'chat' && scenario && scenario !== 'vision') return scenario;
  void purpose;
  return 'chat';
}

/** 3.22：平台任务用途 → 平台内部模型。 */
const PLATFORM_TASK_USE: Partial<Record<ModelPurpose, PlatformInternalUse>> = {
  safety_check: 'safety',
  safety_followup: 'safety',
  small_v: 'small_v',
  search_candidates: 'platform_content',
  moments: 'platform_content',
};

export interface ResolvedModel {
  modelKey: string;
  upstreamId: string;
  upstreamModelId: string;
  capabilities: string[];
  /** v3.6：系统消息放法（model_catalog.system_message_mode）。 */
  systemMessageMode: SystemMessageMode;
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
    @Inject(ScenarioService) private readonly scenarios: ScenarioService,
    @Inject(MODEL_ACCESS_POLICY) private readonly policy: ModelPolicy,
  ) {}

  /**
   * 按用户的场景配置解析出模型（不检查可用性）；null = 该场景未配置。
   * 3.22：没有平台兜底默认；只有管理员自己的 admin_* 调用在没配置时用场景推荐模型。
   */
  async pick(
    userId: string,
    role: ModelRole,
    characterId: string | null,
    options: { purpose?: ModelPurpose; scenario?: ModelScenario } = {},
  ): Promise<{ facts: ModelFacts; source: 'override' | 'user' | 'platform_default' } | null> {
    if (role === 'adult_check') {
      const checker = await this.catalog.internalModel('adult_check');
      return checker ? { facts: checker, source: 'platform_default' } : null;
    }
    const scenario = scenarioFor(role, options.purpose ?? 'chat_reply', options.scenario);
    const picked = await this.scenarios.pick(userId, scenario, characterId);
    if (picked) return picked;
    if (options.purpose?.startsWith('admin_')) {
      const recommended = await this.catalog.recommendedModel(scenario);
      if (recommended) return { facts: recommended, source: 'platform_default' };
    }
    return null;
  }

  async resolve(input: {
    userId: string;
    modelRole: ModelRole;
    purpose: ModelPurpose;
    characterId?: string;
    /** T-071：消息带图片时同样要求识图能力（ChatMessageForModel.images）。 */
    hasImages?: boolean;
    /** T-090（CR-17）：只允许 purpose = behavior_planning；指定规划模型（不随用户的后台模型）。 */
    modelKeyOverride?: string;
    /** 网关内部：空输出降级用的备用模型（docs/refactor/03 第 1.4 B），不经契约传入。 */
    fallbackModelKey?: string;
    /** 仅可信平台能力经网关内部传入，绕过用户选择且拒绝成人模型。 */
    platformTask?: boolean;
    /** 3.22：按哪个场景解析（只对 chat 角色有意义）。 */
    scenario?: ModelScenario;
  }): Promise<PortResult<ResolvedModel, GenerateError>> {
    if (
      input.modelRole === 'adult_check' &&
      (input.purpose !== 'safety_check' || !input.characterId || input.modelKeyOverride)
    )
      return { ok: false, error: 'bad_request' };
    let picked: { facts: ModelFacts } | null;
    if (input.platformTask && input.modelRole !== 'adult_check') {
      if (
        !['safety_check', 'safety_followup', 'small_v', 'search_candidates', 'moments'].includes(
          input.purpose,
        )
      )
        return { ok: false, error: 'bad_request' };
      const use = PLATFORM_TASK_USE[input.purpose];
      const platform = use ? await this.catalog.internalModel(use) : null;
      picked = platform ? { facts: platform } : null;
    } else if (input.fallbackModelKey) {
      if (input.modelRole !== 'background') return { ok: false, error: 'bad_request' };
      picked = { facts: await this.catalog.fact(input.fallbackModelKey) };
    } else if (input.modelKeyOverride) {
      if (input.purpose !== 'behavior_planning') return { ok: false, error: 'bad_request' };
      picked = { facts: await this.catalog.fact(input.modelKeyOverride) };
    } else if (input.purpose === 'behavior_planning') {
      // 规划模型只认平台内部模型「行为规划」。未配置时明确失败（not_configured），
      // 调用方（planner）收到失败后回落规则版：不调模型、不扣费。
      const planner = await this.catalog.internalModel('planner');
      picked = planner ? { facts: planner } : null;
    } else {
      picked = await this.pick(input.userId, input.modelRole, input.characterId ?? null, {
        purpose: input.purpose,
        ...(input.scenario ? { scenario: input.scenario } : {}),
      });
    }
    if (!picked) return { ok: false, error: 'not_configured' };
    const facts = picked.facts;
    if (input.modelRole === 'adult_check') {
      let allowed = false;
      try {
        const url = new URL(facts.upstreamBaseUrl ?? '');
        allowed =
          url.protocol === 'https:' &&
          url.hostname === 'openrouter.ai' &&
          (!url.port || url.port === '443') &&
          !url.username &&
          !url.password;
      } catch {
        /* 没有有效上游地址时不放行，不回落到用户后台模型。 */
      }
      if (!allowed) return { ok: false, error: 'model_not_allowed' };
    }
    const usedVisionDefault = false;
    const checkUsable = (f: ModelFacts): GenerateError | null => {
      const reason = unavailableReason(f.entry, f.upstreamStatus);
      if (reason === 'model_removed') return 'model_unavailable';
      if (reason === 'provider_unavailable') return 'provider_unavailable';
      return null;
    };
    const first = checkUsable(facts);
    if (first) return { ok: false, error: first };
    // 3.24：图片随本次的模型（文本聊天 / 私密模式）发送，不再改用单独的识图模型。
    if (
      (input.purpose === 'vision' || input.hasImages === true) &&
      !facts.entry?.capabilities.includes('vision')
    )
      return { ok: false, error: 'capability_missing' };
    const entry = facts.entry;
    if (!entry) return { ok: false, error: 'model_unavailable' };
    if (
      input.platformTask &&
      input.modelRole !== 'adult_check' &&
      hasAdultContent(entry.capabilities)
    )
      return { ok: false, error: 'model_not_allowed' };
    // 规划模型一律不能是无审查模型（CR-17）。
    if (input.purpose === 'behavior_planning' && hasAdultContent(entry.capabilities))
      return { ok: false, error: 'model_not_allowed' };
    // 调用时的无审查模型闸门（billing.md 第 9 节第 2 条）
    if (input.modelRole === 'adult_check' || hasAdultContent(entry.capabilities)) {
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
        systemMessageMode: asSystemMessageMode(entry.systemMessageMode),
        usedVisionDefault,
      },
    };
  }
}

/** 报价时按用途选模型角色：聊天类用途用聊天模型，其余沿用后台模型（与网关调用方的惯例一致）。 */
const CHAT_ROLE_PURPOSES: readonly ModelPurpose[] = [
  'chat_reply',
  'safety_check',
  'safety_followup',
  'vision',
  'voice',
  'image_generation',
  'web_search',
  'import_analysis',
];

/**
 * 契约 3.1 ModelQuotePort（积压 ㉖）：按用户所选模型报价。先按用途 / 角色覆盖 / 平台默认解析模型（识图缺能力时改用默认识图模型），
 * 再经 BillingQuotePort 按当前价目表计价。不调用上游、不冻结、不扣费。
 */
@Injectable()
export class ModelQuoteService implements ModelQuotePort {
  constructor(
    @Inject(ModelResolver) private readonly resolver: ModelResolver,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(BILLING_QUOTE_PORT) private readonly billingQuote: BillingQuotePort,
    @Optional() @Inject(BillingBoundsService) private readonly bounds?: BillingBoundsService,
  ) {}

  async quote(input: {
    userId: string;
    characterId?: string;
    purpose: ModelPurpose;
    hasImages?: boolean;
    modelKeyOverride?: string;
    scenario?: ModelScenario;
    estimate: UsageQuantities;
  }): ReturnType<ModelQuotePort['quote']> {
    // v5（model-routing-ecology 块 A-3）：报价与执行共用 ModelResolver.resolve，消除
    // behavior_planning（原先回落用户后台模型）与带图识图（原先只看 purpose=vision）的两套口径。
    const role: ModelRole = CHAT_ROLE_PURPOSES.includes(input.purpose) ? 'chat' : 'background';
    const resolved = await this.resolver.resolve({
      userId: input.userId,
      modelRole: role,
      purpose: input.purpose,
      ...(input.characterId ? { characterId: input.characterId } : {}),
      ...(input.hasImages ? { hasImages: true } : {}),
      ...(input.modelKeyOverride ? { modelKeyOverride: input.modelKeyOverride } : {}),
      ...(input.scenario ? { scenario: input.scenario } : {}),
    });
    if (!resolved.ok)
      return {
        ok: false,
        error: resolved.error === 'model_unavailable' ? 'model_removed' : 'not_configured',
      };
    const facts: ModelFacts = await this.catalog.fact(resolved.value.modelKey);
    const entry = facts.entry;
    if (!entry) return { ok: false, error: 'model_removed' };
    const reason = unavailableReason(entry, facts.upstreamStatus);
    if (reason) return { ok: false, error: reason === 'model_removed' ? reason : 'not_configured' };
    const proofs = (await this.bounds?.profiles(entry.modelKey)) ?? [];
    const texts = proofs.flatMap((proof) => (proof.text ? [proof.text] : []));
    let upper: UsageQuantities;
    if (texts.length) {
      const requested = input.estimate.outputTokens ?? 600;
      const possible = texts.filter((text) => text.maxOutputTokens >= requested);
      if (!possible.length) return { ok: false, error: 'price_missing' };
      upper = {
        inputTokens: Math.max(...possible.map((text) => text.contextTokens)),
        outputTokens: Math.max(
          ...possible.map((text) =>
            Math.min(text.maxOutputTokens, 32000, Math.ceil(requested * 1.5)),
          ),
        ),
      };
    } else if (input.purpose === 'behavior_planning' && proofs.some((proof) => proof.decision)) {
      upper = {
        inputTokens: Math.max(
          ...proofs.flatMap((proof) => (proof.decision ? [proof.decision.maxInputTokens] : [])),
        ),
        outputTokens: 0,
      };
    } else return { ok: false, error: 'price_missing' };
    const priced = await this.billingQuote.quote(entry.modelKey, upper);
    if (!priced) return { ok: false, error: 'price_missing' };
    return {
      ok: true,
      value: {
        modelKey: entry.modelKey,
        amountMicros: priced.amountMicros,
        priceVersionId: priced.priceVersionId,
      },
    };
  }
}

@Injectable()
export class ModelStatusService {
  constructor(
    @Inject(ModelResolver) private readonly resolver: ModelResolver,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Optional() @Inject(ModelQuoteService) private readonly quotes?: ModelQuoteService,
    @Optional() @Inject(BillingBoundsService) private readonly bounds?: BillingBoundsService,
  ) {}

  /** GET /model/status：某角色（或全局）当前能否回复，用于私聊顶部横条。 */
  async getStatus(userId: string, characterId: string | null): Promise<ModelStatus> {
    const base = await this.baseStatus(userId, characterId);
    // 3.1（积压 ㉚）：识图可用 = 解析出的聊天模型有 vision 能力，或平台设置了默认识图模型。
    return { ...base, visionAvailable: await this.visionAvailable(userId, characterId) };
  }

  private async visionAvailable(userId: string, characterId: string | null): Promise<boolean> {
    try {
      const usable = async (f: ModelFacts | undefined) =>
        !!f?.entry?.capabilities.includes('vision') &&
        unavailableReason(f.entry, f.upstreamStatus) === null &&
        ((await this.bounds?.profiles(f.entry.modelKey)) ?? []).some(
          (proof) => (proof.text?.maxImages ?? 0) > 0,
        );
      // 3.24：只看文本聊天模型（不再有图片识别场景）
      const picked = await this.resolver.pick(userId, 'chat', characterId);
      return usable(picked?.facts);
    } catch {
      return false;
    }
  }

  private async baseStatus(userId: string, characterId: string | null): Promise<ModelStatus> {
    const picked = await this.resolver.pick(userId, 'chat', characterId);
    if (!picked) {
      return {
        characterId,
        available: false,
        reason: 'not_configured',
        canFallbackToDefault: false,
      };
    }
    const baseReason = unavailableReason(picked.facts.entry, picked.facts.upstreamStatus);
    // 3.24：具体原因（密钥无效 / 余额不足 / 被健康检查暂停 / 缺计费上限 / 没有价格…）
    const detail =
      (await this.catalog.availabilityDetails([picked.facts.modelKey])).get(
        picked.facts.modelKey,
      ) ?? (baseReason === 'model_removed' ? 'model_removed' : null);
    const reason =
      baseReason ??
      (detail ? (detail === 'model_removed' ? 'model_removed' : 'provider_unavailable') : null);
    if (reason) {
      let canFallbackToDefault = false;
      if (picked.source === 'override') {
        // 角色单独设置的模型不可用：看全局（或平台默认）聊天模型是否正常
        const global = await this.resolver.pick(userId, 'chat', null);
        canFallbackToDefault =
          global !== null &&
          unavailableReason(global.facts.entry, global.facts.upstreamStatus) === null &&
          !(await this.catalog.availabilityDetails([global.facts.modelKey])).get(
            global.facts.modelKey,
          );
      }
      return { characterId, available: false, reason, canFallbackToDefault, detail };
    }
    const spend = await this.billing.getSpendStatus(userId);
    const quote = await this.quotes?.quote({
      userId,
      ...(characterId ? { characterId } : {}),
      purpose: 'chat_reply',
      estimate: { outputTokens: 600 },
    });
    if (!quote?.ok) {
      // 3.24：报价失败多半是线路的最大输出不够一条回复，或计费上限 / 价格缺失——写清楚，不再笼统说「没配置」
      if (quote && quote.error === 'price_missing') {
        const profiles = (await this.bounds?.profiles(picked.facts.modelKey)) ?? [];
        const texts = profiles.flatMap((p) => (p.text ? [p.text] : []));
        return {
          characterId,
          available: false,
          reason: 'provider_unavailable',
          canFallbackToDefault: false,
          detail:
            texts.length && texts.every((t) => t.maxOutputTokens < 600)
              ? 'output_limit_too_small'
              : texts.length
                ? 'price_missing'
                : 'billing_bounds_missing',
        };
      }
      return {
        characterId,
        available: false,
        reason: 'not_configured',
        canFallbackToDefault: false,
      };
    }
    if (quote.value.amountMicros > 0 && spend.availableMicros < quote.value.amountMicros) {
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
