/**
 * 自定义角色服务（T-047 CHR-07）。
 * 仅处理 kind='custom' 的角色，即用户手动创建的角色。
 * - 创建：保存描述到 draft_ciphertext（JSON），执行规则层儿童特征检测，写数据库。
 * - 更新：同创建，但遵守分类单向规则（数据库触发器 guard_classification 也会拦截）。
 * - 试聊：创建或复用一个不绑定 contacts 的临时会话（CHR-07 第 6 条）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt } from 'drizzle-orm';
import {
  type UserCustomCharacterWrite,
  type UserCustomCharacterPatch,
  type UserCustomCharacter,
  type ChatAdminPort,
  type IdentityAccountStatusPort,
  Id,
} from '@weiban/contracts';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  newId,
  parseContract,
  type AuditLog,
  type Clock,
  type Database,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { CHAT_ADMIN_PORT } from '../../chat/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import {
  deriveClassification,
  classificationCanChange,
  compareClassification,
} from '../../policy/index.js';
import { characters, trialSessions } from '../infra/db/schema.js';
import { childFeaturesIn } from '../domain/child-features.js';
import { catchphrasesOf, type CustomCharacterPayload } from '../domain/custom-card.js';
import { CharacterService } from './characters.js';

/** 自定义角色的 draft_ciphertext 中存储的明文 JSON 结构（定义见 domain/custom-card.ts）。 */

/**
 * 3.1（T-098）：口头禅列表规则。同时传 catchphrase 与 catchphrases 以列表为准；只传 catchphrase 时只替换第一条、保留其余。
 */
function mergeCatchphrases(
  current: string[],
  catchphrase: string | null | undefined,
  catchphrases: string[] | undefined,
): string[] {
  if (catchphrases !== undefined) return catchphrases;
  if (catchphrase === undefined) return current;
  if (!catchphrase) return current.slice(1);
  return [catchphrase, ...current.slice(1)];
}

function buildPayload(body: UserCustomCharacterWrite): CustomCharacterPayload {
  const phrases = mergeCatchphrases([], body.catchphrase, body.catchphrases);
  return {
    name: body.name,
    description: body.description,
    classification: {
      basis: body.classification.basis,
      realPersonKind: body.classification.realPersonKind,
      ageSetting: body.classification.ageSetting,
      childAppearance: body.classification.childAppearance,
    },
    birthday: body.birthday ?? null,
    catchphrase: phrases[0] ?? null,
    catchphrases: phrases,
    speechStyle: body.speechStyle?.trim() || null,
    exampleDialogue: body.exampleDialogue ?? null,
    tags: body.tags ?? [],
    avatarMediaId: body.avatarMediaId ?? null,
  };
}

function textsToCheck(payload: CustomCharacterPayload): string[] {
  return [
    payload.name,
    payload.description,
    payload.catchphrase ?? '',
    ...catchphrasesOf(payload),
    payload.speechStyle ?? '',
    payload.exampleDialogue ?? '',
  ].filter(Boolean);
}

