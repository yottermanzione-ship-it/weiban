/**
 * 领域事件：模块之间「我这里发生了一件事」的通知。
 * 规则见 docs/decisions/ADR-0004-module-boundaries-and-events.md：
 * - 与业务数据同一事务写入发件箱（platform.outbox），至少投递一次；
 * - 订阅者必须幂等（按 eventId 去重）；
 * - 事件载荷只放 ID 和必要的事实，不放聊天正文、密钥、个人资料原文（日志与事件都会被持久化）。
 * - 新增事件或给载荷新增可选字段属于次版本变更；删除 / 改含义属于主版本变更，需架构负责人批准。
 */
import { z } from 'zod';
import { Id, LocalDate, Seq, Timestamp } from './common.js';
import { CharacterBasis, PortraitPolicy, RealPersonKind } from './http/characters.js';
import { ContentScope, ConversationType, ParticipantKind } from './http/chat.js';
import { ModelKey } from './http/model-access.js';
import { AdminAlertFacts } from './http/push.js';

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
  'proactive',
  'moments',
  'growth',
  'importer',
  'library',
  // 3.0（T-062）
  'health',
  'calls',
  'plaza',
  'play',
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

/**
 * 新用户注册成功。
 * v1.2（T-024）：可选 signupBonus——所用邀请码预设了注册赠送余额（ADM-01 第 6 条）时才有。
 * billing 订阅本事件给新账号记一条 admin_grant 流水（billing.md 8.3 节）。identity 处于底层，
 * 不能调用中层 billing 的端口（ADR-0004 / R2），所以用事件传递；不带邀请码本身。
 */
export const UserRegistered = event(
  'identity.user_registered',
  'identity',
  z.object({
    userId: Id,
    signupBonus: z
      .object({
        /** 赠送金额（微元），> 0；不赠送时不带 signupBonus。 */
        amountMicros: z.number().int().positive(),
        /** 生成该邀请码的管理员；命令行生成的码为 null。billing 记为流水的操作人。 */
        grantedByUserId: Id.nullable(),
      })
      .optional(),
  }),
);

/** 资料变更：只告知哪些字段变了，订阅者需要时通过 IdentityReadPort 读取新值。 */
export const ProfileUpdated = event(
  'identity.profile_updated',
  'identity',
  z.object({ userId: Id, changedFields: z.array(z.string()) }),
);

// v1.0：identity.age_confirmed 删除（PRD v1.2 取消年龄确认）。

/** 界面偏好（主题）变化：realtime 写 settings.updated(section = preferences)，其他设备重新拉取。 */
export const PreferencesUpdated = event(
  'identity.preferences_updated',
  'identity',
  z.object({ userId: Id }),
);

export const NotificationSettingsUpdated = event(
  'identity.notification_settings_updated',
  'identity',
  z.object({ userId: Id }),
);

/** 会话失效（退出登录、被踢下线、过期）：push 删除绑定的推送设备，realtime 断开连接。 */
export const SessionRevoked = event(
  'identity.session_revoked',
  'identity',
  z.object({
    userId: Id,
    sessionId: Id,
    reason: z.enum(['logout', 'revoked', 'expired', 'account_deleting']),
  }),
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
  payload: z.object({
    userId: Id,
    module: ModuleName,
    deletedRows: z.number().int().nonnegative(),
  }),
});

/**
 * v1.3（T-026）：需要通知管理员（总经理）的事。设计见 docs/architecture/billing.md 8.4 节；载荷 AdminAlertFacts
 * 定义在 http/push.ts（管理后台接口共用）。任何模块都可以发（producer 为发出的模块，所以单独定义），与发现问题的那次
 * 写入同一事务进发件箱。push 订阅：存入管理员提醒列表（管理后台红点），并推送到管理员账号已登记的设备。
 * 发布方仍要照常写审计日志 / 错误日志（运维告警不依赖 push）。
 */
export const AdminAlertRaised = z.object({
  eventId: Id,
  type: z.literal('platform.admin_alert_raised'),
  version: z.literal(1),
  producer: ModuleName,
  occurredAt: Timestamp,
  payload: AdminAlertFacts,
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
    /** 2.2：下架会清默认用途；保留变化前用途供隐式默认用户故障提醒。 */
    previousDefaultFor: z.array(z.enum(['chat', 'background', 'vision'])).optional(),
  }),
);

