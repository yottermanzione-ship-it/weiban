/**
 * chat 模块：会话、参与者、消息。
 * 需求：CHAT-01、CHAT-02、CHAT-03、CHAT-13（通用部分）；群聊（SOC-03）在 L4 扩展。
 * 可靠性规则见 docs/architecture/message-reliability.md。
 *
 * 重要：chat 不知道 AI 的存在。角色只是 kind = 'character' 的参与者。
 * 客户端遇到不认识的 content.type，必须显示「当前版本不支持此消息」而不是报错（新增消息类型是次版本变更）；
 * 契约用 ReceivedMessageContent 把它解析为 type = 'unsupported'。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  ClientMsgId,
  Id,
  NoContent,
  Seq,
  Timestamp,
  tolerantEnum,
  defineEndpoint,
  unknownTypeFallback,
} from '../common.js';

// ---------- 参与者 ----------

export const ParticipantKind = z.enum(['user', 'character', 'official']);
export type ParticipantKind = z.infer<typeof ParticipantKind>;

export const Participant = z.object({
  participantId: Id,
  kind: ParticipantKind,
  /** kind = user 时是 userId；kind = character 时是 characterId；kind = official 时是官方身份固定 refId。 */
  refId: Id,
  joinedAt: Timestamp,
});
export type Participant = z.infer<typeof Participant>;

// ---------- 消息内容 ----------

export const TextContent = z.object({
  type: z.literal('text'),
  /** 文字与 emoji。 */
  text: z.string().min(1).max(4000),
  /** 3.0：群聊中被 @ 的参与者（SOC-04 第 1 条）；私聊忽略。 */
  mentions: z.array(Id).max(10).optional(),
});

/** 拍一拍（CHAT-02 第 4 条）。 */
export const NudgeContent = z.object({
  type: z.literal('nudge'),
  targetParticipantId: Id,
  /** 3.27（H1）：被拍的是用户、角色还是官方身份。服务器写入时填写，客户端发送时不用传（传了也会被覆盖）。 */
  targetKind: z.enum(['user', 'character', 'official']).optional(),
  /**
   * 3.27（H1）：被拍一方的拍一拍后缀快照（目前只有用户能设置，见 Profile.nudgeSuffix）。
   * 服务器写入时填写，客户端传了会被覆盖；显示为「X 拍了拍 Y」+ suffix。
   */
  suffix: z.string().max(15).optional(),
});
export type NudgeContent = z.infer<typeof NudgeContent>;

/**
 * 系统提示（会话中的灰色小字，术语见 glossary）。
 * code 决定文案模板，客户端按 code 渲染；params 填充模板。
 * L1 使用：contact_accepted（XX 通过了你的好友申请）。
 * 后续层预留：scenario_mode_switched、familiarity_level_up、member_joined、member_left、group_renamed、
 * missed_call、call_record 等，新增 code 属于次版本变更。
 */
