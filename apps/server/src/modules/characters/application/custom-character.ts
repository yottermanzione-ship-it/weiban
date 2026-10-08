/**
 * 自定义角色服务（T-047 CHR-07）。
 * 仅处理 kind='custom' 的角色，即用户手动创建的角色。
 * - 创建：保存描述到 draft_ciphertext（JSON），执行规则层儿童特征检测，写数据库。
 * - 更新：同创建，但遵守分类单向规则（数据库触发器 guard_classification 也会拦截）。
 * - 试聊：创建或复用一个不绑定 contacts 的临时会话（CHR-07 第 6 条）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  type UserCustomCharacterWrite,
  type UserCustomCharacterPatch,
  type UserCustomCharacter,
  type ChatAdminPort,
  type ChatReadPort,
  type Tx,
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
import { CHAT_ADMIN_PORT, CHAT_READ_PORT } from '../../chat/index.js';
import { deriveClassification, classificationCanChange } from '../../policy/index.js';
import { characters } from '../infra/db/schema.js';
import { childFeaturesIn } from '../domain/child-features.js';

/** 自定义角色的 draft_ciphertext 中存储的明文 JSON 结构。 */
interface CustomCharacterPayload {
  name: string;
  description: string;
  classification: {
    basis: string;
    realPersonKind: string | null;
    ageSetting: string;
    childAppearance: boolean;
  };
  birthday: string | null;
  catchphrase: string | null;
  exampleDialogue: string | null;
  tags: string[];
  avatarMediaId: string | null;
}

function buildPayload(body: UserCustomCharacterWrite): CustomCharacterPayload {
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
    catchphrase: body.catchphrase ?? null,
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
    @Inject(CHAT_READ_PORT) private readonly chatRead: ChatReadPort,
  ) {}

  async create(userId: string, body: UserCustomCharacterWrite): Promise<UserCustomCharacter> {
    parseContract(Id, userId);
    const payload = buildPayload(body);
    const detected = childFeaturesIn(textsToCheck(payload));

    const id = newId();
    const now = this.clock.now();
    const sealed = await this.crypto.seal(
      userId,
      `character:${id}:draft:1`,
      JSON.stringify(payload),
    );

    await this.database.transaction(async (tx) => {
      await tx.db.insert(characters).values({
        id,
        kind: 'custom',
        ownerId: userId,
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
      await this.audit.record(
        {
          module: 'characters',
          action: 'custom.created',
          actorType: 'user',
          actorId: userId,
          targetType: 'character',
          targetId: id,
        },
        tx,
      );
    });

    return this.get(userId, id);
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
    if (!current) throw new AppError('not_found', '角色不存在');

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
      ...(patch.avatarMediaId !== undefined
        ? { avatarMediaId: patch.avatarMediaId ?? null }
        : {}),
    };

    if (patch.classification !== undefined) {
      if (
        !classificationCanChange(
          {
            basis: existing.classification.basis as 'real_person' | 'fictional' | 'original',
            realPersonKind: existing.classification.realPersonKind as
              | 'celebrity'
              | 'historical'
              | 'private_person'
              | null,
            ageSetting: existing.classification.ageSetting as 'minor' | 'adult',
            childAppearance: existing.classification.childAppearance,
          },
          patch.classification,
          'custom',
        )
      ) {
        throw new AppError('classification_change_forbidden', '自定义角色的分类不能向更宽松方向修改', { status: 422 });
      }
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
            current.everPrivatePerson ||
            merged.classification.realPersonKind === 'private_person',
          draftCiphertext: sealed,
          revision,
          updatedAt: this.clock.now(),
        })
        .where(
          and(eq(characters.id, characterId), eq(characters.revision, current.revision)),
        )
        .returning();
      if (!row) throw new AppError('conflict', '角色已被修改，请刷新后重试');
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

  /**
   * 开始或复用试聊会话（CHR-07 第 6 条）。
   * 试聊会话不建立正式联系人关系，不写入长期记忆。
   * 复用：若角色已有 trialConversationId 且会话存在，直接返回。
   * 新建：用 ChatAdminPort.ensureDirectConversation（restoreHistory = false）创建独立会话。
   */
  async startTrial(userId: string, characterId: string): Promise<{ conversationId: string }> {
    parseContract(Id, userId);
    parseContract(Id, characterId);

    const [row] = await this.database.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.ownerId, userId),
          eq(characters.kind, 'custom'),
        ),
      );
    if (!row) throw new AppError('not_found', '角色不存在');

    // Try to reuse existing trial conversation
    if (row.trialConversationId) {
      const existing = await this.chatRead.findDirectConversation(userId, characterId);
      if (existing) return { conversationId: existing.conversationId };
    }

    // Create new trial conversation (ensureDirectConversation is idempotent, restoreHistory=false for trial)
    const conv = await this.database.transaction(async (tx) => {
      return this.chatAdmin.ensureDirectConversation(tx as unknown as Tx, {
        userId,
        characterId,
        restoreHistory: false,
      });
    });

    await this.database.db
      .update(characters)
      .set({ trialConversationId: conv.conversationId, updatedAt: this.clock.now() })
      .where(eq(characters.id, characterId));

    return { conversationId: conv.conversationId };
  }

  /** Load and return UserCustomCharacter for the given owner+characterId. */
  async get(userId: string, characterId: string): Promise<UserCustomCharacter> {
    const [row] = await this.database.db
      .select()
      .from(characters)
      .where(
        and(eq(characters.id, characterId), eq(characters.ownerId, userId)),
      );
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
        image: null,
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
      exampleDialogue: payload.exampleDialogue,
      childFeaturesDetected: row.childFeaturesDetected,
    };
  }
}