export const ModelSelectionChanged = event(
  'model_access.selection_changed',
  'model_access',
  z.object({ userId: Id, characterId: Id.nullable() }),
);

/** 专用成人检查默认首次设置/替换/路由更新，恢复因检查缺配置而等待的回复。 */
export const AdultCheckerConfigured = event(
  'model_access.adult_checker_configured',
  'model_access',
  z.object({ modelKey: ModelKey }),
);

/**
 * v1.3（T-026）：对账第 ② 层（用量记录 ↔ 扣费）某一天的结果。model-access 用 BillingChargeQueryPort
 * 比对后发出；billing 订阅，写进当天的对账记录（ReconciliationRun 的 usageWithoutCharge 等字段），
 * 管理后台对账页从 billing 一处读取（billing.md 8.2 节）。同一天重跑会再发一次，billing 以最新的为准。
 * 有异常时 model-access 另发 platform.admin_alert_raised（kind = reconciliation_flagged）。
 * 只有计数，不带明细：明细由 model-access 写自己的日志 / 审计，排查时在 model-access 查。
 */
export const UsageReconciled = event(
  'model_access.usage_reconciled',
  'model_access',
  z.object({
    /** 北京时间自然日。 */
    day: LocalDate,
    /** 成功调用的用量记录，没有对应的用户扣费流水。 */
    usageWithoutCharge: z.number().int().nonnegative(),
    /** 扣费流水找不到对应的用量记录。 */
    chargeWithoutUsage: z.number().int().nonnegative(),
    /** 用量记录上的金额快照与流水金额不相等（修复后仍不相等的）。 */
    amountMismatch: z.number().int().nonnegative(),
    /** 本次按 billing 返回值补写的金额快照条数（进程在结算后、写快照前崩溃的情况）。 */
    snapshotsRepaired: z.number().int().nonnegative(),
    checkedAt: Timestamp,
  }),
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
export const BalanceDepleted = event(
  'billing.balance_depleted',
  'billing',
  z.object({ userId: Id }),
);

/**
 * 「可能又能付钱了」：ai-runtime 收到后重新检查该用户所有因余额不足而没回复的会话，补一次合并回复
 * （billing.md 6.3、6.4 节）。v1.0 起（Q-008）在以下任一情况发出，不再只看可用余额是否跨过 0：
 * - crossed_zero：可用余额从 ≤ 0 回到 > 0；
 * - topped_up_after_rejection：自上次发出本事件以来，该账户有过 insufficient_balance 拒绝（可用余额为正但
 *   小于冻结额也算），之后余额增加（加余额、退款、正向冲正）。
 * 补回复仍可能因余额不够再被拒绝；那样会再次记下拒绝，下一次加余额时再发本事件。
 */
export const BalanceRestored = event(
  'billing.balance_restored',
  'billing',
  z.object({
    userId: Id,
    availableMicros: z.number().int(),
    trigger: z.enum(['crossed_zero', 'topped_up_after_rejection']),
  }),
);

/** 可用余额低于提醒线（同一账户每天最多一次）：push 发提醒。 */
export const BalanceLow = event(
  'billing.balance_low',
  'billing',
  z.object({
    userId: Id,
    availableMicros: z.number().int(),
    thresholdMicros: z.number().int().nonnegative(),
  }),
);

// ---------- characters ----------

export const CharacterPublished = event(
  'characters.character_published',
  'characters',
  z.object({ characterId: Id }),
);

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
  z.object({
    conversationId: Id,
    participantId: Id,
    participantKind: ParticipantKind,
    readSeq: Seq,
  }),
);

export const ContentScopeChanged = event(
  'chat.content_scope_changed',
  'chat',
  z.object({ conversationId: Id, scope: ContentScope }),
);

// ---------- 3.0：L4～L7（T-062） ----------
// 载荷只放 ID 和必要事实，不放聊天正文、信件、评论等文字（文件头规则）。

/** 关系网变化（ADM-02、SOC-01）：ai-runtime 清理缓存；删除后两人不再互动。 */
export const RelationChanged = event(
  'characters.relation_changed',
  'characters',
  z.object({
    relationId: Id,
    characterAId: Id,
    characterBId: Id,
    /** 预设之间为 null；用户为自定义角色设定的关系为该用户。 */
    ownerUserId: Id.nullable(),
    action: z.enum(['created', 'updated', 'deleted']),
  }),
);

