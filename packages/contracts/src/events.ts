/**
 * 领域事件：模块之间「我这里发生了一件事」的通知。
 * 规则见 docs/decisions/ADR-0004-module-boundaries-and-events.md：
 * - 与业务数据同一事务写入发件箱（platform.outbox），至少投递一次；
 * - 订阅者必须幂等（按 eventId 去重）；
 * - 事件载荷只放 ID 和必要的事实，不放聊天正文、密钥、个人资料原文（日志与事件都会被持久化）。
 * - 新增事件或给载荷新增可选字段属于次版本变更；删除 / 改含义属于主版本变更，需架构负责人批准。
 */
import { z } from 'zod';
import { Id, Seq, Timestamp } from './common.js';
import { CharacterBasis, PortraitPolicy, RealPersonKind } from './http/characters.js';
import { ContentScope, ConversationType, ParticipantKind } from './http/chat.js';
import { ModelKey } from './http/model-access.js';

export const ModuleName = z.enum([
  'identity',
  'realtime',
  'push',
  'media',
  'model_access',
  'billing',
  'characters',
  'contacts',
  'chat',
  'policy',
  'ai_runtime',
  'moments',
  'growth',
  'importer',
  'library',
]);
export type ModuleName = z.infer<typeof ModuleName>;

function event<T extends string, P extends z.ZodType>(type: T, producer: ModuleName, payload: P) {
  return z.object({
    eventId: Id,
    type: z.literal(type),
    /** 载荷结构版本，主版本变更时加一。 */
    version: z.literal(1),
    producer: z.literal(producer),
    occurredAt: Timestamp,
    payload,
  });
}

// ---------- identity ----------

export const UserRegistered = event('identity.user_registered', 'identity', z.object({ userId: Id }));

/** 资料变更：只告知哪些字段变了，订阅者需要时通过 IdentityReadPort 读取新值。 */
export const ProfileUpdated = event(
  'identity.profile_updated',
  'identity',
  z.object({ userId: Id, changedFields: z.array(z.string()) }),
);

export const AgeConfirmed = event('identity.age_confirmed', 'identity', z.object({ userId: Id }));

export const NotificationSettingsUpdated = event(
  'identity.notification_settings_updated',
  'identity',
  z.object({ userId: Id }),
);

/** 会话失效（退出登录、被踢下线、过期）：push 删除绑定的推送设备，realtime 断开连接。 */
export const SessionRevoked = event(
  'identity.session_revoked',
  'identity',
  z.object({ userId: Id, sessionId: Id, reason: z.enum(['logout', 'revoked', 'expired', 'account_deleting']) }),
);

/**
 * 注销账号：每个拥有用户数据的模块必须订阅，物理删除自己的全部相关数据，
 * 完成后发布 platform.user_data_purged（见 docs/architecture/security-and-privacy.md 第 5.1 节）。
 */
export const UserDeletionRequested = event(
  'identity.user_deletion_requested',
  'identity',
  z.object({ userId: Id, requestedAt: Timestamp }),
);

/** 各模块删除完毕后的回报。producer 字段固定为 identity 之外的模块，因此单独定义。 */
export const UserDataPurged = z.object({
  eventId: Id,
  type: z.literal('platform.user_data_purged'),
  version: z.literal(1),
  producer: ModuleName,
  occurredAt: Timestamp,
  payload: z.object({ userId: Id, module: ModuleName, deletedRows: z.number().int().nonnegative() }),
});

// ---------- model-access ----------

/**
 * 某个模型的可用状态变化（上游故障 / 恢复、管理员停用）。影响所有选用该模型的用户：
 * ai-runtime 暂停 / 恢复相关任务，恢复后对等待中的会话补一次合并回复（MDL-04）。
 * v0.2 取代 credential_status_changed / credential_deleted（BYOK 删除）。
 */
export const ModelStatusChanged = event(
  'model_access.model_status_changed',
  'model_access',
  z.object({
    modelKey: ModelKey,
    available: z.boolean(),
    reason: z.enum(['provider_unavailable', 'model_removed', 'recovered']),
  }),
);

export const ModelSelectionChanged = event(
  'model_access.selection_changed',
  'model_access',
  z.object({ userId: Id, characterId: Id.nullable() }),
);

// ---------- billing ----------

/** 余额变化（加余额、扣费结算等）：realtime 写 settings.updated(section = wallet) 让客户端刷新。 */
export const BalanceChanged = event(
  'billing.balance_changed',
  'billing',
  z.object({
    userId: Id,
    balanceMicros: z.number().int(),
    availableMicros: z.number().int(),
    entryType: z.enum(['admin_grant', 'admin_deduct', 'charge', 'refund', 'adjustment']),
  }),
);

/** 可用余额从 > 0 变为 ≤ 0：ai-runtime 暂停该用户全部后台任务，聊天不再回复。 */
export const BalanceDepleted = event('billing.balance_depleted', 'billing', z.object({ userId: Id }));

/** 可用余额从 ≤ 0 回到 > 0：ai-runtime 对「最后一条是用户消息」的会话补一次合并回复。 */
export const BalanceRestored = event('billing.balance_restored', 'billing', z.object({ userId: Id }));

/** 可用余额低于提醒线（同一账户每天最多一次）：push 发提醒。 */
export const BalanceLow = event(
  'billing.balance_low',
  'billing',
  z.object({ userId: Id, availableMicros: z.number().int(), thresholdMicros: z.number().int().nonnegative() }),
);

// ---------- characters ----------

export const CharacterPublished = event('characters.character_published', 'characters', z.object({ characterId: Id }));

export const CharacterUnpublished = event(
  'characters.character_unpublished',
  'characters',
  z.object({ characterId: Id }),
);

