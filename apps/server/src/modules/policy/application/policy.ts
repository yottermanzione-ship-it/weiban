import { Inject, Injectable } from '@nestjs/common';
import type {
  CharacterReadPort,
  Tx,
  PolicyPort,
  PolicyDecision,
  CharacterPolicy,
  ScenarioModeTraits,
} from '@weiban/contracts';
import { AUDIT_LOG, asDbTx, type AuditLog } from '../../../platform/index.js';
import { POLICY_CHARACTER_READ } from '../tokens.js';
import { checkMode, deriveClassification } from '../domain/rules.js';
@Injectable()
export class PolicyService implements PolicyPort {
  constructor(
    @Inject(POLICY_CHARACTER_READ) private readonly characters: CharacterReadPort,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}
  async getCharacterPolicy(userId: string, characterId: string): Promise<CharacterPolicy | null> {
    const runtime = await this.characters.getForRuntime(userId, characterId);
    if (!runtime) return null;
    const c = deriveClassification(
      runtime.classification,
      runtime.profile.kind,
      runtime.classification.childFeaturesDetected,
    );
    const d = c.derived;
    return {
      characterId,
      isRealPerson: c.basis === 'real_person',
      isHistorical: c.realPersonKind === 'historical' && runtime.profile.kind === 'preset',
      isMinor: d.isMinor,
      adultModeEligible: d.adultModeEligible,
      adultContentModelAllowed: d.adultModeEligible,
      romanceAllowed: d.romanceAllowed,
      portraitPolicy: d.portraitPolicy === 'unsupported' ? 'forbidden' : d.portraitPolicy,
      publicStatementGuard: d.publicStatementGuard,
      shareImageLabel: c.basis === 'real_person' ? 'not_real_person' : null,
      voiceCloneAllowed: false,
      recognitionAllowlist: runtime.card.data.recognition.selfEnabled ? [characterId] : [],
    };
  }
  private async decision(
    userId: string,
    characterId: string,
    action: string,
    decide: (p: CharacterPolicy) => PolicyDecision,
  ): Promise<PolicyDecision> {
    const policy = await this.getCharacterPolicy(userId, characterId);
    const result: PolicyDecision = policy
      ? decide(policy)
      : { allowed: false, reason: 'character_not_found' };
    if (!result.allowed)
      await this.audit.record({
        module: 'policy',
        action: 'operation.denied',
        actorType: 'user',
        actorId: userId,
        targetType: 'character',
        targetId: characterId,
        details: { operation: action, reason: result.reason },
      });
    return result;
  }
  async listAllowedScenarioModes(
    input: Parameters<PolicyPort['listAllowedScenarioModes']>[0],
  ): Promise<ScenarioModeTraits[]> {
    const p = await this.getCharacterPolicy(input.userId, input.characterId);
    if (!p) return [];
    return input.candidates.filter(
      (m) =>
        (!input.adminAllowlist || input.adminAllowlist.includes(m.modeId)) &&
        (!m.containsAdultContent || p.adultModeEligible) &&
        (!m.containsRomance || p.romanceAllowed),
    );
  }
  checkScenarioMode(
    input: Parameters<PolicyPort['checkScenarioMode']>[0],
  ): Promise<PolicyDecision> {
    return this.decision(input.userId, input.characterId, 'scenario_mode', (p) =>
      checkMode(
        {
          basis: p.isRealPerson ? 'real_person' : 'original',
          realPersonKind: p.isRealPerson ? 'celebrity' : null,
          ageSetting: p.isMinor ? 'minor' : 'adult',
          childAppearance: false,
          childFeaturesDetected: false,
          derived: {
            isMinor: p.isMinor,
            adultModeEligible: p.adultModeEligible,
            romanceAllowed: p.romanceAllowed,
            portraitPolicy: p.portraitPolicy,
            publicStatementGuard: p.publicStatementGuard,
          },
        },
        input.mode,
      ),
    );
  }
  async checkRelationshipType(
    input: Parameters<PolicyPort['checkRelationshipType']>[0],
    transaction?: Tx,
  ): Promise<PolicyDecision> {
    const decide = (romanceAllowed: boolean): PolicyDecision =>
      !romanceAllowed &&
      /lover|romance|partner|boyfriend|girlfriend|恋人|恋爱|情侣|男友|女友|男朋友|女朋友|老公|老婆|丈夫|妻子|夫妻|配偶/i.test(
        input.relationshipType,
      )
        ? { allowed: false, reason: 'romance_not_allowed' }
        : { allowed: true };
    if (!transaction)
      return this.decision(input.userId, input.characterId, 'relationship', (p) =>
        decide(p.romanceAllowed),
      );
    const classification = await this.characters.getClassification(input.characterId, transaction);
    const result: PolicyDecision = classification
      ? decide(classification.derived.romanceAllowed)
      : { allowed: false, reason: 'character_not_found' };
    if (!result.allowed)
      await this.audit.record(
        {
          module: 'policy',
          action: 'operation.denied',
          actorType: 'user',
          actorId: input.userId,
          targetType: 'character',
          targetId: input.characterId,
          details: { operation: 'relationship', reason: result.reason },
        },
        asDbTx(transaction),
      );
    return result;
  }
  async checkAdultGeneration(
    input: Parameters<PolicyPort['checkAdultGeneration']>[0],
    transaction?: Tx,
  ): Promise<PolicyDecision> {
    if (transaction) {
      const c = await this.characters.getClassification(input.characterId, transaction);
      const result: PolicyDecision = !c
        ? { allowed: false, reason: 'character_not_found' }
        : c.derived.adultModeEligible
          ? { allowed: true }
          : { allowed: false, reason: 'adult_mode_not_eligible' };
      if (!result.allowed)
        await this.audit.record(
          {
            module: 'policy',
            action: 'operation.denied',
            actorType: 'user',
            actorId: input.userId,
            targetType: 'character',
            targetId: input.characterId,
            details: { operation: 'adult_generation', reason: result.reason },
          },
          asDbTx(transaction),
        );
      return result;
    }
    return this.decision(input.userId, input.characterId, 'adult_generation', (p) =>
      p.adultModeEligible
        ? { allowed: true }
        : { allowed: false, reason: 'adult_mode_not_eligible' },
    );
  }
  checkModelForCharacter(
    input: Parameters<PolicyPort['checkModelForCharacter']>[0],
  ): Promise<PolicyDecision> {
    return this.decision(input.userId, input.characterId, 'adult_content_model', (p) =>
      !input.modelHasAdultContent || p.adultContentModelAllowed
        ? { allowed: true }
        : { allowed: false, reason: 'model_not_allowed' },
    );
  }
  checkImageGeneration(
    input: Parameters<PolicyPort['checkImageGeneration']>[0],
  ): Promise<PolicyDecision> {
    return this.decision(input.userId, input.characterId, 'image_generation', (p) =>
      !input.depictsCharacter ||
      p.portraitPolicy === 'allowed' ||
      (p.portraitPolicy === 'classical_art_only' && input.style === 'classical_illustration')
        ? { allowed: true }
        : { allowed: false, reason: 'portrait_not_allowed' },
    );
  }
}