/** 我的补充设定变化（CHR-09）：ai-runtime 从下一次回复起使用。 */
export const SupplementChanged = event(
  'characters.supplement_changed',
  'characters',
  z.object({ userId: Id, characterId: Id, action: z.enum(['saved', 'deleted']) }),
);

/** 群成员变化（含建群）。ai-runtime 检查群情景模式资格（SOC-03 第 4 条）；growth 判成就第 14、15 号。 */
export const GroupMembersChanged = event(
  'chat.group_members_changed',
  'chat',
  z.object({
    conversationId: Id,
    ownerUserId: Id,
    addedCharacterIds: z.array(Id),
    removedCharacterIds: z.array(Id),
    /** created = 建群；user = 用户操作；character = 角色拉群（SOC-06）；system = 删除角色等。 */
    cause: z.enum(['created', 'user', 'character', 'system']),
    byCharacterId: Id.nullable(),
  }),
);

export const GroupRenamed = event(
  'chat.group_renamed',
  'chat',
  z.object({ conversationId: Id, ownerUserId: Id, byCharacterId: Id.nullable() }),
);

/** 用户「删除并退出」：群已物理删除。拉群者可在私聊中提起一次（SOC-06 第 3 条）。 */
export const GroupDissolved = event(
  'chat.group_dissolved',
  'chat',
  z.object({
    conversationId: Id,
    ownerUserId: Id,
    createdByCharacterId: Id.nullable(),
    memberCharacterIds: z.array(Id),
  }),
);

/** 用户点了卡片消息的按钮（ADR-0026）。按 cardKind / ref 由所属模块处理。 */
export const MessageActionChosen = event(
  'chat.message_action_chosen',
  'chat',
  z.object({
    conversationId: Id,
    messageId: Id,
    userId: Id,
    /** 发出卡片的角色。 */
    characterId: Id.nullable(),
    cardKind: z.string(),
    actionId: z.string(),
    ref: z.object({ kind: z.string(), id: z.string() }).nullable(),
  }),
);

/** 朋友圈动态发布（用户或角色）。ai-runtime 安排可见角色互动（P-29）；growth 判成就第 16 号。 */
export const MomentsPostCreated = event(
  'moments.post_created',
  'moments',
  z.object({
    postId: Id,
    ownerUserId: Id,
    authorKind: z.enum(['user', 'character']),
    authorCharacterId: Id.nullable(),
    hasImages: z.boolean(),
    /** 用户动态可见的角色；角色动态为空数组。 */
    visibleCharacterIds: z.array(Id),
  }),
);

export const MomentsCommentCreated = event(
  'moments.comment_created',
  'moments',
  z.object({
    postId: Id,
    commentId: Id,
    ownerUserId: Id,
    postAuthorKind: z.enum(['user', 'character']),
    postAuthorCharacterId: Id.nullable(),
    authorKind: z.enum(['user', 'character']),
    authorCharacterId: Id.nullable(),
    replyToKind: z.enum(['user', 'character']).nullable(),
    replyToCharacterId: Id.nullable(),
    mentionsUser: z.boolean(),
  }),
);

export const MomentsPostLiked = event(
  'moments.post_liked',
  'moments',
  z.object({
    postId: Id,
    ownerUserId: Id,
    postAuthorKind: z.enum(['user', 'character']),
    likerKind: z.enum(['user', 'character']),
    likerCharacterId: Id.nullable(),
    /** 点赞后的角色点赞总数（成就第 18 号「人气王」）。 */
    characterLikeCount: z.number().int().nonnegative(),
  }),
);

/** ai-runtime 的里程碑（供 growth 判成就、发卡；不含内容）。 */
export const AiMilestone = event(
  'ai_runtime.milestone',
  'ai_runtime',
  z.object({
    userId: Id,
    characterId: Id,
    kind: z.enum([
      'proactive_message_sent', // 成就第 7 号
      'memory_auto_created', // 成就第 8 号
      'voice_message_sent', // 成就第 11 号
      'group_invited_user', // 成就第 15 号、瞬间卡
      'moments_replied_user', // 瞬间卡
      'contact_card_sent',
    ]),
    refId: z.string().nullable(),
  }),
);

