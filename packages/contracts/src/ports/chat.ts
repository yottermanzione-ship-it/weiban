/**
 * chat 模块提供的端口。chat 不知道调用者是不是 AI——它只认「参与者」。
 */
import type {
  ContentScope,
  Conversation,
  Message,
  MessageContent,
  Participant,
  SendMessageRequest,
  MessageAck,
  CallTranscriptTurn,
} from '../http/chat.js';
import type { PortResult, Tx } from './common.js';

/** 读消息必须声明可见范围（内容范围标签，见 docs/architecture/hard-boundaries.md）。 */
export interface ReadMessagesInput {
  conversationId: string;
  /** 必填。仅同用户同角色的私聊回复上下文可在当前角色仍具资格时读adult历史（即使当前回到normal）；其他用途只能传 ['normal']，见runtime-overview 4.1与hard-boundaries。 */
  scopes: ContentScope[];
  afterSeq?: number;
  beforeSeq?: number;
  limit: number;
  /** 3.0（CR-21）：排除带任一标签的消息，例 ['health']（记忆整理、名场面、分享图）。 */
  excludeLabels?: string[];
  /** 3.0（AI 变更申请第 2 条）：排除指定消息（记忆删除后上下文跳过来源消息）。 */
  excludeMessageIds?: string[];
  /** 3.0：只取这些内容类型，例 ['text', 'voice']；不传为全部。 */
  contentTypes?: string[];
}

/**
 * 每个方法的可选 tx（5.7 起全部方法都有）：
 * - **调用方拿着事务时必须传**（docs/backend/kernel.md「事务与端口」）。不传时 chat 另开一条连接、自己开事务读，
 *   如果调用方事务已经锁过 / 改过同一会话行，外层等内层返回、内层等外层提交，数据库看不出来，整站卡死
 *   （2026-11-04 事故）。
 * - 传 tx 时在调用方事务里执行，除 getParticipants 外都会锁会话行（FOR UPDATE）到调用方事务结束，
 *   所以要在本模块自己的锁（咨询锁、联系人行等）之后再调，顺序见 kernel.md。
 * - 不传 tx 时行为与 5.6 相同。
 */
export interface ChatReadPort {
  /** 传 tx：锁会话行（FOR UPDATE）。 */
  getConversation(conversationId: string, tx?: Tx): Promise<Conversation | null>;
  /**
   * 会话当前参与者（不含已退出的）；会话不存在为 []。
   * 5.7：传 tx 时在调用方事务里读，**不锁会话行**（只读参与者，给只需要知道「对面是谁」的订阅者用）。
   */
  getParticipants(conversationId: string, tx?: Tx): Promise<Participant[]>;
  /**
   * 找到用户与某角色的私聊会话。
   * 5.7：传 tx 时锁会话行用 FOR UPDATE（调用方随后通常要写这个会话；先拿共享锁再升级会和并发写入方互相等待）；
   * 不传时独立事务、FOR SHARE。
   */
  findDirectConversation(
    userId: string,
    characterId: string,
    tx?: Tx,
  ): Promise<Conversation | null>;
  /**
   * 找到用户的小V同学官方会话（按 official_identity_key）。没有则返回 null，
   * 不创建（创建走 ChatAdminPort.ensureOfficialConversation）。
   * 5.7：tx 的锁法同 findDirectConversation。
   */
  findOfficialConversation(userId: string, tx?: Tx): Promise<Conversation | null>;
  /** 结果按 seq 升序；不含正文被撤回的内容。5.7：可传 tx（锁会话行）。 */
  readMessages(input: ReadMessagesInput, tx?: Tx): Promise<Message[]>;
  /** 可选事务用于派生资料写入前锁定并核对来源，防止撤回与迟到写入交错。 */
  getMessage(messageId: string, scopes: ContentScope[], tx?: Tx): Promise<Message | null>;
}

