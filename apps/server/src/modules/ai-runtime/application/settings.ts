import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  Id,
  UpdateCompanionSettingsRequest,
  type IdentityAccountStatusPort,
  type ContactsReadPort,
  type CompanionSettings,
  type SyncPort,
  type PolicyPort,
  type CharacterReadPort,
  type ChatAdminPort,
  type AdultModelReadPort,
  type ScenarioMode,
  type MediaAssetReadPort,
} from '@weiban/contracts';
import { MEDIA_ASSET_READ_PORT } from '../../media/index.js';
import {
  AppError,
  CLOCK,
  DATABASE,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { CHARACTER_READ_PORT } from '../../characters/index.js';
import { CHAT_ADMIN_PORT } from '../../chat/index.js';
import { ADULT_MODEL_READ_PORT } from '../../model-access/index.js';
import { INITIAL_MODES, modeOption, SELECTABLE_MODES } from '../domain/persona.js';
import { ReplyPlanStore } from './plan-store.js';
import { invalidateReplyPlans } from './invalidate.js';
import { companionSettings } from '../infra/db/schema.js';
import { MemoryTierService } from './memory-tier.js';
import { PrivateDigestService } from './private-digest.js';
import { characterView, roleAdminAllowlist } from './character-view.js';
@Injectable()
export class CompanionSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(CHARACTER_READ_PORT) private readonly characters: CharacterReadPort,
    @Inject(CHAT_ADMIN_PORT) private readonly chat: ChatAdminPort,
    @Inject(ADULT_MODEL_READ_PORT) private readonly adultModels: AdultModelReadPort,
    @Inject(ReplyPlanStore) private readonly plans: ReplyPlanStore,
    @Inject(MEDIA_ASSET_READ_PORT) private readonly assets: MediaAssetReadPort,
    @Inject(MemoryTierService) private readonly tiers: MemoryTierService,
    /** H2：切出私密模式时登记「干净整理」（测试里可不注入）。 */
    @Optional() @Inject(PrivateDigestService) private readonly digests?: PrivateDigestService,
  ) {}
  private async guard(userId: string, characterId: string | null): Promise<void> {
    parseContract(Id, userId);
    if (characterId !== null) {
      parseContract(Id, characterId);
      if (!(await this.contacts.getActiveContact(userId, characterId)))
        throw new AppError('not_found', '好友不存在');
    }
  }
  private async lock(tx: DbTx, userId: string): Promise<void> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))", [
      userId,
    ]);
    if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
      throw new AppError('unauthenticated', '账号已失效');
  }
  private async load(
    tx: DbTx,
    userId: string,
    characterId: string | null,
  ): Promise<CompanionSettings & { inheritsDefaults: boolean }> {
    const query = (id: string | null) =>
      tx.db
        .select()
        .from(companionSettings)
        .where(
          and(
            eq(companionSettings.userId, userId),
            id === null
              ? isNull(companionSettings.characterId)
              : eq(companionSettings.characterId, id),
          ),
        );
    const [specific] = await query(characterId);
    const row = specific ?? (characterId !== null ? (await query(null))[0] : undefined);
    return {
      instantReply: row?.instantReply ?? false,
      splitBubbles: row?.splitBubbles ?? true,
      personaFit: row?.personaFit ?? 3,
      // 没有设置行 = 新账号默认：情景预设「自动」（docs/refactor/02 第 5.3 节，2026-10-13 AI 实现后启用）。
      scenarioMode: (row?.scenarioMode ?? 'auto') as ScenarioMode,
      proactiveMessages: row?.proactiveMessages ?? true,
      proactiveFrequency: (row?.proactiveFrequency ?? 'medium') as 'low' | 'medium' | 'high',
      proactiveCalls: row?.proactiveCalls ?? false,
      dailyLife: row?.dailyLife ?? true,
      voiceId: row?.voiceId ?? null,
      // v5 批 B：长上下文只认该角色自己的设置行，不从全局默认继承。
      longContext: characterId !== null && !!specific?.longContext,
      updatedAt: (row?.updatedAt ?? this.clock.now()).toISOString(),
      inheritsDefaults: characterId !== null && !specific,
    };
  }
  async listModes(userId: string, characterId: string) {
    await this.guard(userId, characterId);
    const role = await this.characters.getForRuntime(userId, characterId);
    if (!role) throw new AppError('not_found', '角色不存在');
    const allowed = await this.policy.listAllowedScenarioModes({
      userId,
      characterId,
      candidates: SELECTABLE_MODES,
      adminAllowlist: roleAdminAllowlist(characterView(role)),
    });
    return {
      items: SELECTABLE_MODES.filter((mode) => allowed.some((m) => m.modeId === mode.modeId)).map(
        modeOption,
      ),
    };
  }
  async get(
    userId: string,
    characterId: string | null,
  ): Promise<CompanionSettings & { inheritsDefaults: boolean }> {
    await this.guard(userId, characterId);
    const allowed = characterId ? await this.listModes(userId, characterId) : null;
    const adult = characterId
      ? await this.adultModels.getAdultModelStatus(userId, characterId)
      : null;
    return this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      const contact = characterId
        ? await this.contacts.getActiveContact(userId, characterId, tx)
        : null;
      if (characterId && !(await this.contacts.getActiveContactEpoch(userId, characterId, tx)))
        throw new AppError('not_found', '好友不存在');
      const value = await this.load(tx, userId, characterId);
      const mode = value.scenarioMode ?? 'daily';
      const missing =
        mode === 'adult' && adult && !adult.available && adult.reason !== 'provider_unavailable';
      // 当前已经是日常时无需「回落到日常」：再写一遍设置、再发一条提示只会在每次进聊天时刷屏。
      // 真正的回落（成人模型不可用、角色不再允许该模式）仍然保留一次可见提示。
      if (
        characterId &&
        mode !== 'daily' &&
        (missing || !allowed?.items.some((m) => m.id === mode))
      ) {
        const reason = mode === 'adult' ? 'adult_mode_unavailable' : 'scenario_mode_unavailable';
        // 同一用户、同一角色、同一原因只登记 / 提示一次；幂等键不能带会随写入变化的 updatedAt。
        const fallbackKey = `mode-unavailable:${userId}:${characterId}:${reason}`;
        value.scenarioMode = 'daily';
        if (!value.inheritsDefaults)
          await tx.db
            .update(companionSettings)
            .set({ scenarioMode: 'daily', updatedAt: this.clock.now() })
            .where(
              and(
                eq(companionSettings.userId, userId),
                eq(companionSettings.characterId, characterId),
              ),
            );
        if (contact?.conversationId) {
          // H2：私密模型不可用导致的自动切回也算一次切出（同一个回落键只登记一次）。
          if (mode === 'adult' && characterId)
            await this.digests?.enqueue(tx, {
              userId,
              characterId,
              conversationId: contact.conversationId,
              eventKey: fallbackKey,
            });
          await this.chat.setContentScope(
            { conversationId: contact.conversationId, scope: 'normal' },
            tx,
          );
          if (!value.inheritsDefaults)
            await this.chat.postSystemMessage(tx, {
              conversationId: contact.conversationId,
              code: 'scenario_mode_changed',
              params: {
                mode: 'daily',
                reason,
              },
              idempotencyKey: fallbackKey,
            });
        }
        // An ineligible inherited default is an effective fallback, not a persisted setting change.
        // Invalidating here would cancel the very reply whose context is being built on every retry.
        if (!value.inheritsDefaults)
          await invalidateReplyPlans(tx, this.plans, userId, characterId);
      }
      return value;
    });
  }
  async update(
    userId: string,
    characterId: string | null,
    input: unknown,
  ): Promise<CompanionSettings & { inheritsDefaults: boolean }> {
    const patch = parseContract(UpdateCompanionSettingsRequest, input);
    await this.guard(userId, characterId);
    const allowed =
      characterId && patch.scenarioMode ? await this.listModes(userId, characterId) : null;
    // 3.27（H1）：「情侣暧昧」不再可选（全局默认也不行）。
    if (patch.scenarioMode === 'romance')
      throw new AppError('bad_request', '情侣暧昧已改为随好感度阶段自动解锁');
    if (patch.scenarioMode === 'adult') {
      if (!characterId) throw new AppError('bad_request', '成人模式只能为单独角色开启');
      const decision = await this.policy.checkScenarioMode({
        userId,
        characterId,
        mode: INITIAL_MODES.find((m) => m.modeId === 'adult')!,
      });
      if (!decision.allowed) throw new AppError('adult_mode_not_eligible', '该角色不能开启此模式');
      const adult = await this.adultModels.getAdultModelStatus(userId, characterId);
      if (!adult.available) throw new AppError('adult_model_missing', '请先选择可用的成人模式模型');
    }
    if (patch.scenarioMode && allowed && !allowed.items.some((m) => m.id === patch.scenarioMode))
      throw new AppError('bad_request', '该角色不允许此模式');
    // T-071：音色只能选音色库里启用的音色（MED-03 第 1 条，非克隆）。
    if (patch.voiceId) {
      const voice = await this.assets.getVoice(patch.voiceId);
      if (!voice || !voice.enabled) throw new AppError('bad_request', '音色不存在或已停用');
    }
    // v5 批 B：长上下文模式 PRO+ 专属、只对单个角色（全局默认传了忽略）。
    if (patch.longContext === true && characterId && !(await this.tiers.isProPlus(userId)))
      throw new AppError('forbidden', '长上下文模式需要 PRO+ 会员');
    const activeContacts = characterId ? [] : await this.contacts.listActiveContacts(userId);
    return this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      if (characterId && !(await this.contacts.getActiveContactEpoch(userId, characterId, tx)))
        throw new AppError('not_found', '好友不存在');
      const old = await this.load(tx, userId, characterId);
      if (!Object.keys(patch).length) return old;
      const values = {
        userId,
        characterId,
        instantReply: patch.instantReply ?? old.instantReply,
        splitBubbles: patch.splitBubbles ?? old.splitBubbles,
        personaFit: patch.personaFit ?? old.personaFit ?? 3,
        scenarioMode: patch.scenarioMode ?? old.scenarioMode ?? 'auto',
        proactiveMessages: patch.proactiveMessages ?? old.proactiveMessages ?? true,
        proactiveFrequency: patch.proactiveFrequency ?? old.proactiveFrequency ?? 'medium',
        proactiveCalls: patch.proactiveCalls ?? old.proactiveCalls ?? false,
        dailyLife: patch.dailyLife ?? old.dailyLife ?? true,
        voiceId: patch.voiceId === undefined ? (old.voiceId ?? null) : patch.voiceId,
        longContext: characterId ? (patch.longContext ?? old.longContext ?? false) : false,
        updatedAt: this.clock.now(),
      };
      if (characterId && patch.scenarioMode && patch.scenarioMode !== old.scenarioMode) {
        const contact = await this.contacts.getActiveContact(userId, characterId, tx);
        if (!contact?.conversationId) throw new AppError('not_found', '会话不存在');
        const switchId = newId();
        // H2（总经理 10-21 C14）：切出私密模式（切到自动或任何非私密模式）→ 登记一次「干净整理」，
        // 以这次切换为准（switchId），异步由私密模型生成，不阻塞切换。
        if (old.scenarioMode === 'adult' && patch.scenarioMode !== 'adult')
          await this.digests?.enqueue(tx, {
            userId,
            characterId,
            conversationId: contact.conversationId,
            eventKey: `mode:${switchId}`,
          });
        const result = await this.chat.setContentScope(
          {
            conversationId: contact.conversationId,
            scope: patch.scenarioMode === 'adult' ? 'adult' : 'normal',
          },
          tx,
        );
        if (!result.ok) throw new AppError(result.error, '模式切换失败');
        await this.chat.postSystemMessage(tx, {
          conversationId: contact.conversationId,
          code: 'scenario_mode_changed',
          params: { mode: patch.scenarioMode },
          idempotencyKey: `mode:${userId}:${characterId}:${switchId}`,
        });
      }
      await tx.db
        .insert(companionSettings)
        .values({ id: newId(), ...values })
        .onConflictDoUpdate({
          target: [companionSettings.userId, companionSettings.characterId],
          set: values,
        });
      if (characterId) await invalidateReplyPlans(tx, this.plans, userId, characterId);
      else {
        for (const contact of activeContacts)
          await invalidateReplyPlans(tx, this.plans, userId, contact.characterId);
      }
      await this.sync.appendUpdate(tx, userId, {
        type: 'settings.updated',
        data: { section: 'companion', characterId },
      });
      return { ...values, updatedAt: values.updatedAt.toISOString(), inheritsDefaults: false };
    });
  }

  /**
   * T-090 / SAFE-03 第 5 条：characters.character_classification_changed。
   * 资格变为「否」的成人模式（以及不再允许恋爱的恋爱模式）立即切回日常、内容范围改回 normal，并写系统提示。
   * ownerUserId 非空（自定义角色）只影响创建者；预设角色影响所有在该模式下的用户。
   */
  async onClassificationChanged(
    tx: DbTx,
    p: {
      characterId: string;
      ownerUserId: string | null;
      adultModeEligible: boolean;
      romanceAllowed: boolean;
    },
  ): Promise<void> {
    const modes: string[] = [];
    if (!p.adultModeEligible) modes.push('adult');
    if (!p.romanceAllowed) modes.push('romance');
    if (!modes.length) return;
    const rows = await tx.db
      .select()
      .from(companionSettings)
      .where(
        and(
          eq(companionSettings.characterId, p.characterId),
          inArray(companionSettings.scenarioMode, modes),
          p.ownerUserId ? eq(companionSettings.userId, p.ownerUserId) : undefined,
        ),
      );
    const now = this.clock.now();
    for (const row of rows) {
      await tx.db
        .update(companionSettings)
        .set({ scenarioMode: 'daily', updatedAt: now })
        .where(eq(companionSettings.id, row.id));
      const contact = await this.contacts.getActiveContact(row.userId, p.characterId, tx);
      if (contact?.conversationId) {
        await this.chat.setContentScope(
          { conversationId: contact.conversationId, scope: 'normal' },
          tx,
        );
        await this.chat.postSystemMessage(tx, {
          conversationId: contact.conversationId,
          code: 'scenario_mode_changed',
          params: {
            mode: 'daily',
            reason:
              row.scenarioMode === 'adult' ? 'adult_mode_unavailable' : 'scenario_mode_unavailable',
          },
          idempotencyKey: `classification:${row.userId}:${p.characterId}:${now.getTime()}`,
        });
      }
      await invalidateReplyPlans(tx, this.plans, row.userId, p.characterId);
      await this.sync.appendUpdate(tx, row.userId, {
        type: 'settings.updated',
        data: { section: 'companion', characterId: p.characterId },
      });
    }
  }
}
