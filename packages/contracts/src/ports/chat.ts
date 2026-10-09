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

export interface ChatReadPort {
  getConversation(conversationId: string, tx?: Tx): Promise<Conversation | null>;
  getParticipants(conversationId: string): Promise<Participant[]>;
  /** 找到用户与某角色的私聊会话。 */
  findDirectConversation(userId: string, characterId: string): Promise<Conversation | null>;
  /** 结果按 seq 升序；不含正文被撤回的内容。 */
  readMessages(input: ReadMessagesInput): Promise<Message[]>;
  getMessage(messageId: string, scopes: ContentScope[]): Promise<Message | null>;
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
   * 目前唯一已定义取值：'health'（使用了经期数据生成，PLAY-01 / health-data.md 第 5 节）。
   * 传入此字段后 chat 会原样写入 Message.labels 并随消息下发；
   * 只有通过此端口发送的消息才能携带，用户经 HTTP / WebSocket 发送的消息不能带。
   * 不认识的标签客户端忽略，不报错。
   */
  labels?: string[];
}

export type PostMessageError =
  'conversation_not_found' | 'not_conversation_member' | 'invalid_content';

/** 以参与者身份说话：AI 运行时用它让角色发言、已读、正在输入、撤回（人设小巧思）。 */
export interface ChatParticipantPort {
  postMessage(input: PostMessageInput, tx?: Tx): Promise<PortResult<Message, PostMessageError>>;
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
   * 创建或找回用户与角色的私聊（幂等：已存在则返回原会话）。
   * restoreHistory = false 时（重新认识）旧会话的消息不再显示。
   */
  ensureDirectConversation(
    tx: Tx,
    input: { userId: string; characterId: string; restoreHistory: boolean },
  ): Promise<Conversation>;
  /** contacts 删除好友：停止收发并隐藏会话，保留历史供30天内恢复。 */
  archiveDirectConversation(tx: Tx, input: { userId: string; characterId: string }): Promise<void>;
  /** contacts 立即删除/保留期到期：物理清除该私聊；下一次添加创建新会话。 */
  purgeDirectConversation(tx: Tx, input: { userId: string; characterId: string }): Promise<void>;
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
    senderKind: 'user' | 'character' | 'system';
    senderRefId: string | null;
    recipientParticipantId: string;
    muted: boolean;
    content: MessageContent | null;
  } | null>;
}
