/**
 * 3.25（10-21 试用反馈第三轮 G1-2）：后台人工标注角色资格。
 *
 * 管理员可以直接改「真人 / 未成年设定 / 儿童外貌 / 检出儿童特征」（两个方向都能改，用来纠正 AI 误判），
 * 预设角色与用户自建角色都适用。人工标注存在 characters.eligibility_override（全量事实），classify() 优先按它；
 * 资料里的分类列与 AI / 系统检出照常由自动流程维护，清除人工标注即恢复自动结果——所以不需要放宽分类触发器。
 * 每次修改写 eligibility_changes（谁、何时、原因必填）和审计日志；生效分类变化时发
 * characters.character_classification_changed，私密模式 / 恋爱模式等由 ai-runtime 按新资格立即收紧或放开。
 */
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type {
  AdminCharacterEligibility,
  CharacterEligibilityFacts,
  IdentityDirectoryPort,
  UpdateCharacterEligibilityRequest,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  newId,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
import { characters, eligibilityChanges, type EligibilityOverride } from '../infra/db/schema.js';
import { CharacterService } from './characters.js';

type Row = typeof characters.$inferSelect;

const sameFacts = (a: EligibilityOverride | null, b: EligibilityOverride | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

@Injectable()
export class CharacterEligibilityService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CharacterService) private readonly characters: CharacterService,
    @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory: IdentityDirectoryPort,
  ) {}

  private autoFacts(row: Row): CharacterEligibilityFacts {
    const c = this.characters.autoClassify(row);
    return {
      basis: c.basis,
      realPersonKind: c.realPersonKind,
      ageSetting: c.ageSetting,
      childAppearance: c.childAppearance,
      childFeaturesDetected: c.childFeaturesDetected,
    };
  }

  private normalize(facts: CharacterEligibilityFacts): EligibilityOverride {
    return {
      basis: facts.basis,
      realPersonKind: facts.basis === 'real_person' ? facts.realPersonKind : null,
      ageSetting: facts.ageSetting,
      childAppearance: facts.childAppearance,
      childFeaturesDetected: facts.childFeaturesDetected,
    };
  }

  async get(characterId: string): Promise<AdminCharacterEligibility> {
    const [row] = await this.database.db
      .select()
      .from(characters)
      .where(eq(characters.id, characterId));
    if (!row) throw new AppError('not_found', '角色不存在');
    const history = await this.database.db
      .select()
      .from(eligibilityChanges)
      .where(eq(eligibilityChanges.characterId, characterId))
      .orderBy(desc(eligibilityChanges.createdAt))
      .limit(50);
    const operatorIds = [
      ...new Set(history.flatMap((h) => (h.operatorUserId ? [h.operatorUserId] : []))),
    ];
    const names = operatorIds.length
      ? await this.directory.getUsernames(operatorIds).catch(() => ({}) as Record<string, string>)
      : {};
    return {
      characterId: row.id,
      name: row.name,
      kind: row.kind as 'preset' | 'custom',
      auto: this.autoFacts(row),
      override: row.eligibilityOverride ?? null,
      effective: this.characters.classify(row),
      history: history.map((h) => ({
        at: h.createdAt.toISOString(),
        operatorUserId: h.operatorUserId,
        operatorName: (h.operatorUserId && names[h.operatorUserId]) || '',
        reason: h.reason,
        before: h.beforeOverride ?? null,
        after: h.afterOverride ?? null,
      })),
    };
  }

  async set(
    adminId: string,
    characterId: string,
    body: UpdateCharacterEligibilityRequest,
  ): Promise<AdminCharacterEligibility> {
    const next = body.override ? this.normalize(body.override) : null;
    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(characters)
        .where(eq(characters.id, characterId))
        .for('update');
      if (!row) throw new AppError('not_found', '角色不存在');
      const before = row.eligibilityOverride ?? null;
      if (sameFacts(before, next)) return;
      const now = this.clock.now();
      const [updated] = await tx.db
        .update(characters)
        .set({ eligibilityOverride: next })
        .where(eq(characters.id, characterId))
        .returning();
      await tx.db.insert(eligibilityChanges).values({
        id: newId(),
        characterId,
        operatorUserId: adminId,
        reason: body.reason,
        beforeOverride: before,
        afterOverride: next,
        createdAt: now,
      });
      await this.audit.record(
        {
          module: 'characters',
          action: 'eligibility.overridden',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: characterId,
          details: { reason: body.reason, before, after: next },
        },
        tx,
      );
      const was = this.characters.classify(row).derived;
      const now2 = this.characters.classify(updated!).derived;
      if (JSON.stringify(was) !== JSON.stringify(now2))
        await this.characters.classificationEvent(tx, updated!);
    });
    return this.get(characterId);
  }
}