/** 熟悉度升级（AI 变更申请第 8 条）：ai-runtime 解锁行为（来电询问、拉群）；growth 自己发熟悉度卡。 */
export const FamiliarityLeveledUp = event(
  'growth.familiarity_leveled_up',
  'growth',
  z.object({ userId: Id, characterId: Id, level: z.number().int().min(2).max(5) }),
);

/** 纪念日到达（用户时区当天）：ai-runtime 发纪念消息 / 寄信。 */
export const AnniversaryReached = event(
  'growth.anniversary_reached',
  'growth',
  z.object({
    userId: Id,
    characterId: Id,
    anniversaryId: Id,
    kind: z.enum(['system', 'custom']),
    daysKnown: z.number().int().positive(),
    date: LocalDate,
  }),
);

export const CardIssued = event(
  'growth.card_issued',
  'growth',
  z.object({
    userId: Id,
    characterId: Id,
    cardId: Id,
    kind: z.string(),
    totalCards: z.number().int().positive(),
  }),
);

export const AchievementUnlocked = event(
  'growth.achievement_unlocked',
  'growth',
  z.object({ userId: Id, achievementKey: z.string(), no: z.number().int().positive() }),
);

export const PetAdopted = event(
  'growth.pet_adopted',
  'growth',
  z.object({ userId: Id, characterId: Id, petId: Id, speciesId: Id }),
);

export const PetStageChanged = event(
  'growth.pet_stage_changed',
  'growth',
  z.object({ userId: Id, characterId: Id, petId: Id, stage: z.enum(['baby', 'junior', 'adult']) }),
);

export const PetSentAway = event(
  'growth.pet_sent_away',
  'growth',
  z.object({ userId: Id, characterId: Id, petId: Id }),
);

export const PetRenamed = event(
  'growth.pet_renamed',
  'growth',
  z.object({ userId: Id, characterId: Id, petId: Id }),
);

/** 「让 TA 起名」：ai-runtime 生成 3 个候选名，经 PetNamingPort 回传，并以 pet_names 卡片消息发到私聊。 */
export const PetNamingRequested = event(
  'growth.pet_naming_requested',
  'growth',
  z.object({
    userId: Id,
    characterId: Id,
    requestId: Id,
    speciesId: Id,
    appearanceId: Id,
    /** 3.1（T-082 申请）：物种名称（如「猫」），起名提示用；旧事件不带。 */
    speciesName: z.string().min(1).max(12).optional(),
  }),
);

export const FavoriteAdded = event(
  'library.favorite_added',
  'library',
  z.object({ userId: Id, favoriteIds: z.array(Id), totalFavorites: z.number().int().positive() }),
);

export const ShareImageGenerated = event(
  'library.share_image_generated',
  'library',
  z.object({ userId: Id, template: z.string() }),
);

export const CallStarted = event(
  'calls.call_started',
  'calls',
  z.object({
    callId: Id,
    userId: Id,
    characterId: Id,
    direction: z.enum(['outgoing', 'incoming']),
  }),
);

export const CallAnswered = event(
  'calls.call_answered',
  'calls',
  z.object({
    callId: Id,
    userId: Id,
    characterId: Id,
    direction: z.enum(['outgoing', 'incoming']),
  }),
);

/** 通话结束：ai-runtime 未接 / 拒接后发一条消息、当天不再来电（MED-07 第 5 条）；growth 判成就、熟悉度。 */
export const CallEnded = event(
  'calls.call_ended',
  'calls',
  z.object({
    callId: Id,
    userId: Id,
    characterId: Id,
    conversationId: Id,
    direction: z.enum(['outgoing', 'incoming']),
    outcome: z.string(),
    durationSec: z.number().int().nonnegative(),
  }),
);

export const ImportJobCompleted = event(
  'importer.job_completed',
  'importer',
  z.object({
    userId: Id,
    jobId: Id,
    kind: z.enum(['new_character', 'supplement']),
    ok: z.boolean(),
  }),
);

export const PlazaWorkPublished = event(
  'plaza.work_published',
  'plaza',
  z.object({ workId: Id, authorUserId: Id, kind: z.enum(['custom_character', 'preset_variant']) }),
);

export const PlazaWorkVersionPublished = event(
  'plaza.work_version_published',
  'plaza',
  z.object({ workId: Id, authorUserId: Id, version: z.number().int().positive() }),
);

