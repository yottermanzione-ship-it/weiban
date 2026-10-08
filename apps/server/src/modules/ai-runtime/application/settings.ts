import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
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
} from '@weiban/contracts';
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
import { INITIAL_MODES } from '../domain/persona.js';
import { ReplyPlanStore } from './plan-store.js';
import { invalidateReplyPlans } from './invalidate.js';
import { companionSettings } from '../infra/db/schema.js';
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
      scenarioMode: (row?.scenarioMode ?? 'daily') as ScenarioMode,
      proactiveMessages: row?.proactiveMessages ?? true,
      proactiveFrequency: (row?.proactiveFrequency ?? 'medium') as 'low' | 'medium' | 'high',
      proactiveCalls: row?.proactiveCalls ?? false,
      dailyLife: row?.dailyLife ?? true,
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
      candidates: INITIAL_MODES,
      adminAllowlist: role.card.data.modes.adminAllowlist,
    });
    return {
      items: INITIAL_MODES.filter((mode) => allowed.some((m) => m.modeId === mode.modeId)).map(
        (mode) => ({ id: mode.modeId, name: mode.name }),
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
      if (characterId && (missing || !allowed?.items.some((m) => m.id === mode))) {
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
                reason: mode === 'adult' ? 'adult_mode_unavailable' : 'scenario_mode_unavailable',
              },
              idempotencyKey: `mode-unavailable:${userId}:${characterId}:${Date.parse(value.updatedAt)}`,
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
        scenarioMode: patch.scenarioMode ?? old.scenarioMode ?? 'daily',
        proactiveMessages: patch.proactiveMessages ?? old.proactiveMessages ?? true,
        proactiveFrequency: patch.proactiveFrequency ?? old.proactiveFrequency ?? 'medium',
        proactiveCalls: patch.proactiveCalls ?? old.proactiveCalls ?? false,
        dailyLife: patch.dailyLife ?? old.dailyLife ?? true,
        updatedAt: this.clock.now(),
      };
      if (characterId && patch.scenarioMode && patch.scenarioMode !== old.scenarioMode) {
        const contact = await this.contacts.getActiveContact(userId, characterId, tx);
        if (!contact?.conversationId) throw new AppError('not_found', '会话不存在');
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
          idempotencyKey: `mode:${userId}:${characterId}:${newId()}`,
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
}
