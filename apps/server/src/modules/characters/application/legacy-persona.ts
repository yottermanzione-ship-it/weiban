import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  LegacyPersonaDetail,
  LegacyPersonaSummary,
  LegacyPersonaReset,
  legacyDialogueExamples,
  legacyKnowledgeEntries,
  type IdentityAccountStatusPort,
  type LegacyRuntimeContext,
  type LegacyPersonaBlockedReason,
  type SyncPort,
} from '@weiban/contracts';
import {
  AppError,
  DATABASE,
  CLOCK,
  ENVELOPE_CRYPTO,
  assertLegacyMigrationOwnerAllowed,
  type Database,
  type DbTx,
  type Clock,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import {
  LegacyPersonaImport,
  assertSafePersonaJson,
  bytesDigest,
  editablePersonaDocument,
  isObject,
  personaDigest,
  personaPatchReason,
  personaChildFeatures,
  projectPersonalPersona,
  targetPersonaPackage,
  type JsonObject,
} from '../domain/legacy-persona.js';

interface Target {
  id: string;
  owner_id: string | null;
  kind: string;
  status: string;
  name: string;
  legacy_card: JsonObject | null;
  revision: number;
  persona_version: number;
  basis: string;
  real_person_kind: string | null;
  age_setting: string;
  child_appearance: boolean;
  eligibility_override: {
    basis: string;
    realPersonKind: string | null;
    ageSetting: string;
    childAppearance: boolean;
  } | null;
}
interface Stored {
  user_id: string;
  character_id: string;
  version: number;
  state: 'active' | 'blocked' | 'reset';
  source_key: string | null;
  source_version: number | null;
  source_digest: string | null;
  source_updated_at: Date | null;
  ciphertext: Buffer | null;
  blocked_reason: LegacyPersonaBlockedReason | null;
  child_features_detected: boolean;
  updated_at: Date;
}
const Payload = z.strictObject({
  version: z.literal(1),
  input: LegacyPersonaImport,
  targetBaseline: z.record(z.string(), z.json()),
  patch: z.record(z.string(), z.json()),
});
const aad = (userId: string, id: string, version: number) =>
  `characters:legacy-persona:${userId}:${id}:${version}`;
export interface LegacyPersonaImportOptions {
  additionalPreservedOwnerDigests?: readonly string[];
}

@Injectable()
export class LegacyPersonaService {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
  ) {}
  private async requireActive(userId: string, tx?: DbTx) {
    if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
      throw new AppError('unauthenticated', '账号已失效');
  }
  private async lock(tx: DbTx, userId: string) {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('characters:legacy-persona:user:'||$1,0))",
      [userId],
    );
    await this.requireActive(userId, tx);
  }
  private async target(userId: string, characterId: string, tx?: DbTx): Promise<Target> {
    const row = (
      await (tx ?? this.database).query<Target>(
        `SELECT id,owner_id,kind,status,name,legacy_card,revision,persona_version,
      basis,real_person_kind,age_setting,child_appearance,eligibility_override FROM characters.characters WHERE id=$1${tx ? ' FOR SHARE' : ''}`,
        [characterId],
      )
    ).rows[0];
    if (
      !row ||
      (row.kind === 'custom'
        ? row.owner_id !== userId
        : !['published', 'unpublished'].includes(row.status))
    )
      throw new AppError('not_found', '找不到角色');
    return row;
  }
  private async stored(userId: string, characterId: string, tx?: DbTx) {
    return (
      await (tx ?? this.database).query<Stored>(
        'SELECT * FROM characters.legacy_persona_overrides WHERE user_id=$1 AND character_id=$2',
        [userId, characterId],
      )
    ).rows[0];
  }
  async targetSnapshot(userId: string, characterId: string, tx?: DbTx) {
    await this.requireActive(userId, tx);
    const target = await this.target(userId, characterId, tx),
      stored = await this.stored(userId, characterId, tx);
    const supplement = (
      await (tx ?? this.database).query<{ text_ciphertext: Buffer; updated_at: Date }>(
        'SELECT text_ciphertext,updated_at FROM characters.user_supplements WHERE user_id=$1 AND character_id=$2',
        [userId, characterId],
      )
    ).rows[0];
    // Public releases are not personal conflicts. A custom character's revision is personal.
    const fingerprint = personaDigest({
      characterId,
      ownerId: target.owner_id,
      kind: target.kind,
      sourceId: target.legacy_card?.id ?? null,
      customRevision: target.kind === 'custom' ? target.revision : null,
      personal: stored
        ? { version: stored.version, state: stored.state, sourceDigest: stored.source_digest }
        : null,
      supplement: supplement ?? null,
    });
    return { target, stored, supplement: !!supplement, digest: fingerprint };
  }
  private async contextRows(characterId: string, tx?: DbTx) {
    const reader = tx ?? this.database;
    const lore = await reader.query<{ payload: JsonObject }>(
      'SELECT payload FROM characters.legacy_lorebook_entries WHERE character_id=$1 ORDER BY id',
      [characterId],
    );
    const examples = await reader.query<{ payload: JsonObject }>(
      'SELECT payload FROM characters.legacy_example_dialogues WHERE character_id=$1 ORDER BY sort_order,id',
      [characterId],
    );
    return {
      lore: lore.rows.map((row) => row.payload),
      examples: examples.rows.map((row) => row.payload),
    };
  }
  private facts(target: Target) {
    const manual = target.eligibility_override;
    return manual
      ? {
          basis: manual.basis,
          realPersonKind: manual.realPersonKind,
          ageSetting: manual.ageSetting,
          childAppearance: manual.childAppearance,
        }
      : {
          basis: target.basis,
          realPersonKind: target.real_person_kind,
          ageSetting: target.age_setting,
          childAppearance: target.child_appearance,
        };
  }
  private inspect(input: LegacyPersonaImport, target: Target, hasSupplement: boolean) {
    let reason: LegacyPersonaBlockedReason | null = null,
      patch: JsonObject = {};
    if (!input.evidence.sourceVerified) reason = 'source_unverified';
    else if (!input.evidence.targetLifecycleReviewed || hasSupplement)
      reason = 'target_personal_changes';
    else if (
      !input.evidence.classificationReviewed ||
      !input.reviewedClassification ||
      personaDigest(input.reviewedClassification) !== personaDigest(this.facts(target))
    )
      reason = 'classification_unverified';
    if (!target.legacy_card) reason ??= 'character_unavailable';
    try {
      if (Buffer.byteLength(input.source.patchJson, 'utf8') > 524_288)
        throw new Error('PATCH_TOO_LARGE');
      const parsed: unknown = JSON.parse(input.source.patchJson);
      assertSafePersonaJson(parsed);
      if (!isObject(parsed)) throw new Error('PATCH_NOT_OBJECT');
      patch = parsed;
      reason ??= personaPatchReason(patch);
    } catch {
      reason ??= 'unsupported_structure';
    }
    if (!input.base) reason ??= 'base_missing';
    else if (
      !input.evidence.baseVersionVerified ||
      !/^[a-f0-9]{64}$/.test(input.source.baseSignature) ||
      input.base.personaName !== input.source.personaName ||
      input.base.signature !== input.source.baseSignature ||
      input.base.revision !== input.source.baseRevision ||
      bytesDigest(input.base.packageJson) !== input.base.packageSha256
    )
      reason ??= 'base_mismatch';
    else {
      try {
        const base: unknown = JSON.parse(input.base.packageJson);
        assertSafePersonaJson(base);
        if (
          !isObject(base) ||
          typeof base.id !== 'string' ||
          !base.id ||
          typeof target.legacy_card?.id !== 'string' ||
          base.id !== target.legacy_card.id ||
          (base.display_name ?? base.name) !== input.source.personaName
        )
          reason ??= 'identity_mapping_unverified';
        else editablePersonaDocument(base); // Proves the exact historical structural format, never guess a recent base.
      } catch {
        reason ??= 'base_mismatch';
      }
    }
    return { reason, patch };
  }
  /** No public import API. The trusted adapter still must validate target + stopped writers. */
  async importBatch(
    userId: string,
    values: readonly unknown[],
    options: LegacyPersonaImportOptions = {},
  ) {
    assertLegacyMigrationOwnerAllowed(userId, options.additionalPreservedOwnerDigests);
    if (!Array.isArray(values) || values.length < 1 || values.length > 40)
      throw new AppError('bad_request', '旧人设批次格式不正确');
    const items = values.map((value) => {
      const result = LegacyPersonaImport.safeParse(value);
      if (!result.success) throw new AppError('bad_request', '旧人设来源格式不正确');
      const input = result.data;
      assertLegacyMigrationOwnerAllowed(
        input.sourceAccountId,
        options.additionalPreservedOwnerDigests,
      );
      if (input.sourceAccountId !== userId || !input.evidence.identityMappingVerified)
        throw new AppError('forbidden', '旧人设来源归属未核实');
      if (Date.parse(input.source.updatedAt) > Date.parse(input.cutoff))
        throw new AppError('bad_request', '旧人设超过冻结截止点');
      return input;
    });
    return this.database.transaction(async (tx) => {
      await this.lock(tx, userId);
      const outcome = { inserted: 0, existing: 0, active: 0, blocked: 0, reset: 0 };
      for (const input of items) {
        const sourceKey = personaDigest({
          sourceAccountId: input.sourceAccountId,
          personaName: input.source.personaName,
        });
        const sourceDigest = personaDigest({ source: input.source, base: input.base });
        const old = (
          await tx.query<{ source_digest: string; character_id: string }>(
            'SELECT source_digest,character_id FROM characters.legacy_persona_sources WHERE user_id=$1 AND source_key=$2 AND source_version=$3',
            [userId, sourceKey, input.source.version],
          )
        ).rows[0];
        if (old) {
          if (old.source_digest !== sourceDigest || old.character_id !== input.characterId)
            throw new AppError('conflict', '旧人设同一来源版本已变化');
          outcome.existing++;
          continue;
        }
        const mapped = (
          await tx.query<{ character_id: string }>(
            'SELECT character_id FROM characters.legacy_persona_overrides WHERE user_id=$1 AND source_key=$2',
            [userId, sourceKey],
          )
        ).rows[0];
        if (mapped && mapped.character_id !== input.characterId)
          throw new AppError('conflict', '旧人设来源映射不能改变');
        const current = await this.targetSnapshot(userId, input.characterId, tx);
        if (current.digest !== input.expectedTargetDigest || current.stored)
          throw new AppError('conflict', '本人设定已变化，不能覆盖');
        const publicRows = await this.contextRows(input.characterId, tx);
        const inspected = this.inspect(input, current.target, current.supplement);
        let reason = inspected.reason,
          child = false;
        if (input.source.state === 'customized' && !reason) {
          try {
            const projected = projectPersonalPersona(
              current.target.legacy_card!,
              targetPersonaPackage(
                current.target.legacy_card!,
                publicRows.lore,
                publicRows.examples,
              ),
              inspected.patch,
              sourceKey,
            );
            child = personaChildFeatures(projected.effectiveDocument);
          } catch {
            reason = 'unsupported_structure';
          }
        }
        const state = input.source.state === 'reset' ? 'reset' : reason ? 'blocked' : 'active';
        const now = this.clock.now(),
          version = 1;
        const ciphertext =
          state === 'reset'
            ? null
            : await this.crypto.seal(
                userId,
                aad(userId, input.characterId, version),
                JSON.stringify({
                  version: 1,
                  input,
                  patch: inspected.patch,
                  targetBaseline: {
                    legacyCard: current.target.legacy_card,
                    publicLorebook: publicRows.lore,
                    publicExamples: publicRows.examples,
                    personalDigest: current.digest,
                  },
                }),
                tx,
              );
        await tx.query(
          `INSERT INTO characters.legacy_persona_overrides(user_id,character_id,version,state,source_key,source_version,source_digest,source_updated_at,ciphertext,blocked_reason,child_features_detected,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            userId,
            input.characterId,
            version,
            state,
            sourceKey,
            input.source.version,
            sourceDigest,
            input.source.updatedAt,
            ciphertext,
            state === 'blocked' ? reason : null,
            child,
            now,
          ],
        );
        await tx.query(
          `INSERT INTO characters.legacy_persona_sources(user_id,character_id,source_key,source_version,source_digest,result_version,imported_at)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [userId, input.characterId, sourceKey, input.source.version, sourceDigest, version, now],
        );
        if (child)
          await tx.query(
            'INSERT INTO characters.user_child_feature_flags(user_id,character_id,detected_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [userId, input.characterId, now],
          );
        await this.changed(tx, userId, input.characterId);
        outcome.inserted++;
        outcome[state]++;
      }
      return outcome;
    });
  }
  private async open(row: Stored) {
    if (!row.ciphertext) return null;
    const buffer = await this.crypto.open(
      row.user_id,
      aad(row.user_id, row.character_id, row.version),
      row.ciphertext,
    );
    try {
      return Payload.parse(JSON.parse(buffer.toString('utf8')));
    } finally {
      buffer.fill(0);
    }
  }
  async runtime(userId: string, characterId: string, publicRow: JsonObject) {
    const row = await this.stored(userId, characterId);
    if (!row) return null;
    await this.requireActive(userId);
    const base = {
      version: row.version,
      childFeaturesDetected: row.child_features_detected,
      active: false as boolean,
      legacyCard: publicRow,
      context: undefined as LegacyRuntimeContext | undefined,
    };
    if (row.state !== 'active') return base;
    const payload = await this.open(row);
    if (!payload) return base;
    if (
      !publicRow.id ||
      String(publicRow.id) !==
        String(
          payload.targetBaseline.legacyCard && isObject(payload.targetBaseline.legacyCard)
            ? payload.targetBaseline.legacyCard.id
            : '',
        )
    )
      return base;
    const rows = await this.contextRows(characterId);
    try {
      const projected = projectPersonalPersona(
        publicRow,
        targetPersonaPackage(publicRow, rows.lore, rows.examples),
        payload.patch,
        row.source_key!,
      );
      const rawPatch = isObject(payload.patch.raw_persona) ? payload.patch.raw_persona : {};
      const context = {
        lorebook: Object.hasOwn(rawPatch, 'lorebook')
          ? projected.context.lorebook
          : legacyKnowledgeEntries(rows.lore),
        examples:
          Object.hasOwn(rawPatch, 'examples') || Object.hasOwn(rawPatch, 'example_dialogues')
            ? projected.context.examples
            : legacyDialogueExamples(rows.examples),
      };
      const latest = await this.stored(userId, characterId);
      if (latest?.version !== row.version || latest.state !== 'active') return base;
      return { ...base, active: true, legacyCard: projected.legacyCard, context };
    } catch {
      return base;
    }
  }
  private summary(row: Stored, target: Target) {
    return LegacyPersonaSummary.parse({
      characterId: row.character_id,
      characterName: target.name,
      state: row.state,
      version: row.version,
      sourceVersion: row.source_version,
      sourceUpdatedAt: row.source_updated_at?.toISOString() ?? null,
      updatedAt: row.updated_at.toISOString(),
      blockedReason: row.blocked_reason,
    });
  }
  async list(userId: string) {
    await this.requireActive(userId);
    const rows = (
      await this.database.query<Stored>(
        'SELECT * FROM characters.legacy_persona_overrides WHERE user_id=$1 ORDER BY updated_at DESC,character_id LIMIT 2000',
        [userId],
      )
    ).rows;
    const items: LegacyPersonaSummary[] = [];
    for (const row of rows) {
      try {
        const item = (await this.get(userId, row.character_id)).item;
        if (item) items.push(LegacyPersonaSummary.parse(item));
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'not_found')) throw error;
      }
    }
    return { items };
  }
  async get(userId: string, characterId: string): Promise<{ item: LegacyPersonaDetail | null }> {
    await this.requireActive(userId);
    const target = await this.target(userId, characterId),
      row = await this.stored(userId, characterId);
    if (!row) return { item: null };
    let sections: LegacyPersonaDetail['sections'] = [],
      reason = row.blocked_reason,
      state = row.state;
    if (row.state !== 'reset' && target.legacy_card) {
      const payload = await this.open(row);
      if (
        payload &&
        state === 'active' &&
        (!isObject(payload.targetBaseline.legacyCard) ||
          payload.targetBaseline.legacyCard.id !== target.legacy_card.id)
      ) {
        state = 'blocked';
        reason = 'identity_mapping_unverified';
      }
      if (payload && !personaPatchReason(payload.patch)) {
        try {
          const rows = await this.contextRows(characterId);
          sections = projectPersonalPersona(
            target.legacy_card,
            targetPersonaPackage(target.legacy_card, rows.lore, rows.examples),
            payload.patch,
            row.source_key!,
          ).sections;
        } catch {
          if (state === 'active') {
            state = 'blocked';
            reason = 'unsupported_structure';
          }
        }
      }
    } else if (state === 'active') {
      state = 'blocked';
      reason = 'character_unavailable';
    }
    return {
      item: LegacyPersonaDetail.parse({
        ...this.summary(row, target),
        state,
        blockedReason: reason,
        sections,
        resetAllowed: true,
        originalRetained: row.ciphertext !== null,
      }),
    };
  }
  async reset(userId: string, characterId: string, input: LegacyPersonaReset) {
    const result = LegacyPersonaReset.safeParse(input);
    if (!result.success) throw new AppError('bad_request', '还原人设请求不正确');
    const digest = personaDigest({ characterId, expectedVersion: input.expectedVersion });
    const replayed = await this.database.transaction(async (tx) => {
      await this.lock(tx, userId);
      await this.target(userId, characterId, tx);
      const command = (
        await tx.query<{ request_digest: string }>(
          'SELECT request_digest FROM characters.legacy_persona_commands WHERE user_id=$1 AND command_id=$2',
          [userId, input.clientCommandId],
        )
      ).rows[0];
      if (command) {
        if (command.request_digest !== digest)
          throw new AppError('conflict', '这次还原操作与已提交内容不一致');
        return true;
      }
      const row = await this.stored(userId, characterId, tx);
      if ((row?.version ?? 0) !== input.expectedVersion)
        throw new AppError('conflict', '本人设定已在另一处更新，请刷新后重试');
      const version = row?.state === 'reset' ? row.version : (row?.version ?? 0) + 1;
      await tx.query(
        `INSERT INTO characters.legacy_persona_overrides(user_id,character_id,version,state,ciphertext,blocked_reason,updated_at)
        VALUES($1,$2,$3,'reset',NULL,NULL,$4) ON CONFLICT(user_id,character_id) DO UPDATE SET version=EXCLUDED.version,state='reset',ciphertext=NULL,blocked_reason=NULL,updated_at=EXCLUDED.updated_at`,
        [userId, characterId, version, this.clock.now()],
      );
      await tx.query(
        'INSERT INTO characters.legacy_persona_commands(user_id,command_id,character_id,request_digest,result_version,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [userId, input.clientCommandId, characterId, digest, version, this.clock.now()],
      );
      await this.changed(tx, userId, characterId);
      return false;
    });
    return { item: (await this.get(userId, characterId)).item!, replayed };
  }
  private changed(tx: DbTx, userId: string, characterId: string) {
    return this.sync.appendUpdate(tx, userId, {
      type: 'data.changed',
      data: { section: 'supplement', characterId, itemId: null },
    });
  }
  async purgeUser(userId: string): Promise<number> {
    return this.database.transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('characters:legacy-persona:user:'||$1,0))",
        [userId],
      );
      let count = 0;
      for (const table of [
        'legacy_persona_commands',
        'legacy_persona_sources',
        'legacy_persona_overrides',
      ])
        count +=
          (await tx.query(`DELETE FROM characters.${table} WHERE user_id=$1`, [userId])).rowCount ??
          0;
      return count;
    });
  }
  async countUserData(userId: string): Promise<number> {
    let total = 0;
    for (const table of [
      'legacy_persona_commands',
      'legacy_persona_sources',
      'legacy_persona_overrides',
    ])
      total += Number(
        (
          await this.database.query(
            `SELECT count(*) AS n FROM characters.${table} WHERE user_id=$1`,
            [userId],
          )
        ).rows[0]?.n ?? 0,
      );
    return total;
  }
}
