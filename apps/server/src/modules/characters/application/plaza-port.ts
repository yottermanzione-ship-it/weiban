/**
 * characters 配合人设广场（契约 CharacterPlazaPort，T-088；persona-plaza.md 第 4、5 节，hard-boundaries.md 第 6 节）。
 *
 * - 白名单快照：只读 PLZ-02 第 3 条列出的字段，按契约严格 schema 校验后返回；聊天、记忆、通讯录、growth、health 一概不读。
 *   everPrivatePerson（只增）或当前为「基于身边真人」→ forbidden（PLZ-02 第 11 条）；真人分类头像强制为空。
 * - 按快照创建：新建自定义角色 origin = plaza_copy，分类事实全部从快照（预设改版：该预设角色当前分类）写入，客户端无从影响；
 *   之后只能更严（应用层用 policy.compareClassification，数据库触发器 guard_classification 兜底）。幂等键 = plaza 的 adoptionId。
 * - 按新版本更新 / 管理员更正：分类只取更严的一边；分类变化照常发 characters.character_classification_changed，
 *   ai-runtime 收到后立即退出成人模式并提示（SAFE-03 第 5 条）。
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import {
  CharacterCard,
  CharacterSummary,
  CustomCharacterOrigin,
  type CharacterProfile,
  type PlazaOfficialPersona,
  PlazaCustomCharacterSnapshot,
  type AdminCharacterWrite,
  PlazaPresetVariantSnapshot,
  type CharacterClassificationInput,
  type CharacterPlazaPort,
  type IdentityAccountStatusPort,
  type CharacterChildFeaturesWritePort,
  type PlazaSnapshot,
  type PlazaSnapshotClassification,
  type PortResult,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  EVENT_BUS,
  newId,
  type EventBus,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { compareClassification } from '../../policy/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import {
  catchphrasesOf,
  presetPersonaFields,
  stripPresetCard,
  type CustomCharacterPayload,
} from '../domain/custom-card.js';
import { characters, userSupplements } from '../infra/db/schema.js';
import { CHARACTER_PLAZA_ORIGIN_STATUS, type CharacterPlazaOriginStatus } from '../tokens.js';
import { CharacterService } from './characters.js';
import { CharacterSupplementService } from './supplements.js';

type Row = typeof characters.$inferSelect;
type CustomSnapshot = Extract<PlazaSnapshot, { kind: 'custom_character' }>;
type VariantSnapshot = Extract<PlazaSnapshot, { kind: 'preset_variant' }>;
type Basis = 'real_person' | 'fictional' | 'original';
type RealKind = 'celebrity' | 'historical' | 'private_person' | null;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const DELETED_AUTHOR = '已注销用户';

function rowClassification(row: Row): PlazaSnapshotClassification {
  return {
    basis: row.basis as Basis,
    realPersonKind: row.basis === 'real_person' ? (row.realPersonKind as RealKind) : null,
    ageSetting: row.ageSetting as 'minor' | 'adult',
    childAppearance: row.childAppearance,
    childFeaturesDetected: row.childFeaturesDetected,
    everPrivatePerson: row.everPrivatePerson,
  };
}

/** 逐项取两组分类中更严的一边（真人优先、未满 18 岁优先、布尔标记取或）。 */
function stricterOf(
  a: PlazaSnapshotClassification,
  b: PlazaSnapshotClassification,
): PlazaSnapshotClassification {
  const basis: Basis =
    a.basis === 'real_person' || b.basis === 'real_person' ? 'real_person' : a.basis;
  const realPersonKind: RealKind =
    basis === 'real_person'
      ? a.basis === 'real_person'
        ? a.realPersonKind
        : b.realPersonKind
      : null;
  return {
    basis,
    realPersonKind,
    ageSetting: a.ageSetting === 'minor' || b.ageSetting === 'minor' ? 'minor' : 'adult',
    childAppearance: a.childAppearance || b.childAppearance,
    childFeaturesDetected: a.childFeaturesDetected || b.childFeaturesDetected,
    everPrivatePerson:
      a.everPrivatePerson || b.everPrivatePerson || realPersonKind === 'private_person',
  };
}

const sameClassification = (a: PlazaSnapshotClassification, b: PlazaSnapshotClassification) =>
  a.basis === b.basis &&
  a.realPersonKind === b.realPersonKind &&
  a.ageSetting === b.ageSetting &&
  a.childAppearance === b.childAppearance &&
  a.childFeaturesDetected === b.childFeaturesDetected &&
  a.everPrivatePerson === b.everPrivatePerson;