@Injectable()
export class CustomCharacterService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CHAT_ADMIN_PORT) private readonly chatAdmin: ChatAdminPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(CharacterService) private readonly characterService: CharacterService,
  ) {}

  async create(
    userId: string,
    body: UserCustomCharacterWrite,
    trial?: {
      sourceCharacterId?: string;
      sourceRevision?: number;
      childFeaturesDetected?: boolean;
      reuse?: boolean;
    },
  ): Promise<UserCustomCharacter> {
    parseContract(Id, userId);
    const payload = buildPayload(body);
    await this.characterService.customAvatar(userId, payload.avatarMediaId);
    const detected =
      childFeaturesIn(textsToCheck(payload)) || trial?.childFeaturesDetected === true;

    const id = newId();
    let actualId = id;
    const now = this.clock.now();
    const sealed = await this.crypto.seal(
      userId,
      `character:${id}:draft:1`,
      JSON.stringify(payload),
    );

    await this.database.transaction(async (tx) => {
      if (trial) {
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))",
          [userId],
        );
        if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
          throw new AppError('unauthenticated', '账号已失效');
        if (trial.sourceCharacterId) {
          const [source] = await tx.db
            .select()
            .from(characters)
            .where(and(eq(characters.id, trial.sourceCharacterId), eq(characters.ownerId, userId)))
            .for('share');
          if (!source || source.revision !== trial.sourceRevision)
            throw new AppError('not_found', '角色版本已变化，请重新试聊');
          if (trial.reuse) {
            const [existing] = await tx.db
              .select()
              .from(trialSessions)
              .where(
                and(
                  eq(trialSessions.userId, userId),
                  eq(trialSessions.sourceCharacterId, source.id),
                  eq(trialSessions.sourceRevision, source.revision),
                  eq(trialSessions.reusable, true),
                  gt(trialSessions.expiresAt, this.clock.now()),
                ),
              );
            if (existing) {
              actualId = existing.characterId;
              return;
            }
          }
        }
      }
      await tx.db.insert(characters).values({
        id,
        kind: 'custom',
        ownerId: userId,
        isTrial: trial !== undefined,
        status: 'active',
        name: payload.name,
        searchText: payload.name,
        categoryId: null,
        basis: payload.classification.basis,
        realPersonKind: payload.classification.realPersonKind,
        ageSetting: payload.classification.ageSetting,
        childAppearance: payload.classification.childAppearance,
        childFeaturesDetected: detected,
        everPrivatePerson: payload.classification.realPersonKind === 'private_person',
        draftCiphertext: sealed,
        checks: {
          revision: 1,
          requiredFieldsComplete: true,
          hasFallbackGreeting: false,
          personaStabilityPassed: false,
          hardBoundaryCasesPassed: false,
          checked: false,
        },
        createdAt: now,
        updatedAt: now,
      });
      if (trial) {
        const conversation = await this.chatAdmin.ensureDirectConversation(tx, {
          userId,
          characterId: id,
          restoreHistory: false,
          trialExpiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
        });
        await tx.db.insert(trialSessions).values({
          conversationId: conversation.conversationId,
          characterId: id,
          userId,
          sourceCharacterId: trial.sourceCharacterId ?? null,
          sourceRevision: trial.sourceRevision ?? null,
          reusable: trial.reuse ?? false,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 30 * 60_000),
        });
      }
      await this.audit.record(
        {
          module: 'characters',
          action: trial ? 'custom.trial_created' : 'custom.created',
          actorType: 'user',
          actorId: userId,
          targetType: 'character',
          targetId: id,
        },
        tx,
      );
    });

    return this.get(userId, actualId);
  }

  async update(
    userId: string,
    characterId: string,
    patch: UserCustomCharacterPatch,
  ): Promise<UserCustomCharacter> {
    parseContract(Id, userId);
    parseContract(Id, characterId);

    const [current] = await this.database.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.ownerId, userId),
          eq(characters.kind, 'custom'),
        ),
      );
    if (!current || current.isTrial) throw new AppError('not_found', '角色不存在');

    const rawPlain = await this.crypto.open(
      userId,
      `character:${characterId}:draft:${current.revision}`,
      current.draftCiphertext,
    );
    let existing: CustomCharacterPayload;
    try {
      existing = JSON.parse(rawPlain.toString('utf8')) as CustomCharacterPayload;
    } finally {
      rawPlain.fill(0);
    }

    // 分类以数据库列为准（管理员更正、按新版本更新可能已改得更严）。
    existing.classification = {
      basis: current.basis,
      realPersonKind: current.realPersonKind,
      ageSetting: current.ageSetting,
      childAppearance: current.childAppearance,
    };
    // Merge patch fields
    const merged: CustomCharacterPayload = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.birthday !== undefined ? { birthday: patch.birthday ?? null } : {}),
      ...(patch.catchphrase !== undefined ? { catchphrase: patch.catchphrase ?? null } : {}),
      ...(patch.exampleDialogue !== undefined
        ? { exampleDialogue: patch.exampleDialogue ?? null }
        : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags ?? [] } : {}),
      ...(patch.avatarMediaId !== undefined ? { avatarMediaId: patch.avatarMediaId ?? null } : {}),
      ...(patch.speechStyle !== undefined ? { speechStyle: patch.speechStyle.trim() || null } : {}),
    };
    if (patch.catchphrase !== undefined || patch.catchphrases !== undefined) {
      const phrases = mergeCatchphrases(
        catchphrasesOf(existing),
        patch.catchphrase,
        patch.catchphrases,
      );
      merged.catchphrases = phrases;
      merged.catchphrase = phrases[0] ?? null;
    }
    if (patch.avatarMediaId !== undefined)
      await this.characterService.customAvatar(userId, merged.avatarMediaId);

    if (patch.classification !== undefined) {
      if (
        !classificationCanChange(
          {
            basis: existing.classification.basis as 'real_person' | 'fictional' | 'original',
            realPersonKind: existing.classification.realPersonKind as
              'celebrity' | 'historical' | 'private_person' | null,
            ageSetting: existing.classification.ageSetting as 'minor' | 'adult',
            childAppearance: existing.classification.childAppearance,
          },
          patch.classification,
          'custom',
        )
      ) {
        throw new AppError(
          'classification_change_forbidden',
          '自定义角色的分类不能向更宽松方向修改',
          { status: 422 },
        );
      }
      // 广场复制品：分类只能更严，任何横向修改（虚构 ↔ 原创、真人子类互换）也拒绝（hard-boundaries.md 第 6 节第 2 条）。
      if (
        current.originKind === 'plaza_copy' &&
        compareClassification(
          {
            basis: current.basis as 'real_person' | 'fictional' | 'original',
            realPersonKind: current.realPersonKind as
              'celebrity' | 'historical' | 'private_person' | null,
            ageSetting: current.ageSetting as 'minor' | 'adult',
            childAppearance: current.childAppearance,
          },
          patch.classification,
        ) === 'looser'
      )
        throw new AppError(
          'classification_change_forbidden',
          '从人设广场添加的角色，分类只能改得更严格',
          { status: 422 },
        );
      merged.classification = {
        basis: patch.classification.basis,
        realPersonKind: patch.classification.realPersonKind,
        ageSetting: patch.classification.ageSetting,
        childAppearance: patch.classification.childAppearance,
      };
    }

    // childFeaturesDetected only ever increases
    const detected = childFeaturesIn(textsToCheck(merged)) || current.childFeaturesDetected;
    const revision = current.revision + 1;
    const sealed = await this.crypto.seal(
      userId,
      `character:${characterId}:draft:${revision}`,
      JSON.stringify(merged),
    );

    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .update(characters)
        .set({
          name: merged.name,
          searchText: merged.name,
          basis: merged.classification.basis,
          realPersonKind: merged.classification.realPersonKind,
          ageSetting: merged.classification.ageSetting,
          childAppearance: merged.classification.childAppearance,
          childFeaturesDetected: detected,
          everPrivatePerson:
            current.everPrivatePerson || merged.classification.realPersonKind === 'private_person',
          draftCiphertext: sealed,
          revision,
          updatedAt: this.clock.now(),
        })
        .where(and(eq(characters.id, characterId), eq(characters.revision, current.revision)))
        .returning();
      if (!row) throw new AppError('conflict', '角色已被修改，请刷新后重试');
      // 分类或儿童特征变化：照常发 characters.character_classification_changed（ai-runtime 退出成人模式）。
      if (
        row.basis !== current.basis ||
        row.realPersonKind !== current.realPersonKind ||
        row.ageSetting !== current.ageSetting ||
        row.childAppearance !== current.childAppearance ||
        row.childFeaturesDetected !== current.childFeaturesDetected
      )
        await this.characterService.classificationEvent(tx, row);
      await this.audit.record(
        {
          module: 'characters',
          action: 'custom.updated',
          actorType: 'user',
          actorId: userId,
          targetType: 'character',
          targetId: characterId,
          details: { revision },
        },
        tx,
      );
    });

    return this.get(userId, characterId);
  }

  /** 3.0.1：我的全部自定义角色，按创建时间倒序。 */
  async list(userId: string): Promise<{ items: UserCustomCharacter[] }> {
    const rows = await this.database.db
      .select({ id: characters.id })
      .from(characters)
      .where(
        and(
          eq(characters.ownerId, userId),
          eq(characters.kind, 'custom'),
          eq(characters.isTrial, false),
        ),
      )
      .orderBy(desc(characters.createdAt));
    const items: UserCustomCharacter[] = [];
    for (const row of rows) items.push(await this.get(userId, row.id));
    return { items };
  }
  /** Load and return UserCustomCharacter for the given owner+characterId. */
  async get(userId: string, characterId: string): Promise<UserCustomCharacter> {
    const [row] = await this.database.db
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.ownerId, userId)));
    if (!row) throw new AppError('not_found', '角色不存在');

    const rawPlain = await this.crypto.open(
      userId,
      `character:${characterId}:draft:${row.revision}`,
      row.draftCiphertext,
    );
    let payload: CustomCharacterPayload;
    try {
      payload = JSON.parse(rawPlain.toString('utf8')) as CustomCharacterPayload;
    } finally {
      rawPlain.fill(0);
    }

    const classification = deriveClassification(
      {
        basis: row.basis as 'real_person' | 'fictional' | 'original',
        realPersonKind: row.realPersonKind as 'celebrity' | 'historical' | 'private_person' | null,
        ageSetting: row.ageSetting as 'minor' | 'adult',
        childAppearance: row.childAppearance,
      },
      'custom',
      row.childFeaturesDetected,
    );

    return {
      characterId: row.id,
      kind: 'custom' as const,
      name: row.name,
      aliases: [],
      works: [],
      avatar: {
        image: await this.characterService.customAvatar(userId, payload.avatarMediaId ?? null),
        display: {
          supportColors: [],
          avatarText: null,
          avatarPattern: classification.derived.isMinor ? 'star' : 'none',
          themeColor: null,
        },
      },
      tagline: '',
      tags: payload.tags,
      categoryId: null,
      basis: classification.basis,
      added: false,
      intro: '',
      birthday: payload.birthday ?? null,
      fanName: null,
      classification,
      showPublicSourceNotice: classification.basis === 'real_person',
      personaVersion: row.personaVersion,
      personaUpdatedUnseen: false,
      description: payload.description,
      catchphrase: payload.catchphrase,
      catchphrases: catchphrasesOf(payload),
      speechStyle: payload.speechStyle ?? null,
      exampleDialogue: payload.exampleDialogue,
      childFeaturesDetected: row.childFeaturesDetected,
    };
  }
}