/**
 * 分类或推导结果变化（SAFE-03 第 5 条）：ai-runtime 必须把资格变为「否」的成人模式会话强制切回日常。
 * ownerUserId：自定义角色的创建者；预设角色为 null（影响所有添加了它的用户）。
 */
export const CharacterClassificationChanged = event(
  'characters.character_classification_changed',
  'characters',
  z.object({
    characterId: Id,
    ownerUserId: Id.nullable(),
    basis: CharacterBasis,
    realPersonKind: RealPersonKind.nullable(),
    isMinor: z.boolean(),
    adultModeEligible: z.boolean(),
    romanceAllowed: z.boolean(),
    portraitPolicy: PortraitPolicy,
    publicStatementGuard: z.boolean(),
  }),
);

export const PersonaVersionPublished = event(
  'characters.persona_version_published',
  'characters',
  z.object({ characterId: Id, personaVersion: z.number().int().positive() }),
);

// ---------- contacts ----------

/** 用户发出好友申请。contacts 自己的延迟任务会在 P-30 秒后「通过」。 */
export const ContactRequested = event(
  'contacts.contact_requested',
  'contacts',
  z.object({ userId: Id, characterId: Id, hasGreeting: z.boolean() }),
);

/**
 * 好友申请已通过、私聊会话已创建。ai-runtime 订阅后生成角色的第一条消息（CHR-03 第 2、3 条）：
 * 打招呼的话通过 ContactsReadPort 读取（不放进事件载荷）。
 */
export const ContactAccepted = event(
  'contacts.contact_accepted',
  'contacts',
  z.object({
    userId: Id,
    characterId: Id,
    conversationId: Id,
    mode: z.enum(['new', 'restored', 'fresh_after_delete']),
    referrerCharacterId: Id.nullable(),
  }),
);

/** 软删除（30 天内可恢复）：停止推演、主动消息、朋友圈、来电（CHR-06 第 2 条）。 */
export const ContactRemoved = event(
  'contacts.contact_removed',
  'contacts',
  z.object({ userId: Id, characterId: Id, purgeAfter: Timestamp }),
);

/** 彻底删除（30 天到期或用户选择立即删除）：各模块删除该用户与该角色相关的全部数据。 */
export const ContactPurged = event(
  'contacts.contact_purged',
  'contacts',
  z.object({ userId: Id, characterId: Id, conversationId: Id.nullable() }),
);

export const ContactUpdated = event(
  'contacts.contact_updated',
  'contacts',
  z.object({ userId: Id, characterId: Id, changedFields: z.array(z.string()) }),
);

// ---------- chat ----------

export const ConversationCreated = event(
  'chat.conversation_created',
  'chat',
  z.object({
    conversationId: Id,
    type: ConversationType,
    participants: z.array(z.object({ participantId: Id, kind: ParticipantKind, refId: Id })),
  }),
);

/**
 * 新消息。ai-runtime 据此决定是否回复，push 据此决定是否推送。
 * 不含正文：订阅者需要时通过 ChatReadPort 读取（并声明可见范围）。
 */
export const MessageCreated = event(
  'chat.message_created',
  'chat',
  z.object({
    conversationId: Id,
    conversationType: ConversationType,
    messageId: Id,
    seq: Seq,
    senderParticipantId: Id,
    senderKind: ParticipantKind.or(z.literal('system')),
    /** 发送者为角色时是 characterId，为用户时是 userId。 */
    senderRefId: Id.nullable(),
    contentType: z.string(),
    scope: ContentScope,
    /** 引用回复时被引用的消息（CHAT-02 第 5 条）。 */
    quoteMessageId: Id.nullable(),
    /** 消息中被 @ 的参与者（群聊，L4 起使用）。 */
    mentionedParticipantIds: z.array(Id),
    /** 会话中所有用户参与者的 userId（推送对象）。 */
    userRecipientIds: z.array(Id),
  }),
);

export const MessageRecalled = event(
  'chat.message_recalled',
  'chat',
  z.object({ conversationId: Id, messageId: Id, seq: Seq, recalledByParticipantId: Id }),
);

export const ReadCursorMoved = event(
  'chat.read_cursor_moved',
  'chat',
  z.object({ conversationId: Id, participantId: Id, participantKind: ParticipantKind, readSeq: Seq }),
);

export const ContentScopeChanged = event(
  'chat.content_scope_changed',
  'chat',
  z.object({ conversationId: Id, scope: ContentScope }),
);

// ---------- 汇总 ----------

export const DomainEvent = z.discriminatedUnion('type', [
  UserRegistered,
  ProfileUpdated,
  AgeConfirmed,
  NotificationSettingsUpdated,
  SessionRevoked,
  UserDeletionRequested,
  UserDataPurged,
  ModelStatusChanged,
  ModelSelectionChanged,
  BalanceChanged,
  BalanceDepleted,
  BalanceRestored,
  BalanceLow,
  CharacterPublished,
  CharacterUnpublished,
  CharacterClassificationChanged,
  PersonaVersionPublished,
  ContactRequested,
  ContactAccepted,
  ContactRemoved,
  ContactPurged,
  ContactUpdated,
  ConversationCreated,
  MessageCreated,
  MessageRecalled,
  ReadCursorMoved,
  ContentScopeChanged,
]);
export type DomainEvent = z.infer<typeof DomainEvent>;
export type DomainEventType = DomainEvent['type'];

/** 按事件类型取出对应的事件类型定义，供订阅者使用：EventOf<'chat.message_created'>。 */
export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

/**
 * ai-runtime 发布的事件（例如日常事件生成、安全关怀触发、回复生成失败）由 AI 负责人在 T-005 后
 * 以变更申请提出，架构负责人批准后加入本文件。
 */