@Injectable()
export class CharacterPlazaService
  implements CharacterPlazaPort, CharacterChildFeaturesWritePort, OnModuleInit
{
  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CharacterService) private readonly characters: CharacterService,
    @Inject(CharacterSupplementService) private readonly supplements: CharacterSupplementService,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Optional()
    @Inject(CHARACTER_PLAZA_ORIGIN_STATUS)
    private readonly originStatus?: CharacterPlazaOriginStatus,
  ) {}

  /**
   * 3.1（T-080 遗留 2，ADR-0024 补记第 4 条）：作者注销（plaza.work_removed reason = author_deleted）时，
   * 清掉来源为该作品的复制品 / 改版补充设定里保存的作者旧广场昵称；来源标注仍显示「已注销用户」。
   */
  onModuleInit(): void {
    this.bus.subscribe({
      consumer: 'characters.on_plaza_work_removed',
      eventType: 'plaza.work_removed',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.reason !== 'author_deleted') return;
        const db = tx.db;
        await db
          .update(characters)
          .set({ plazaAuthorName: null })
          .where(eq(characters.plazaWorkId, p.workId));
        await db
          .update(userSupplements)
          .set({
            plazaSource: sql`jsonb_set(${userSupplements.plazaSource}, '{authorName}', '""'::jsonb)`,
          })
          .where(sql`${userSupplements.plazaSource}->>'workId' = ${p.workId}`);
      },
    });
  }

  // ---------- 读取 ----------

  private async ownCustom(userId: string, characterId: string): Promise<Row | null> {
    const [row] = await this.db.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.ownerId, userId),
          eq(characters.kind, 'custom'),
          eq(characters.isTrial, false),
        ),
      );
    return row ?? null;
  }

  private async payload(row: Row, tx?: DbTx): Promise<CustomCharacterPayload> {
    const plain = await this.crypto.open(
      row.ownerId!,
      `character:${row.id}:draft:${row.revision}`,
      row.draftCiphertext,
      tx,
    );
    try {
      return JSON.parse(plain.toString('utf8')) as CustomCharacterPayload;
    } finally {
      plain.fill(0);
    }
  }

  // ---------- 快照 ----------

  async buildPublishSnapshot(
    userId: string,
    characterId: string,
  ): Promise<PortResult<CustomSnapshot, 'not_found' | 'forbidden'>> {
    const row = await this.ownCustom(userId, characterId);
    if (!row) return { ok: false, error: 'not_found' };
    if (row.everPrivatePerson || row.realPersonKind === 'private_person')
      return { ok: false, error: 'forbidden', message: '以身边的人为原型的角色不能发布' };
    const p = await this.payload(row);
    const classification = rowClassification(row);
    const birthday = p.birthday && /^\d{4}-\d{2}-\d{2}$/.test(p.birthday) ? p.birthday : null;
    // 白名单：只有下面这些字段（PLZ-02 第 3 条），多一个字段严格 schema 即失败。
    const candidate = {
      kind: 'custom_character' as const,
      name: clip(row.name, 32),
      classification,
      description: clip(p.description.trim() || row.name, 2000),
      speechStyle: clip(p.speechStyle ?? '', 1000),
      catchphrases: catchphrasesOf(p)
        .slice(0, 20)
        .map((c) => clip(c, 50)),
      exampleDialogue: clip(p.exampleDialogue ?? '', 2000),
      tags: p.tags.slice(0, 10).map((t) => clip(t, 16)),
      birthday,
      voiceName: p.voiceName ? clip(p.voiceName, 20) : null,
      // 真人分类不带用户上传的头像（hard-boundaries.md 第 6 节第 8 条）。
      avatarMediaId: classification.basis === 'real_person' ? null : p.avatarMediaId,
    };
    const parsed = PlazaCustomCharacterSnapshot.safeParse(candidate);
    if (!parsed.success) throw new AppError('internal_error', '角色内容无法生成发布快照');
    return { ok: true, value: parsed.data };
  }

  async buildVariantSnapshot(
    userId: string,
    presetCharacterId: string,
  ): Promise<PortResult<VariantSnapshot, 'not_found'>> {
    const text = (await this.supplements.getSupplement(userId, presetCharacterId))?.trim();
    if (!text) return { ok: false, error: 'not_found' };
    const parsed = PlazaPresetVariantSnapshot.safeParse({
      kind: 'preset_variant',
      presetCharacterId,
      variantText: clip(text, 5000),
    });
    if (!parsed.success) return { ok: false, error: 'not_found' };
    return { ok: true, value: parsed.data };
  }

  // ---------- 按快照创建 ----------

  async createFromSnapshot(input: {
    userId: string;
    snapshot: PlazaSnapshot;
    origin: { workId: string; version: number; authorName: string };
    idempotencyKey: string;
  }): Promise<PortResult<{ characterId: string }, 'preset_not_found'>> {
    const { userId, snapshot, origin, idempotencyKey } = input;
    const existing = await this.byIdempotencyKey(userId, idempotencyKey);
    if (existing) return { ok: true, value: { characterId: existing.id } };

    let payload: CustomCharacterPayload;
    let classification: PlazaSnapshotClassification;
    if (snapshot.kind === 'custom_character') {
      classification = snapshot.classification;
      payload = this.payloadFromCustomSnapshot(snapshot, null);
    } else {
      const preset = await this.characters.presetForCopy(snapshot.presetCharacterId);
      if (!preset) return { ok: false, error: 'preset_not_found' };
      classification = {
        basis: preset.classification.basis,
        realPersonKind: preset.classification.realPersonKind,
        ageSetting: preset.classification.ageSetting,
        childAppearance: preset.classification.childAppearance,
        // 3.1（积压 ㉝）：快照里检出的儿童特征与预设分类取更严的一边，只写在这份复制品上。
        childFeaturesDetected:
          preset.classification.childFeaturesDetected || snapshot.childFeaturesDetected === true,
        everPrivatePerson: preset.row.everPrivatePerson,
      };
      payload = this.payloadFromPreset(preset.body, snapshot);
    }
    payload.classification = {
      basis: classification.basis,
      realPersonKind: classification.realPersonKind,
      ageSetting: classification.ageSetting,
      childAppearance: classification.childAppearance,
    };

    const id = newId();
    const now = this.clock.now();
    const created = await this.db.transaction(async (tx) => {
      if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
        throw new AppError('unauthenticated', '账号已失效');
      const sealed = await this.crypto.seal(
        userId,
        `character:${id}:draft:1`,
        JSON.stringify(payload),
        tx,
      );
      const inserted = await tx.db
        .insert(characters)
        .values({
          id,
          kind: 'custom',
          ownerId: userId,
          status: 'active',
          name: payload.name,
          searchText: payload.name,
          categoryId: null,
          basis: classification.basis,
          realPersonKind: classification.realPersonKind,
          ageSetting: classification.ageSetting,
          childAppearance: classification.childAppearance,
          childFeaturesDetected: classification.childFeaturesDetected,
          everPrivatePerson: classification.everPrivatePerson,
          draftCiphertext: sealed,
          checks: {
            revision: 1,
            requiredFieldsComplete: true,
            hasFallbackGreeting: true,
            personaStabilityPassed: false,
            hardBoundaryCasesPassed: false,
            checked: false,
          },
          originKind: 'plaza_copy',
          plazaWorkId: origin.workId,
          plazaVersion: origin.version,
          plazaAuthorName: clip(origin.authorName, 12),
          plazaIdempotencyKey: idempotencyKey,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: characters.id });
      if (!inserted.length) return null;
      await this.audit.record(
        {
          module: 'characters',
          action: 'custom.plaza_copied',
          actorType: 'user',
          actorId: userId,
          targetType: 'character',
          targetId: id,
          details: { workId: origin.workId, version: origin.version, kind: snapshot.kind },
        },
        tx,
      );
      return id;
    });
    if (created) return { ok: true, value: { characterId: created } };
    const again = await this.byIdempotencyKey(userId, idempotencyKey);
    if (!again) throw new AppError('internal_error', '角色未能创建');
    return { ok: true, value: { characterId: again.id } };
  }

  private async byIdempotencyKey(userId: string, key: string): Promise<Row | null> {
    const [row] = await this.db.db
      .select()
      .from(characters)
      .where(and(eq(characters.ownerId, userId), eq(characters.plazaIdempotencyKey, key)));
    return row ?? null;
  }

  private payloadFromCustomSnapshot(
    s: CustomSnapshot,
    previous: CustomCharacterPayload | null,
  ): CustomCharacterPayload {
    return {
      ...(previous ?? {}),
      name: s.name,
      description: s.description,
      classification: {
        basis: s.classification.basis,
        realPersonKind: s.classification.realPersonKind,
        ageSetting: s.classification.ageSetting,
        childAppearance: s.classification.childAppearance,
      },
      birthday: s.birthday,
      catchphrase: s.catchphrases[0] ?? null,
      catchphrases: s.catchphrases,
      exampleDialogue: s.exampleDialogue || null,
      tags: s.tags,
      avatarMediaId: s.avatarMediaId,
      speechStyle: s.speechStyle || null,
      voiceName: s.voiceName,
      variantText: null,
      basedOnPresetId: null,
      presetCard: null,
    };
  }

  /** PLZ-04 第 1 条：复制预设角色当前人设版本的人设描述、说话方式、口头禅、示例对话、标签、生日，再加改版设定。 */
  private payloadFromPreset(body: AdminCharacterWrite, s: VariantSnapshot): CustomCharacterPayload {
    const parsedCard = CharacterCard.safeParse(body.card);
    const card = parsedCard.success ? parsedCard.data : null;
    const fields = card
      ? presetPersonaFields(card)
      : {
          description: body.intro || body.name,
          speechStyle: '',
          catchphrases: [],
          exampleDialogue: '',
        };
    return {
      name: body.name,
      description: fields.description || body.name,
      classification: { ...body.classification },
      birthday: body.birthday,
      catchphrase: fields.catchphrases[0] ?? null,
      catchphrases: fields.catchphrases,
      exampleDialogue: fields.exampleDialogue || null,
      tags: body.tags.slice(0, 10),
      avatarMediaId: null,
      speechStyle: fields.speechStyle || null,
      voiceName: null,
      variantText: s.variantText,
      basedOnPresetId: s.presetCharacterId,
      presetCard: card ? stripPresetCard(card) : null,
    };
  }

  // ---------- 应用改版 ----------

  async applyVariant(input: {
    userId: string;
    presetCharacterId: string;
    variantText: string;
    origin: { workId: string; version: number; authorName: string };
    idempotencyKey: string;
    /**
     * 3.1（积压 ㉝）：改版快照的 childFeaturesDetected（CharacterPlazaPort 可选字段）。与预设分类取更严的一边，
     * 记在这位用户的永久标记上（迁移 0083，只增不减），不写回预设角色。
     */
    childFeaturesDetected?: boolean;
  }): Promise<PortResult<void, 'not_found'>> {
    const presetClassification = await this.characters
      .getClassification(input.presetCharacterId)
      .catch(() => null);
    const childFeaturesDetected =
      input.childFeaturesDetected === true || presetClassification?.childFeaturesDetected === true;
    const ok = await this.supplements.putFromPlaza(
      input.userId,
      input.presetCharacterId,
      input.variantText,
      {
        workId: input.origin.workId,
        version: input.origin.version,
        authorName: clip(input.origin.authorName, 12),
        childFeaturesDetected,
      },
      // B7 遗留：标记第一次写入 → 按这位用户发分类变化事件，ai-runtime 立即把成人模式切回日常并提示。
      (tx) =>
        this.characters.userChildClassificationEvent(tx, input.presetCharacterId, input.userId),
    );
    return ok ? { ok: true, value: undefined } : { ok: false, error: 'not_found' };
  }

  // ---------- 按新版本更新 ----------

  async updateFromSnapshot(input: {
    userId: string;
    characterId: string;
    snapshot: PlazaSnapshot;
    version: number;
  }): Promise<PortResult<void, 'not_found' | 'classification_loosened'>> {
    const row = await this.ownCustom(input.userId, input.characterId);
    if (!row || row.originKind !== 'plaza_copy') return { ok: false, error: 'not_found' };
    const previous = await this.payload(row);
    const current = rowClassification(row);
    let next: CustomCharacterPayload;
    let classification = current;
    if (input.snapshot.kind === 'custom_character') {
      // 分类：新版本更严按新版本执行，否则保留现在的（取更严的一边，永不放宽）。
      classification = stricterOf(current, input.snapshot.classification);
      next = this.payloadFromCustomSnapshot(input.snapshot, previous);
    } else {
      next = { ...previous, variantText: input.snapshot.variantText };
    }
    if (compareClassification(current, classification) === 'looser')
      return { ok: false, error: 'classification_loosened' };
    next.classification = {
      basis: classification.basis,
      realPersonKind: classification.realPersonKind,
      ageSetting: classification.ageSetting,
      childAppearance: classification.childAppearance,
    };
    await this.writeRow(row, next, classification, {
      plazaVersion: input.version,
      audit: {
        actorType: 'user',
        actorId: input.userId,
        action: 'custom.plaza_updated',
        details: { version: input.version },
      },
    });
    return { ok: true, value: undefined };
  }

  // ---------- T-089：发布前儿童特征重检写回（hard-boundaries.md 第 6 节第 4 条） ----------

  /**
   * 系统写入 childFeaturesDetected = true（只能从否变是）。只改作者本人的自定义角色；
   * 已是「是」或角色不存在时什么也不做。分类变化照常发 characters.character_classification_changed（ai-runtime 退出成人模式）。
   */
  async markChildFeaturesDetected(userId: string, characterId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx.db
        .update(characters)
        .set({ childFeaturesDetected: true, updatedAt: this.clock.now() })
        .where(
          and(
            eq(characters.id, characterId),
            eq(characters.ownerId, userId),
            eq(characters.kind, 'custom'),
            eq(characters.childFeaturesDetected, false),
          ),
        )
        .returning();
      if (!updated) return false;
      await this.characters.classificationEvent(tx, updated);
      await this.audit.record(
        {
          module: 'characters',
          action: 'custom.child_features_detected',
          actorType: 'system',
          actorId: null,
          targetType: 'character',
          targetId: characterId,
          details: { source: 'plaza_publish_check' },
        },
        tx,
      );
      return true;
    });
  }

  // ---------- 管理员更正 ----------

  async tightenClassification(
    characterId: string,
    classification: CharacterClassificationInput,
    reason: string,
  ): Promise<PortResult<void, 'not_found' | 'classification_loosened'>> {
    const [row] = await this.db.db
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.kind, 'custom')));
    if (!row) return { ok: false, error: 'not_found' };
    const current = rowClassification(row);
    const target: PlazaSnapshotClassification = {
      basis: classification.basis,
      realPersonKind: classification.basis === 'real_person' ? classification.realPersonKind : null,
      ageSetting: classification.ageSetting,
      childAppearance: classification.childAppearance,
      childFeaturesDetected: current.childFeaturesDetected,
      everPrivatePerson:
        current.everPrivatePerson || classification.realPersonKind === 'private_person',
    };
    if (compareClassification(current, target) === 'looser')
      return { ok: false, error: 'classification_loosened' };
    if (sameClassification(current, target)) return { ok: true, value: undefined };
    const payload = await this.payload(row);
    payload.classification = {
      basis: target.basis,
      realPersonKind: target.realPersonKind,
      ageSetting: target.ageSetting,
      childAppearance: target.childAppearance,
    };
    if (target.basis === 'real_person') payload.avatarMediaId = null;
    await this.writeRow(row, payload, target, {
      audit: {
        actorType: 'admin',
        actorId: null,
        action: 'custom.classification_tightened',
        details: { reason, from: current, to: target },
      },
    });
    return { ok: true, value: undefined };
  }

  private async writeRow(
    row: Row,
    payload: CustomCharacterPayload,
    classification: PlazaSnapshotClassification,
    opts: {
      plazaVersion?: number;
      audit: {
        actorType: 'user' | 'admin';
        actorId: string | null;
        action: string;
        details: Record<string, unknown>;
      };
    },
  ): Promise<void> {
    const revision = row.revision + 1;
    await this.db.transaction(async (tx) => {
      if ((await this.accounts.getAccountStatus(row.ownerId!, tx)) !== 'active')
        throw new AppError('unauthenticated', '账号已失效');
      const sealed = await this.crypto.seal(
        row.ownerId!,
        `character:${row.id}:draft:${revision}`,
        JSON.stringify(payload),
        tx,
      );
      const [updated] = await tx.db
        .update(characters)
        .set({
          name: payload.name,
          searchText: payload.name,
          basis: classification.basis,
          realPersonKind: classification.realPersonKind,
          ageSetting: classification.ageSetting,
          childAppearance: classification.childAppearance,
          childFeaturesDetected: classification.childFeaturesDetected,
          everPrivatePerson: classification.everPrivatePerson,
          draftCiphertext: sealed,
          revision,
          personaVersion: row.personaVersion + 1,
          ...(opts.plazaVersion !== undefined ? { plazaVersion: opts.plazaVersion } : {}),
          updatedAt: this.clock.now(),
        })
        .where(and(eq(characters.id, row.id), eq(characters.revision, row.revision)))
        .returning();
      if (!updated) throw new AppError('conflict', '角色刚被修改，请重试');
      if (!sameClassification(rowClassification(row), rowClassification(updated)))
        await this.characters.classificationEvent(tx, updated);
      await this.audit.record(
        {
          module: 'characters',
          action: opts.audit.action,
          actorType: opts.audit.actorType,
          actorId: opts.audit.actorId,
          targetType: 'character',
          targetId: row.id,
          details: opts.audit.details,
        },
        tx,
      );
    });
  }

  // ---------- 来源 ----------

  async getPlazaOrigin(characterId: string): Promise<{ workId: string; version: number } | null> {
    const [row] = await this.db.db.select().from(characters).where(eq(characters.id, characterId));
    if (!row || row.originKind !== 'plaza_copy' || !row.plazaWorkId || !row.plazaVersion)
      return null;
    return { workId: row.plazaWorkId, version: row.plazaVersion };
  }

  async getSnapshotClassification(
    characterId: string,
  ): Promise<PlazaSnapshotClassification | null> {
    const [row] = await this.db.db.select().from(characters).where(eq(characters.id, characterId));
    return row ? rowClassification(row) : null;
  }

  /** 契约 CustomCharacterOriginEndpoints.getOrigin：资料页「来自人设广场 · 作者 XX · 版本 N」。 */
  async getOrigin(
    userId: string,
    characterId: string,
  ): Promise<{ origin: z.infer<typeof CustomCharacterOrigin>; everPrivatePerson: boolean }> {
    const row = await this.ownCustom(userId, characterId);
    if (!row) throw new AppError('not_found', '角色不存在');
    if (row.originKind !== 'plaza_copy' || !row.plazaWorkId || !row.plazaVersion)
      return {
        origin: { kind: 'created', importJobId: row.originImportJobId },
        everPrivatePerson: row.everPrivatePerson,
      };
    const status = (await this.originStatus?.originStatus(userId, row.id, row.plazaWorkId)) ?? {
      workAvailable: true,
      authorDeleted: false,
      authorName: null,
      newerVersionAvailable: null,
    };
    return {
      origin: {
        kind: 'plaza_copy',
        workId: row.plazaWorkId,
        version: row.plazaVersion,
        authorName: status.authorDeleted
          ? DELETED_AUTHOR
          : clip(status.authorName ?? row.plazaAuthorName ?? '', 12),
        authorDeleted: status.authorDeleted,
        workAvailable: status.workAvailable,
        newerVersionAvailable: status.newerVersionAvailable,
      },
      everPrivatePerson: row.everPrivatePerson,
    };
  }

  // ---------- 3.5：角色广场「微伴角色」tab ----------

  async listOfficialIds(query: { q?: string; categoryId?: string }): Promise<string[]> {
    const filters: SQL[] = [eq(characters.kind, 'preset'), eq(characters.status, 'published')];
    if (query.categoryId) filters.push(eq(characters.categoryId, query.categoryId));
    if (query.q)
      filters.push(ilike(characters.searchText, `%${query.q.replace(/[\\%_]/g, '\\$&')}%`));
    const rows = await this.db.db
      .select({ id: characters.id })
      .from(characters)
      .where(and(...filters))
      .orderBy(asc(characters.id))
      .limit(1000);
    return rows.map((r) => r.id);
  }

  async getOfficialCards(userId: string, characterIds: string[]) {
    const profiles = await this.characters.getProfiles(userId, characterIds);
    const byId = new Map(
      profiles
        .filter((p) => p.kind === 'preset')
        .map((p) => [p.characterId, CharacterSummary.parse(p)] as const),
    );
    return characterIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  async getOfficialProfile(
    userId: string,
    characterId: string,
  ): Promise<{ profile: CharacterProfile; persona: PlazaOfficialPersona } | null> {
    const preset = await this.characters.presetForCopy(characterId);
    if (!preset) return null;
    const profile = await this.characters.getProfile(userId, characterId);
    const card = CharacterCard.safeParse(preset.body.card);
    const d = card.success ? card.data.data : null;
    // 只摘公开的几项并截断，不返回背景细节、示例对话、禁用词、熟悉度成长等完整提示词内容。
    return {
      profile,
      persona: {
        summary: clip(d?.persona.summary ?? profile.intro, 300),
        personality: clip(d?.persona.personality ?? '', 300),
        speechStyle: clip(d?.speech.tone ?? '', 200),
        catchphrases: (d?.speech.catchphrases ?? []).slice(0, 5).map((c) => clip(c, 50)),
      },
    };
  }
}