export const PlazaWorkRemoved = event(
  'plaza.work_removed',
  'plaza',
  z.object({
    workId: Id,
    authorUserId: Id,
    reason: z.enum(['author_unlisted', 'author_deleted', 'admin_removed', 'author_banned']),
  }),
);

export const DailyAnswerSubmitted = event(
  'play.daily_answer_submitted',
  'play',
  z.object({ userId: Id, characterId: Id, answerId: Id, questionId: Id, messageId: Id }),
);

/** 清单项变化：dueDate 变化时 ai-runtime 写 / 取消约定记忆（PLAY-04 第 5 条）。 */
export const WishlistItemChanged = event(
  'play.wishlist_item_changed',
  'play',
  z.object({
    userId: Id,
    characterId: Id,
    itemId: Id,
    action: z.enum(['created', 'updated', 'deleted']),
    dueDate: LocalDate.nullable(),
  }),
);

export const WishlistItemCompleted = event(
  'play.wishlist_item_completed',
  'play',
  z.object({ userId: Id, characterId: Id, itemId: Id, firstCompletion: z.boolean() }),
);

/** 用户寄信：ai-runtime 在 deliverAt 前约 10 分钟生成回信。 */
export const LetterSent = event(
  'play.letter_sent',
  'play',
  z.object({ userId: Id, characterId: Id, letterId: Id, deliverAt: Timestamp }),
);

export const LetterDelivered = event(
  'play.letter_delivered',
  'play',
  z.object({ userId: Id, characterId: Id, letterId: Id, firstReplyFromCharacter: z.boolean() }),
);

export const FocusStarted = event(
  'play.focus_started',
  'play',
  z.object({ userId: Id, characterId: Id, focusId: Id, endsAt: Timestamp }),
);

export const FocusEnded = event(
  'play.focus_ended',
  'play',
  z.object({
    userId: Id,
    characterId: Id,
    focusId: Id,
    result: z.enum(['completed', 'ended_early']),
    minutes: z.number().int().nonnegative(),
  }),
);

/** 提醒保存或内容修改：ai-runtime 生成 5 种说法（PLAY-07 第 3 条）。 */
export const ReminderSaved = event(
  'play.reminder_saved',
  'play',
  z.object({ userId: Id, characterId: Id, reminderId: Id, textChanged: z.boolean() }),
);

// ---------- 汇总 ----------

export const DomainEvent = z.discriminatedUnion('type', [
  UserRegistered,
  ProfileUpdated,
  PreferencesUpdated,
  NotificationSettingsUpdated,
  SessionRevoked,
  UserDeletionRequested,
  UserDataPurged,
  AdminAlertRaised,
  ModelStatusChanged,
  ModelSelectionChanged,
  AdultCheckerConfigured,
  UsageReconciled,
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
  // 3.0
  RelationChanged,
  SupplementChanged,
  GroupMembersChanged,
  GroupRenamed,
  GroupDissolved,
  MessageActionChosen,
  MomentsPostCreated,
  MomentsCommentCreated,
  MomentsPostLiked,
  AiMilestone,
  FamiliarityLeveledUp,
  AnniversaryReached,
  CardIssued,
  AchievementUnlocked,
  PetAdopted,
  PetStageChanged,
  PetSentAway,
  PetRenamed,
  PetNamingRequested,
  FavoriteAdded,
  ShareImageGenerated,
  CallStarted,
  CallAnswered,
  CallEnded,
  ImportJobCompleted,
  PlazaWorkPublished,
  PlazaWorkVersionPublished,
  PlazaWorkRemoved,
  DailyAnswerSubmitted,
  WishlistItemChanged,
  WishlistItemCompleted,
  LetterSent,
  LetterDelivered,
  FocusStarted,
  FocusEnded,
  ReminderSaved,
]);
export type DomainEvent = z.infer<typeof DomainEvent>;
export type DomainEventType = DomainEvent['type'];

/** 按事件类型取出对应的事件类型定义，供订阅者使用：EventOf<'chat.message_created'>。 */
export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

/**
 * ai-runtime 发布的事件（例如日常事件生成、安全关怀触发、回复生成失败）由 AI 负责人在 T-005 后
 * 以变更申请提出，架构负责人批准后加入本文件。
 */