export const SystemContent = z.object({
  type: z.literal('system'),
  code: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

/**
 * 3.1（积压 ㊲）：玩法系统提示 code 与参数（play 经 ChatAdminPort.postSystemMessage 发到私聊，只对用户可见，
 * 不进模型上下文；客户端按 code 渲染，不认识的 code 按 SystemContent 通用规则处理）。
 * - focus_started：「开始专注 {minutes} 分钟」；params: sessionId、minutes、characterName。
 * - letter_sent：「信已寄出，{characterName} 的回信在路上」；params: letterId、characterName、expectedAt（ISO 时间，可省略）。
 * - wishlist_item_completed：「{title} 已完成」，cardIssued = true 时加「· 获得瞬间卡」；params: itemId、title、cardIssued、cardId（可省略）。
 */
export const PLAY_SYSTEM_NOTICE_CODES = [
  'focus_started',
  'letter_sent',
  'wishlist_item_completed',
] as const;
export type PlaySystemNoticeCode = (typeof PLAY_SYSTEM_NOTICE_CODES)[number];

// ---------- 3.0 新增消息类型（L4～L7，T-062，ADR-0026） ----------

/** 图片（MED-02、MED-04）：用户发图、角色发图、宠物照片。访问链接经 GET /media/:mediaId 获取。 */
export const ImageContent = z.object({
  type: z.literal('image'),
  mediaId: Id,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /**
   * 3.1（积压 ⑲）：图片字节数，服务器发送时从媒体记录填入；客户端据此决定「添加到表情」是否可用（< 1 MB）。
   * 旧消息、旧服务器不带，客户端按「未知」处理（不限制，由服务器 422 兜底）。
   */
  sizeBytes: z.number().int().positive().nullable().optional(),
});

/**
 * 语音消息（MED-03）。transcript：角色语音在发送时即带原文；用户语音为 null，
 * 「转文字」走 GET /media/:mediaId/transcript（识别完成后另发 media.transcript_ready 更新）。
 */
export const VoiceContent = z.object({
  type: z.literal('voice'),
  mediaId: Id,
  durationMs: z
    .number()
    .int()
    .positive()
    .max(60_000 * 5),
  transcript: z.string().max(4000).nullable(),
});

/** 表情包（MED-01）：library = 管理员表情包库，user = 用户自己添加的表情。 */
export const StickerContent = z.object({
  type: z.literal('sticker'),
  stickerId: Id,
  source: z.enum(['library', 'user']),
  mediaId: Id,
  /** 表情含义（库内表情由管理员填写），供无识图能力时理解，例「捂脸笑」。 */
  description: z.string().max(40).nullable(),
});

/** 链接打开方式提示（MED-05）：music / video 时安卓尝试唤起对应 App。 */
export const LinkAppHint = z.enum(['music', 'video', 'web']);

/**
 * 链接卡片（MED-05）。角色发出的链接必须来自作品链接库或通过可访问性检查（AI 负责）；
 * 用户发链接前客户端先调 POST /links/preview 取标题。
 */
export const LinkContent = z.object({
  type: z.literal('link'),
  url: z.url().max(2000),
  title: z.string().min(1).max(100),
  /** 来源展示名，例「QQ 音乐」「微博」。 */
  source: z.string().max(30).nullable(),
  description: z.string().max(200).nullable(),
  coverMediaId: Id.nullable(),
  appHint: tolerantEnum(LinkAppHint),
});

/** 名片（CHR-04）：点开是该角色资料页，可直接添加；添加时带 referrerCharacterId。 */
export const ContactCardContent = z.object({
  type: z.literal('contact_card'),
  characterId: Id,
  /** 发出时的角色名快照（展示用；以资料页为准）。 */
  name: z.string().min(1).max(32),
  /** 推荐人（发出名片的角色）。 */
  recommenderCharacterId: Id,
});

export const CallDirection = z.enum(['outgoing', 'incoming']);
export type CallDirection = z.infer<typeof CallDirection>;
/** 通话结果（MED-06 第 5 条、MED-07 第 5 条）。 */
export const CallOutcome = z.enum([
  'completed',
  'missed',
  'declined',
  'cancelled',
  'failed',
  'insufficient_balance',
  'time_limit',
]);
export type CallOutcome = z.infer<typeof CallOutcome>;

/** 通话记录（「通话时长 05:23」「未接来电」「XX 给你打过电话」）。 */
export const CallRecordContent = z.object({
  type: z.literal('call_record'),
  callId: Id,
  direction: CallDirection,
  outcome: tolerantEnum(CallOutcome),
  durationSec: z.number().int().nonnegative(),
});

/** 信件卡片（PLAY-05）：来信（用户写给角色）与回信（角色写给用户）都以此出现在私聊，正文就是信。 */
export const LetterContent = z.object({
  type: z.literal('letter'),
  letterId: Id,
  direction: z.enum(['to_character', 'from_character']),
  body: z.string().min(1).max(4000),
});

/** 每日一问卡片（PLAY-03 第 6 条）：用户的回答以此进入私聊（发送者为用户参与者），角色接话是普通文字消息。 */
export const DailyQuestionContent = z.object({
  type: z.literal('daily_question'),
  answerId: Id,
  questionId: Id,
  /** 题目所属的用户当地日期。 */
  date: z.iso.date(),
  question: z.string().min(1).max(100),
  answer: z.string().min(1).max(200),
});

/** 卡片按钮样式。 */
export const MessageActionStyle = z.enum(['primary', 'secondary']);

/**
 * 卡片按钮的种类（谁来处理用户的选择）。新增种类是次版本变更，客户端不认识时只显示文字与按钮。
 * - call_permission：「以后可以给你打电话吗」（MED-07 第 1 条，ai-runtime 处理）
 * - pet_proposal：角色提议领养，「去看看」（PLAY-02 第 2 条，ai-runtime 记已提议；客户端跳转领养页）
 * - pet_names：「让 TA 起名」的 3 个候选名（PLAY-02 第 3 条，growth 处理）
 * - wishlist_proposal：「加进去 / 先不了」（PLAY-04 第 4 条，play 处理）
 */
export const ActionCardKind = z.enum([
  'call_permission',
  'pet_proposal',
  'pet_names',
  'wishlist_proposal',
]);
export type ActionCardKind = z.infer<typeof ActionCardKind>;

/**
 * 带按钮的卡片消息（ADR-0026）。只有服务器端发送方能发；用户点按钮走 chooseMessageAction，
 * 只能点一次，结果写在 Message.actionChoice，并发出 chat.message_action_chosen 由 ref 所属模块处理。
 */
export const ActionCardContent = z.object({
  type: z.literal('action_card'),
  cardKind: tolerantEnum(ActionCardKind),
  text: z.string().min(1).max(500),
  actions: z
    .array(
      z.object({
        actionId: z.string().regex(/^[a-z0-9_]{1,32}$/),
        label: z.string().min(1).max(16),
        style: MessageActionStyle,
      }),
    )
    .min(1)
    .max(4),
  /** 卡片关联的业务对象，例 { kind: 'pet_naming_request', id }；chat 只原样存取。 */
  ref: z.object({ kind: z.string().max(32), id: z.string().max(64) }).nullable(),
});

/**
 * 消息内容（严格）：服务器写入消息时用它校验。新增类型是次版本变更（接收端容错）。
 * 3.0：新增 image、voice、sticker、link、contact_card、call_record、letter、daily_question、action_card。
 */
/** 3.10：非递归聊天记录快照；动作类在服务器转换为静态文字。 */
export const ForwardSnapshotContent = z.discriminatedUnion('type', [
  TextContent,
  ImageContent,
  VoiceContent,
  StickerContent,
  LinkContent,
  ContactCardContent,
  LetterContent,
  DailyQuestionContent,
]);
export type ForwardSnapshotContent = z.infer<typeof ForwardSnapshotContent>;
export const ForwardedRecordContent = z.object({
  type: z.literal('forwarded_record'),
  title: z.string().min(1).max(200),
  items: z
    .array(
      z.object({
        senderName: z.string().min(1).max(100),
        senderKind: ParticipantKind,
        createdAt: Timestamp,
        content: ForwardSnapshotContent,
      }),
    )
    .min(2)
    .max(50),
});
export type ForwardedRecordContent = z.infer<typeof ForwardedRecordContent>;

export const MessageContent = z.discriminatedUnion('type', [
  TextContent,
  NudgeContent,
  SystemContent,
  ImageContent,
  VoiceContent,
  StickerContent,
  LinkContent,
  ContactCardContent,
  CallRecordContent,
  LetterContent,
  DailyQuestionContent,
  ActionCardContent,
  ForwardedRecordContent,
]);
export type MessageContent = z.infer<typeof MessageContent>;

/** 当前契约版本认识的消息类型。 */
export const MESSAGE_CONTENT_TYPES = MessageContent.options.map((o) => o.shape.type.value);

/**
 * 客户端不认识的消息类型（新版本服务器发来的新类型）：显示「当前版本不支持此消息」。
 * 这个类型只由接收端解析产生，服务器永远不会发出 type = 'unsupported'。
 */
export const UnsupportedContent = z.object({
  type: z.literal('unsupported'),
  /** 服务器发来的原始类型名，例 "image"。 */
  originalType: z.string(),
});
export type UnsupportedContent = z.infer<typeof UnsupportedContent>;

/**
 * 接收端的消息内容（Q-003）：已知类型照常严格校验；不认识的类型变成 UnsupportedContent，不报错。
 * 出现在所有「服务器 → 客户端」的消息里（Message.content）。
 */
export const ReceivedMessageContent = z.preprocess(
  unknownTypeFallback(MESSAGE_CONTENT_TYPES, (originalType) => ({
    type: 'unsupported',
    originalType,
  })),
  z.discriminatedUnion('type', [...MessageContent.options, UnsupportedContent]),
);
export type ReceivedMessageContent = z.infer<typeof ReceivedMessageContent>;

/**
 * 用户可以发送的内容。3.0 新增 image、voice、sticker、link（mediaId 必须是本人上传、用途匹配的媒体，
 * 服务器校验）。名片、通话记录、信件、每日一问、卡片只由服务器端发送方产生。
 */
export const UserSendableContent = z.discriminatedUnion('type', [
  TextContent,
  NudgeContent,
  ImageContent,
  VoiceContent,
  StickerContent,
  LinkContent,
]);
export type UserSendableContent = z.infer<typeof UserSendableContent>;

// ---------- 消息 ----------

/** 内容范围：由服务器按会话当时的 contentScope 盖章，客户端不能指定（hard-boundaries.md「内容范围标签」）。 */
export const ContentScope = z.enum(['normal', 'adult']);
export type ContentScope = z.infer<typeof ContentScope>;

export const MessageStatus = z.enum(['normal', 'recalled']);

export const QuoteRef = z.object({
  messageId: Id,
  seq: Seq,
  /** 被引用消息的摘要（被撤回时为 null）。 */
  preview: z.string().max(100).nullable(),
});

export const Message = z.object({
  messageId: Id,
  conversationId: Id,
  seq: Seq,
  senderParticipantId: Id,
  /** 'official' = 小V同学官方身份发出的消息；'system' 仍是会话内系统提示，不得挪用为官方身份。 */
  senderKind: ParticipantKind.or(z.literal('system')),
  /** 撤回后为 null（与微信一致，看不到撤回内容）。客户端解析时不认识的类型变为 unsupported。 */
  content: ReceivedMessageContent.nullable(),
  quote: QuoteRef.nullable(),
  status: MessageStatus,
  scope: ContentScope,
  /**
   * 服务器端标签集合（v2.5 新增，次版本变更）。
   * 当前已定义取值：
   *   - 'health'：消息使用了经期数据生成（PLAY-01 第 7 条 / health-data.md 第 5 节）。
   *     效果：推送通知只显示「XX 发来一条消息」（不显示正文）；不能选入分享图；不进名场面瞬间卡。
   *   - 'self_chat'（3.0.1，T-065）：群聊里角色自己聊起来的消息（SOC-05）。效果：没有 @ 用户时不推送；未读数照常。
   * **只有服务器端发送方（ChatParticipantPort.postMessage 的 labels 参数）可以设置此字段。**
   * 用户经 HTTP / WebSocket 发送的消息不能携带 labels，服务器会忽略或拒绝。
   * 客户端遇到不认识的标签值时忽略，不报错（接收端容错，同 scope 的处理原则）。
   */
  labels: z.array(z.string()).optional(),
  /** 仅当发送者是当前用户时返回，用于与本地「发送中」的消息合并。 */
  clientMsgId: ClientMsgId.nullable(),
  createdAt: Timestamp,
  recalledAt: Timestamp.nullable(),
  /** 3.0：action_card 消息上用户的选择（只能选一次）；未选或不是卡片消息时不返回或为 null。 */
  actionChoice: z.object({ actionId: z.string(), chosenAt: Timestamp }).nullable().optional(),
  /**
   * v3.3（积分制，ADR-0032）：生成这条消息消耗的积分（合计，不分输入 / 输出 / 缓存；1 元 = 100 积分）。
   * 一次回复拆成多个气泡时记在第一个气泡上，其余气泡不带。用户消息、系统消息、没有扣费的消息不带或为 null。
   * 界面规则：聊天页不显示积分数（06-old-ui-spec 6.1），供积分明细与用量页使用。
   */
  pointsCost: z.number().nonnegative().nullable().optional(),
  /** v3.3：生成这条消息的那次调用（用量记录 ID），与 LedgerEntry.usageRecordId 对应；没有时不带。 */
  usageRecordId: Id.nullable().optional(),
});
export type Message = z.infer<typeof Message>;

/** v3.3：积分明细「每条消息」页：按调用查对应的消息摘要。 */
export const ChargedMessage = z.object({
  usageRecordId: Id,
  messageId: Id,
  conversationId: Id,
  /** 角色回复的前 30 个字；撤回、非文字消息为「[消息]」，成人范围消息为「[消息]」。 */
  excerpt: z.string().max(40),
  pointsCost: z.number().nonnegative(),
  createdAt: Timestamp,
});
export type ChargedMessage = z.infer<typeof ChargedMessage>;

/** 会话列表中的最后一条消息摘要。3.25 起私密模式（成人范围）消息一律为「[私密消息]」（撤回的仍显示撤回提示），客户端同样处理。 */
export const MessagePreview = z.object({
  messageId: Id,
  seq: Seq,
  senderParticipantId: Id,
  text: z.string().max(100),
  createdAt: Timestamp,
});

// ---------- 会话 ----------

export const ConversationType = z.enum(['direct', 'group']);
export type ConversationType = z.infer<typeof ConversationType>;

/** 当前用户对这个会话的个人状态（置顶、免打扰等，CHAT-01、CHAT-13）。 */
export const UserConversationState = z.object({
  pinned: z.boolean(),
  muted: z.boolean(),
  /** 从会话列表删除；收到新消息时自动恢复（CHAT-01 第 2 条）。 */
  hidden: z.boolean(),
  /** 清空聊天记录：seq 小于等于此值的消息不再显示（CHAT-13 第 8 条）；0 表示未清空。 */
  clearedThroughSeq: z.number().int().nonnegative(),
  /** 我读到的位置；未读数 = lastSeq - readSeq（不计我自己发的消息，服务器计算）。 */
  readSeq: z.number().int().nonnegative(),
  /** 用户手动「标为未读」；进入会话或标记已读后自动清除。 */
  markedUnread: z.boolean(),
  /**
   * 3.41：本人给这个会话单独设置的聊天背景（media.purpose = chat_background，只有本人能读）。
   * null / 旧响应不带 = 默认背景；只影响本人、只影响这个会话，清除即恢复默认。
   */
  backgroundMediaId: Id.nullable().optional(),
});
export type UserConversationState = z.infer<typeof UserConversationState>;

export const Conversation = z.object({
  conversationId: Id,
  type: ConversationType,
  /** 群名；私聊为 null（客户端显示角色名或备注）。 */
  title: z.string().max(40).nullable(),
  participants: z.array(Participant),
  contentScope: ContentScope,
  lastSeq: z.number().int().nonnegative(),
  lastMessage: MessagePreview.nullable(),
  state: UserConversationState,
  unreadCount: z.number().int().nonnegative(),
  /** 私聊：角色读到的位置，用于显示「已读」（CHAT-07）；群聊为 null（群聊不显示已读）。 */
  peerReadSeq: z.number().int().nonnegative().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** 3.0：群聊信息（SOC-03、SOC-06）；私聊为 null 或不返回。 */
  group: z
    .object({
      /** 拉群的角色（SOC-06）；用户自己建的群为 null。 */
      createdByCharacterId: Id.nullable(),
      /** 群名是否由用户改过；false 时客户端可按成员名拼接显示。 */
      titleCustomized: z.boolean(),
      /** 3.11：本人群聊头像；无值/旧响应回退成员拼图。 */
      avatarMediaId: Id.nullable().optional(),
      /** 角色成员上限（P-21）。 */
      memberLimit: z.number().int().positive(),
      /**
       * 3.0.1（T-063，次版本变更）：已退出 / 被移出的角色参与者，只用于渲染其历史消息的发送者头像与名字；
       * 不是群成员，不计入 participants 与上限。旧客户端忽略。
       */
      formerParticipants: z.array(Participant).optional(),
    })
    .nullable()
    .optional(),
});
export type Conversation = z.infer<typeof Conversation>;

// ---------- 请求 ----------

export const SendMessageRequest = z.object({
  clientMsgId: ClientMsgId,
  content: UserSendableContent,
  quoteMessageId: Id.nullable().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/** 送达确认：已送达 = 服务器已存好并分配了 seq。 */
export const MessageAck = z.object({
  clientMsgId: ClientMsgId,
  message: Message,
});
export type MessageAck = z.infer<typeof MessageAck>;

export const ListMessagesQuery = z
  .object({
    /** 取 seq 大于此值的消息（向新的方向，补拉用）。 */
    afterSeq: z.coerce.number().int().nonnegative().optional(),
    /** 取 seq 小于此值的消息（向旧的方向，上滑加载历史用）。 */
    beforeSeq: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((q) => !(q.afterSeq !== undefined && q.beforeSeq !== undefined), {
    message: 'afterSeq 与 beforeSeq 不能同时使用',
  });

export const UpdateConversationStateRequest = z.object({
  pinned: z.boolean().optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
  /** 3.41：设置 / 清除这个会话的聊天背景；null = 恢复默认。必须是本人上传的 chat_background 媒体。 */
  backgroundMediaId: Id.nullable().optional(),
});

// ---------- 接口 ----------

export const FORWARD_LIMITS = {
  messages: 50,
  targets: 10,
  textChars: 20_000,
  snapshotBytes: 524_288,
} as const;
export const ForwardMessagesRequest = z.object({
  clientRequestId: ClientMsgId,
  messageIds: z.array(Id).min(1).max(FORWARD_LIMITS.messages),
  targetConversationIds: z.array(Id).min(1).max(FORWARD_LIMITS.targets),
  mode: z.enum(['individual', 'merged']),
});
export type ForwardMessagesRequest = z.infer<typeof ForwardMessagesRequest>;
export const ForwardMessagesResponse = z.object({
  results: z.array(
    z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), conversationId: Id, messageIds: z.array(Id).min(1).max(50) }),
      z.object({
        ok: z.literal(false),
        conversationId: Id,
        error: z.string(),
        message: z.string(),
      }),
    ]),
  ),
});
export type ForwardMessagesResponse = z.infer<typeof ForwardMessagesResponse>;

export const ConversationParams = z.object({ conversationId: Id });
export const MessageParams = z.object({ conversationId: Id, messageId: Id });

/** 分页实际检查的seq范围；排除区间是已隐藏/清空的负记录，不含正文。 */
export const MessagePageCoverage = z
  .object({
    fromSeq: z.number().int().nonnegative(),
    throughSeq: z.number().int().nonnegative(),
    excludedRanges: z
      .array(
        z.object({
          fromSeq: Seq,
          throughSeq: Seq,
          reason: tolerantEnum(z.enum(['hidden', 'cleared'])),
        }),
      )
      .max(200),
  })
  .superRefine((value, ctx) => {
    if (value.fromSeq > value.throughSeq || (value.fromSeq === 0 && value.throughSeq !== 0))
      ctx.addIssue({ code: 'custom', message: '扫描范围必须有序；空范围为0/0' });
    if (value.throughSeq - value.fromSeq + 1 > 200)
      ctx.addIssue({ code: 'custom', message: '单页最多扫描200个seq' });
    for (const range of value.excludedRanges)
      if (
        range.fromSeq > range.throughSeq ||
        range.fromSeq < value.fromSeq ||
        range.throughSeq > value.throughSeq
      )
        ctx.addIssue({ code: 'custom', message: '排除区间必须位于扫描范围内' });
  });
export type MessagePageCoverage = z.infer<typeof MessagePageCoverage>;
export const MessagePage = z.object({
  items: z.array(Message),
  hasMore: z.boolean(),
  /** 2.1新增；旧客户端忽略，新同步引擎用它避免对合法空洞无限补拉。 */
  coverage: MessagePageCoverage.optional(),
});
export type MessagePage = z.infer<typeof MessagePage>;

export const ChatEndpoints = {
  forwardMessages: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/forward`,
    auth: 'user',
    params: ConversationParams,
    body: ForwardMessagesRequest,
    response: ForwardMessagesResponse,
    summary: '3.10：按真实可见源消息转发；每目标事务、请求幂等；单条强制逐条，合并记录不递归',
  }),
  listConversations: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations`,
    auth: 'user',
    response: z.object({ items: z.array(Conversation) }),
    summary:
      '会话列表（全量；增量变化走同步更新）。含用户隐藏的会话（state.hidden = true，客户端在会话列表里过滤，通讯录群聊等仍可找到）。客户端排序：置顶在前，其余按最后消息时间倒序',
  }),
  getConversation: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations/:conversationId`,
    auth: 'user',
    params: ConversationParams,
    response: Conversation,
    summary: '单个会话',
  }),
  listMessages: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations/:conversationId/messages`,
    auth: 'user',
    params: ConversationParams,
    query: ListMessagesQuery,
    response: MessagePage,
    summary: '按 seq 分页取消息（结果按 seq 升序）；不返回已被本人删除或已清空的消息',
  }),
  sendMessage: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/messages`,
    auth: 'user',
    params: ConversationParams,
    body: SendMessageRequest,
    response: MessageAck,
    summary:
      '发送消息（WebSocket 不可用时的等价路径）。同一 clientMsgId 重复提交返回同一条消息（幂等）；' +
      '10-25：在群聊里发新消息是 PRO+ 权益，非 PRO+ 返回 403 membership_required（查看历史不受限）',
  }),
  recallMessage: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/messages/:messageId/recall`,
    auth: 'user',
    params: MessageParams,
    response: Message,
    summary: '撤回自己的消息，限 P-23 时间内（CHAT-02 第 3 条）。超时 422 recall_window_expired',
  }),
  hideMessage: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/messages/:messageId/hide`,
    auth: 'user',
    params: MessageParams,
    response: NoContent,
    summary: '删除消息：只从本人视图删除（本人所有设备同步），角色记忆不受影响',
  }),
  markRead: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/read`,
    auth: 'user',
    params: ConversationParams,
    body: z.object({ readSeq: Seq }),
    response: NoContent,
    summary: '标记已读到某条（只前进不后退）',
  }),
  markUnread: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/unread`,
    auth: 'user',
    params: ConversationParams,
    response: NoContent,
    summary: '标为未读（CHAT-01 第 2 条）',
  }),
  updateState: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/conversations/:conversationId/state`,
    auth: 'user',
    params: ConversationParams,
    body: UpdateConversationStateRequest,
    response: UserConversationState,
    summary: '置顶、免打扰、从列表删除、当前会话聊天背景（backgroundMediaId，null = 恢复默认）',
  }),
  clearHistory: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/clear`,
    auth: 'user',
    params: ConversationParams,
    response: UserConversationState,
    summary: '清空聊天记录（只删显示，记忆和养成保留，CHAT-13 第 8 条）',
  }),
  listChargedMessages: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/messages/by-usage`,
    auth: 'user',
    body: z.object({ usageRecordIds: z.array(Id).min(1).max(100) }),
    response: z.object({ items: z.array(ChargedMessage) }),
    summary:
      'v3.3：按调用（LedgerEntry.usageRecordId）查对应消息的摘要与消耗积分（积分明细「每条消息」页）。只返回当前用户自己会话里的消息；查不到的 ID 不出现',
  }),
} as const;
