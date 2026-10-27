/**
 * 3.22（试用反馈批 E3）：用户按场景的模型配置与角色逐场景单独设置。
 *
 * - 场景见契约 ModelScenario；每个场景用户单独选一个模型，**没有平台兜底默认**（未配置 = 该场景功能不可用，
 *   客户端首次使用时引导配置）；后台给每个场景指定的「推荐模型」只用于一键选推荐。
 * - 解析顺序：角色单独设置 > 用户场景配置 > 无（not_configured）。唯一的解析入口是 pick()，
 *   网关执行、报价、模型状态都经 ModelResolver 调它，不各写各的。
 * - 选择规则：模型须启用且后台勾选可用于该场景（422 model_unavailable）；私密模式以外的全局场景不能选无审查模型
 *   （422 model_not_allowed，全局选择会作用到真人和儿童角色）；角色单独设置每次都问 policy（无成人资格的角色用
 *   无审查模型 → 403 model_not_allowed）。
 * 选择变化发 model_access.selection_changed（与原「模型选择」同一个事件）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CharacterScenarioConfig, ModelScenario, ScenarioConfig } from '@weiban/contracts';
import { and, eq } from 'drizzle-orm';
import {
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  type Clock,
  type Database,
  type Outbox,
} from '../../../platform/index.js';
import { hasAdultContent } from '../domain/rules.js';
import { characterScenarioOverrides, scenarioSelections } from '../infra/db/schema.js';
import { MODEL_ACCESS_POLICY, type ModelPolicy } from '../tokens.js';
import { ALL_SCENARIOS, CatalogService, type ModelFacts } from './catalog.js';
import { refState, type ModelRefStateOut } from './selection-state.js';
import { isRealtimeCallEntry } from './realtime-call.js';
import {
  checkVoiceCallComponents,
  isVoiceCallComposite,
  VOICE_CALL_CASCADE_MODEL_KEY,
  voiceCallFailureDetail,
  type VoiceCallFailure,
  type VoiceCallPlan,
} from './voice-call-composite.js';

export type ScenarioRefs = Partial<Record<ModelScenario, { modelKey: string } | null>>;

const isScenario = (s: string): s is ModelScenario =>
  (ALL_SCENARIOS as readonly string[]).includes(s);

@Injectable()
export class ScenarioService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(MODEL_ACCESS_POLICY) private readonly policy: ModelPolicy,
  ) {}

  // ---------- 读取 ----------

  /** 用户各场景的原始选择（未配置的场景不在结果里）。 */
  async raw(userId: string): Promise<Map<ModelScenario, string>> {
    const rows = await this.database.db
      .select()
      .from(scenarioSelections)
      .where(eq(scenarioSelections.userId, userId));
    return new Map(
      rows
        .filter((r) => isScenario(r.scenario))
        .map((r) => [r.scenario as ModelScenario, r.modelKey]),
    );
  }

  /** 某角色的逐场景单独设置（没设置的场景不在结果里）。 */
  async rawOverrides(userId: string, characterId: string): Promise<Map<ModelScenario, string>> {
    const rows = await this.database.db
      .select()
      .from(characterScenarioOverrides)
      .where(
        and(
          eq(characterScenarioOverrides.userId, userId),
          eq(characterScenarioOverrides.characterId, characterId),
        ),
      );
    return new Map(
      rows
        .filter((r) => isScenario(r.scenario))
        .map((r) => [r.scenario as ModelScenario, r.modelKey]),
    );
  }

  /** 角色单独设置 > 用户场景配置；都没有 → null。 */
  private async selectedKey(
    userId: string,
    scenario: ModelScenario,
    characterId: string | null,
  ): Promise<{ key: string; source: 'override' | 'user' } | null> {
    if (characterId) {
      const override = (await this.rawOverrides(userId, characterId)).get(scenario);
      if (override) return { key: override, source: 'override' };
    }
    const key = (await this.raw(userId)).get(scenario);
    return key ? { key, source: 'user' } : null;
  }

  /**
   * **唯一的场景解析**：角色单独设置 > 用户场景配置；都没有 → null（not_configured）。
   * 不检查可用性（调用方按 unavailableReason 判断，选中的模型下架时不自动换，MDL-04）。
   *
   * ADR-20261024：`voice_call` 选到组合模型时，文本改用 `textModelKey`（识别 / 合成由媒体网关
   * 调 `voiceCallPlan` 取对应组件）。组合模型自身没有上游，绝不能被当成可调用的上游模型返回。
   */
  async pick(
    userId: string,
    scenario: ModelScenario,
    characterId: string | null,
  ): Promise<{ facts: ModelFacts; source: 'override' | 'user' | 'fixed' } | null> {
    // 3.28：私密模型由平台固定，用户/角色旧的 private 选择一律不读（唯一闸门）。
    if (scenario === 'private') {
      const facts = await this.catalog.fixedPrivateFacts();
      return facts ? { facts, source: 'fixed' } : null;
    }
    const selected = await this.selectedKey(userId, scenario, characterId);
    if (!selected) return null;
    if (scenario === 'voice_call') {
      const plan = await this.planForSelection(selected);
      if (plan.kind === 'composite')
        return { facts: plan.components.text, source: selected.source };
      if (plan.kind === 'unavailable') {
        // 组合关系没配好 = 这个场景还没配置；组件停用 / 删除 / 上游故障 = 模型不可用。
        // 两种情况都不换别的模型，由解析方按现有错误值给用户明确结果。
        if (plan.failure.reason === 'pipeline_unconfigured') return null;
        return {
          facts: { modelKey: selected.key, entry: null, upstreamStatus: null },
          source: selected.source,
        };
      }
    }
    return { facts: await this.catalog.fact(selected.key), source: selected.source };
  }

  /**
   * 通话运行时解析（媒体网关的实时识别 / 流式合成共用）：`voice_call` 选到组合模型时返回
   * 三个组件的目录事实；没选组合模型时返回 not_composite，调用方按原场景解析。
   */
  async voiceCallPlan(userId: string, characterId: string | null): Promise<VoiceCallPlan> {
    const selected = await this.selectedKey(userId, 'voice_call', characterId);
    return selected ? this.planForSelection(selected) : { kind: 'not_composite' };
  }

  private async planForSelection(selected: {
    key: string;
    source: 'override' | 'user';
  }): Promise<VoiceCallPlan> {
    const facts = await this.catalog.fact(selected.key);
    if (isRealtimeCallEntry(facts.entry))
      return { kind: 'realtime', source: selected.source, facts };
    if (!isVoiceCallComposite(facts.entry)) return { kind: 'not_composite' };
    const unavailable = (failure: VoiceCallFailure): VoiceCallPlan => ({
      kind: 'unavailable',
      source: selected.source,
      modelKey: selected.key,
      failure,
    });
    if (!facts.entry!.enabled) return unavailable({ reason: 'composite_disabled' });
    const pipeline = await this.catalog.voiceCallPipeline();
    if (!pipeline) return unavailable({ reason: 'pipeline_unconfigured' });
    // 防御：组合关系自引用会让运行时递归，按「没配好」处理。
    if (
      [pipeline.asrModelKey, pipeline.textModelKey, pipeline.ttsModelKey].includes(
        VOICE_CALL_CASCADE_MODEL_KEY,
      )
    )
      return unavailable({ reason: 'pipeline_unconfigured' });
    const factsByKey = await this.catalog.facts([
      pipeline.asrModelKey,
      pipeline.textModelKey,
      pipeline.ttsModelKey,
    ]);
    const checked = checkVoiceCallComponents(pipeline, {
      asr: factsByKey.get(pipeline.asrModelKey),
      text: factsByKey.get(pipeline.textModelKey),
      tts: factsByKey.get(pipeline.ttsModelKey),
    });
    if (!checked.ok) return unavailable(checked.failure);
    return {
      kind: 'composite',
      source: selected.source,
      pipeline,
      components: checked.value,
    };
  }

  /** 场景设置里的选择状态：组合模型的可用性由三个组件决定，不看它自己的（不存在的）上游。 */
  private stateOf(
    facts: ModelFacts | undefined,
    plan: VoiceCallPlan | null,
  ): ModelRefStateOut | null {
    if (!facts) return null;
    if (!isVoiceCallComposite(facts.entry) || !plan) return refState(facts);
    if (plan.kind === 'composite')
      return {
        modelKey: facts.modelKey,
        available: true,
        unavailableReason: null,
        unavailableDetail: null,
      };
    if (plan.kind === 'not_composite' || plan.kind === 'realtime') return refState(facts);
    const failure = plan.failure;
    if (failure.reason === 'pipeline_unconfigured' || failure.reason === 'composite_disabled')
      return {
        modelKey: facts.modelKey,
        available: false,
        unavailableReason:
          failure.reason === 'composite_disabled' ? 'model_removed' : 'provider_unavailable',
        unavailableDetail: voiceCallFailureDetail(failure),
      };
    return {
      modelKey: facts.modelKey,
      available: false,
      unavailableReason:
        failure.detail === 'model_removed' ? 'model_removed' : 'provider_unavailable',
      unavailableDetail: voiceCallFailureDetail(failure),
    };
  }

  async getConfig(userId: string): Promise<ScenarioConfig> {
    const raw = await this.raw(userId);
    const uses = await this.catalog.modelUses();
    const fixedKey = uses.fixed?.private ?? null;
    const keys = [...raw.values(), ...(fixedKey ? [fixedKey] : [])];
    const facts = await this.catalog.facts(keys, { detail: true });
    const voiceCallPlan = raw.has('voice_call') ? await this.voiceCallPlan(userId, null) : null;
    return {
      scenarios: ALL_SCENARIOS.map((scenario) => {
        const isPrivate = scenario === 'private';
        // 3.28：private 只读平台固定模型；旧用户选择不再出现（历史行仍留在库里）。
        const key = isPrivate ? fixedKey : raw.get(scenario);
        const f = key ? facts.get(key) : undefined;
        return {
          scenario,
          selection: this.stateOf(f, scenario === 'voice_call' ? voiceCallPlan : null),
          recommendedModelKey: isPrivate ? null : (uses.recommended[scenario] ?? null),
          ...(isPrivate && fixedKey ? { fixedByAdmin: true } : {}),
        };
      }),
      needsSetup: !raw.has('chat'),
    };
  }

  async getCharacter(userId: string, characterId: string): Promise<CharacterScenarioConfig> {
    const overrides = await this.rawOverrides(userId, characterId);
    const raw = await this.raw(userId);
    const fixedKey = (await this.catalog.modelUses()).fixed?.private ?? null;
    const keys = [...overrides.values(), ...raw.values(), ...(fixedKey ? [fixedKey] : [])];
    const facts = await this.catalog.facts(keys, { detail: true });
    const ownVoiceCall = overrides.has('voice_call');
    const globalVoiceCall = raw.has('voice_call');
    const ownPlan = ownVoiceCall ? await this.voiceCallPlan(userId, characterId) : null;
    const globalPlan = globalVoiceCall ? await this.voiceCallPlan(userId, null) : null;
    return {
      characterId,
      scenarios: ALL_SCENARIOS.map((scenario) => {
        const isPrivate = scenario === 'private';
        // 3.28：private 不可按角色单独设置；selection 恒为 null，effective 是平台固定模型。
        const own = isPrivate ? undefined : overrides.get(scenario);
        const effective = isPrivate ? (fixedKey ?? undefined) : (own ?? raw.get(scenario));
        const ownFacts = own ? facts.get(own) : undefined;
        const effectiveFacts = effective ? facts.get(effective) : undefined;
        const effectivePlan = scenario === 'voice_call' ? (own ? ownPlan : globalPlan) : null;
        return {
          scenario,
          selection: this.stateOf(ownFacts, scenario === 'voice_call' ? ownPlan : null),
          effective: this.stateOf(effectiveFacts, effectivePlan),
        };
      }),
    };
  }

  // ---------- 修改 ----------

  /** 校验某模型能否用于某场景（不含角色 policy 检查）。返回目录事实。 */
  private async checkUsable(scenario: ModelScenario, modelKey: string, global: boolean) {
    const f = await this.catalog.fact(modelKey);
    if (!f.entry || !f.entry.enabled || !f.entry.scenarios.includes(scenario))
      throw new AppError('model_unavailable', '这个模型不存在、已下架或不能用于这个场景', {
        status: 422,
        details: { field: scenario },
      });
    if (global && scenario !== 'private' && hasAdultContent(f.entry.capabilities))
      throw new AppError(
        'model_not_allowed',
        '允许成人内容的模型只能选为私密模式模型，或给有成人资格的角色单独设置',
        { status: 422, details: { field: scenario } },
      );
    return f;
  }

  async updateConfig(userId: string, refs: ScenarioRefs): Promise<ScenarioConfig> {
    if (refs.private !== undefined)
      throw new AppError('model_not_allowed', '私密模型由平台统一提供，不能自行选择或修改', {
        status: 422,
        details: { field: 'private' },
      });
    if (refs.image_generation != null)
      throw new AppError('bad_request', '发照片模型配置已取消；角色只分享表情或公开图片', {
        status: 422,
      });
    const writes: Array<{ scenario: ModelScenario; modelKey: string | null }> = [];
    for (const scenario of ALL_SCENARIOS) {
      const value = refs[scenario];
      if (value === undefined) continue;
      if (value !== null) await this.checkUsable(scenario, value.modelKey, true);
      writes.push({ scenario, modelKey: value?.modelKey ?? null });
    }
    await this.write(userId, null, writes);
    return this.getConfig(userId);
  }

  /** 一键选推荐：推荐模型写入未配置的场景（overwrite 时覆盖全部）；私密模式不自动选。 */
  async applyRecommended(userId: string, overwrite: boolean): Promise<ScenarioConfig> {
    const raw = await this.raw(userId);
    const uses = await this.catalog.modelUses();
    const writes: Array<{ scenario: ModelScenario; modelKey: string | null }> = [];
    for (const scenario of ALL_SCENARIOS) {
      if (scenario === 'private') continue;
      if (raw.has(scenario) && !overwrite) continue;
      const key = uses.recommended[scenario];
      if (!key) continue;
      try {
        await this.checkUsable(scenario, key, true);
      } catch {
        continue; // 推荐模型后来被下架或去掉了这个场景：跳过，不报错
      }
      writes.push({ scenario, modelKey: key });
    }
    await this.write(userId, null, writes);
    return this.getConfig(userId);
  }

  async updateCharacter(
    userId: string,
    characterId: string,
    refs: ScenarioRefs,
  ): Promise<CharacterScenarioConfig> {
    if (refs.private !== undefined)
      throw new AppError('model_not_allowed', '私密模型由平台统一提供，不能按角色单独设置', {
        status: 422,
        details: { field: 'private' },
      });
    if (refs.image_generation != null)
      throw new AppError('bad_request', '发照片模型配置已取消；角色只分享表情或公开图片', {
        status: 422,
      });
    const writes: Array<{ scenario: ModelScenario; modelKey: string | null }> = [];
    for (const scenario of ALL_SCENARIOS) {
      const value = refs[scenario];
      if (value === undefined) continue;
      if (value !== null) {
        const f = await this.checkUsable(scenario, value.modelKey, false);
        // 无审查模型闸门（hard-boundaries.md 第 4 节）：每次都问 policy，普通模型也问
        // （policy 同时确认角色属于该用户，不存在时 character_not_found）。
        const decision = await this.policy.checkModelForCharacter({
          userId,
          characterId,
          modelHasAdultContent: hasAdultContent(f.entry!.capabilities),
        });
        if (!decision.allowed) {
          if (decision.reason === 'character_not_found')
            throw new AppError('not_found', '角色不存在');
          if (decision.reason === 'model_not_allowed')
            throw new AppError('model_not_allowed', '这个角色不能使用允许成人内容的模型');
          throw new AppError('policy_denied', '这个角色不能使用该模型');
        }
      }
      writes.push({ scenario, modelKey: value?.modelKey ?? null });
    }
    await this.write(userId, characterId, writes);
    return this.getCharacter(userId, characterId);
  }

  private async write(
    userId: string,
    characterId: string | null,
    writes: Array<{ scenario: ModelScenario; modelKey: string | null }>,
  ): Promise<void> {
    if (!writes.length) return;
    await this.database.transaction(async (tx) => {
      const now = this.clock.now();
      for (const w of writes) {
        if (characterId === null) {
          if (w.modelKey === null)
            await tx.db
              .delete(scenarioSelections)
              .where(
                and(
                  eq(scenarioSelections.userId, userId),
                  eq(scenarioSelections.scenario, w.scenario),
                ),
              );
          else
            await tx.db
              .insert(scenarioSelections)
              .values({ userId, scenario: w.scenario, modelKey: w.modelKey, updatedAt: now })
              .onConflictDoUpdate({
                target: [scenarioSelections.userId, scenarioSelections.scenario],
                set: { modelKey: w.modelKey, updatedAt: now },
              });
        } else if (w.modelKey === null)
          await tx.db
            .delete(characterScenarioOverrides)
            .where(
              and(
                eq(characterScenarioOverrides.userId, userId),
                eq(characterScenarioOverrides.characterId, characterId),
                eq(characterScenarioOverrides.scenario, w.scenario),
              ),
            );
        else
          await tx.db
            .insert(characterScenarioOverrides)
            .values({
              userId,
              characterId,
              scenario: w.scenario,
              modelKey: w.modelKey,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                characterScenarioOverrides.userId,
                characterScenarioOverrides.characterId,
                characterScenarioOverrides.scenario,
              ],
              set: { modelKey: w.modelKey, updatedAt: now },
            });
      }
      await this.outbox.publish(tx, 'model_access.selection_changed', 'model_access', {
        userId,
        characterId,
      });
    });
  }
}