/** 3.0：群聊读取（提供方 chat，调用方 ai-runtime）。与 ChatReadPort 分开，避免改动已有实现。 */
export interface ChatGroupReadPort {
  /** 3.0：用户的群聊（可按某角色是否在群内过滤），供群聊调度、拉群去重（SOC-06 第 2 条）使用。 */
  listGroupConversations(
    userId: string,
    filter?: { memberCharacterId?: string; exactMemberCharacterIds?: string[] },
  ): Promise<Conversation[]>;
  /** 3.0：用户在该会话最后一次发言时间（SOC-05 第 2 条「7 天内用户发过言」）。 */
  getLastUserMessageAt(conversationId: string): Promise<string | null>;
}

export interface PostMessageInput {
  conversationId: string;
  senderParticipantId: string;
  content: MessageContent;
  /**
   * 幂等键，必填。同一发送者同一键只会产生一条消息。
   * 角色回复约定：`reply:{触发消息ID}:{气泡序号}`（见 message-reliability.md 第 5 节）。
   */
  idempotencyKey: string;
  quoteMessageId?: string;
  /** AI缓存发送时核对当前内容范围，防止模式切换后错盖章。 */
  expectedScope?: ContentScope;
  /**
   * 服务器端标签（v2.5 新增）。
   * 已定义取值：'health'（经期数据）、'self_chat'（群里角色自己聊）、
   * 'quirk_draft'（角色即将撤回的初稿，不推送、不进入长期记忆）。
   * 传入此字段后 chat 会原样写入 Message.labels 并随消息下发；
   * 只有通过此端口发送的消息才能携带，用户经 HTTP / WebSocket 发送的消息不能带。
   * 不认识的标签客户端忽略，不报错。
   */
  labels?: string[];
  /**
   * v3.3（积分制）：生成这条消息的调用消耗（ai-runtime 从 GenerateTextOutput 取得）。chat 原样记在消息上，
   * 下发为 Message.pointsCost / usageRecordId。一次回复拆成多个气泡时只在第一个气泡上传。
   */
  charge?: { usageRecordId: string | null; chargedMicros: number };
}

export type PostMessageError =
  'conversation_not_found' | 'not_conversation_member' | 'invalid_content';

/** 以参与者身份说话：AI 运行时用它让角色发言、已读、正在输入、撤回（人设小巧思）。 */
export interface ChatParticipantPort {
  postMessage(input: PostMessageInput, tx?: Tx): Promise<PortResult<Message, PostMessageError>>;
  /** 7.2：只给服务器通话收尾使用；更新既有记录而不新增消息或触发回复。调用方先锁用户/联系人，再传事务。 */
  attachCallTranscript(
    tx: Tx,
    input: {
      userId: string;
      characterId: string;
      conversationId: string;
      callId: string;
      scope: ContentScope;
      turns: CallTranscriptTurn[];
      /** 使用过健康私密提示的电话不进入长期整理/共享。 */
      healthUsed?: boolean;
    },
  ): Promise<Message | null>;
  /** 标记某参与者读到第几条（角色已读，CHAT-07）。只前进不后退。 */
  markRead(input: {
    conversationId: string;
    participantId: string;
    readSeq: number;
  }): Promise<void>;
  /** 正在输入：只实时转发，不落库（CHAT-06）。 */
  setTyping(input: {
    conversationId: string;
    participantId: string;
    state: 'start' | 'stop';
  }): Promise<void>;
  /** 撤回某参与者自己发的消息（角色撤回重发，CHAT-08）。 */
  recall(input: {
    conversationId: string;
    participantId: string;
    messageId: string;
  }): Promise<PortResult<Message, 'not_found' | 'not_sender'>>;
}

/** 会话管理：供 contacts（添加角色后建私聊）、ai-runtime（设置内容范围）等模块使用。 */
export interface ChatAdminPort {
  /**
   * 创建或找回用户与小V同学的官方会话（幂等：已存在则返回原会话，含已归档的恢复）。
   * 官方会话永不删重建（旧版占位卡误删归档的教训）：已归档只恢复、保留全部历史。
   * 不发欢迎语——欢迎语由官方模块在首次创建后单独发（幂等键去重），避免多触发点重复发。
   */
  ensureOfficialConversation(tx: Tx, input: { userId: string }): Promise<Conversation>;
  /**
   * 创建或找回用户与角色的私聊（幂等：已存在则返回原会话）。
   * restoreHistory = false 时（重新认识）旧会话的消息不再显示。
   */
  ensureDirectConversation(
    tx: Tx,
    input: {
      userId: string;
      characterId: string;
      restoreHistory: boolean;
      trialExpiresAt?: string;
    },
  ): Promise<Conversation>;
  /** contacts 删除好友：停止收发并隐藏会话，保留历史供30天内恢复。 */
  archiveDirectConversation(tx: Tx, input: { userId: string; characterId: string }): Promise<void>;
  /** contacts 立即删除/保留期到期：物理清除该私聊；下一次添加创建新会话。 */
  purgeDirectConversation(tx: Tx, input: { userId: string; characterId: string }): Promise<void>;
  /**
   * contacts 重置角色：保留会话行、删除全部消息行、会话状态归零（未读/清空游标归零，
   * 置顶/免打扰/背景重置为默认值，archivedAt 清空）；lastSeq 不回退。只发 state_updated /
   * updated，不发 conversation.removed / contact.removed。
   */
  clearDirectConversation(tx: Tx, input: { userId: string; characterId: string }): Promise<void>;
  /** 写一条系统提示（如「XX 通过了你的好友申请」）。幂等键规则同 postMessage。 */
  postSystemMessage(
    tx: Tx | null,
    input: {
      conversationId: string;
      code: string;
      params?: Record<string, string | number | boolean>;
      idempotencyKey: string;
    },
  ): Promise<Message>;
  /**
   * 设置会话内容范围。调用方（ai-runtime）只有在 policy 判定通过后才可设为 adult；
   * 群聊按成员资格开放情景模式（PRD v1.2 SOC-03 第 4 条），chat 不区分私聊群聊。
   * 之后写入的消息按此盖章（内容范围标签）。v1.0：去掉 group_conversation 错误。
   */
  setContentScope(
    input: {
      conversationId: string;
      scope: ContentScope;
    },
    tx?: Tx,
  ): Promise<PortResult<void, 'not_found' | 'adult_mode_not_eligible'>>;
}

/**
 * 3.0：群聊管理（SOC-03、SOC-06）。提供方 chat；调用方 ai-runtime（角色拉群、角色提议改群名）、contacts（彻底删除角色时移出其所在群）。
 * 群里的系统提示（group_created、member_joined、member_removed、group_renamed、group_invited_by_character）由 chat 自己写。
 */
export interface ChatGroupAdminPort {
  /** 创建群（幂等键相同返回同一个群）。characterIds 不含用户；createdByCharacterId 为拉群者（SOC-06），用户建群为 null。 */
  createGroupConversation(
    tx: Tx | null,
    input: {
      ownerUserId: string;
      characterIds: string[];
      title: string | null;
      createdByCharacterId: string | null;
      idempotencyKey: string;
    },
  ): Promise<PortResult<Conversation, 'limit_reached' | 'invalid_members'>>;
  addGroupMembers(
    tx: Tx | null,
    input: { conversationId: string; characterIds: string[]; byCharacterId: string | null },
  ): Promise<PortResult<Conversation, 'not_found' | 'limit_reached'>>;
  /** 角色按人设提议改群名（SOC-03 第 2 条）。 */
  renameGroup(
    tx: Tx | null,
    input: { conversationId: string; title: string; byCharacterId: string | null },
  ): Promise<PortResult<Conversation, 'not_found'>>;
  /** contacts 彻底删除角色时：把该角色移出用户的所有群（不写「你将 XX 移出了群聊」，写 member_left）。 */
  removeCharacterFromUserGroups(
    tx: Tx,
    input: { userId: string; characterId: string },
  ): Promise<void>;
}

/**
 * 年度回忆（10-25）用的只读聚合。提供方 chat，调用方 recap。
 *
 * 只返回数字、日期、会话 / 角色 id：**不返回任何消息正文**，也不把 adult 内容交给调用方。
 * 可见口径与 ChatRead 一致（只要用户此刻真的能看到那条消息）：排除系统提示、已撤回、私密范围、
 * 本人隐藏、本人已清空、health / quirk_draft 标签；不按「归档」排除，因为归档会话用户仍能打开读。
 */
export interface ChatRecapWindow {
  /** 含头不含尾（UTC ISO）。 */
  fromIso: string;
  toIso: string;
}

/** 夜间候选：按夜间时间轴排序，交给调用方决定「最深的一晚」。 */
export interface ChatRecapNightCandidate {
  /** 真实发送日期（北京日期）。 */
  date: string;
  /** 真实发送时刻 HH:mm（北京时间）。 */
  time: string;
  /** 夜间时间轴上的分钟数：22:00 = 0，23:59 = 119，次日 00:00 = 120，次日 03:15 = 315。 */
  nightOffsetMinutes: number;
  conversationId: string;
  characterId: string | null;
  /** 真实发送时刻（用于同分排序）。 */
  atIso: string;
}

export interface ChatRecapAggregates {
  totalMessages: number;
  userMessages: number;
  characterMessages: number;
  groupMessages: number;
  directMessages: number;
  characterCount: number;
  activeDays: number;
  monthlyUserMessages: Array<{ month: number; count: number }>;
  topCharacters: Array<{ characterId: string; userMessages: number; lastMessageAt: string }>;
  busiestDays: Array<{ date: string; userMessages: number; totalMessages: number }>;
  /** 夜间候选（最多 10 条，已按夜间时间轴降序）；没有夜间消息时为空数组。 */
  nightCandidates: ChatRecapNightCandidate[];
  nightCount: number;
  /** 有「你」发言的北京日期（YYYY-MM-DD，升序，最多 366 个）。 */
  activeDates: string[];
  /** 其中从旧版迁移来的消息条数（旧站 created_at 可能是 UTC；缺真实时间的记录不能当精确日期）。 */
  migratedMessages: number;
}

export interface ChatRecapReadPort {
  /** 窗口内有可见消息的候选用户（按 user id 升序分页），供年度批量生成使用。 */
  recapCandidates(
    input: ChatRecapWindow & { afterUserId?: string; limit: number },
  ): Promise<{ userIds: string[] }>;
  /** 某个用户在窗口内的可见消息聚合。 */
  recapAggregates(userId: string, window: ChatRecapWindow): Promise<ChatRecapAggregates>;
}

/** 提供方 chat；组合根把 WS 与 HTTP 连接到同一用户发送处理器。 */
export interface ChatUserPort {
  sendMessage(
    userId: string,
    conversationId: string,
    input: SendMessageRequest,
  ): Promise<MessageAck>;
}

/** 通知专用读取：按接收者的隐藏/清空/已读状态检查；adult正文永不读取。 */
export interface ChatNotificationReadPort {
  getNotificationContext(
    userId: string,
    messageId: string,
    tx?: Tx,
  ): Promise<{
    conversationId: string;
    conversationType: 'direct' | 'group';
    seq: number;
    scope: ContentScope;
    senderKind: 'user' | 'character' | 'official' | 'system';
    senderRefId: string | null;
    recipientParticipantId: string;
    muted: boolean;
    content: MessageContent | null;
    /** 3.0.1：服务器标签（health、self_chat 等），推送据此决定是否显示正文、是否推送。 */
    labels?: string[];
  } | null>;
}
