/**
 * chat 模块提供的端口。chat 不知道调用者是不是 AI——它只认「参与者」。
 */
import type { ContentScope, Conversation, Message, MessageContent, Participant } from '../http/chat.js';
import type { PortResult, Tx } from './common.js';

/** 读消息必须声明可见范围（内容范围标签，见 docs/architecture/hard-boundaries.md）。 */
export interface ReadMessagesInput {
  conversationId: string;
  /** 必填。除「成人模式私聊内生成回复」外，调用方只能传 ['normal']。 */
  scopes: ContentScope[];
  afterSeq?: number;
  beforeSeq?: number;
  limit: number;
}

export interface ChatReadPort {
  getConversation(conversationId: string): Promise<Conversation | null>;
  getParticipants(conversationId: string): Promise<Participant[]>;
  /** 找到用户与某角色的私聊会话。 */
  findDirectConversation(userId: string, characterId: string): Promise<Conversation | null>;
  /** 结果按 seq 升序；不含正文被撤回的内容。 */
  readMessages(input: ReadMessagesInput): Promise<Message[]>;
  getMessage(messageId: string, scopes: ContentScope[]): Promise<Message | null>;
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
}

export type PostMessageError = 'conversation_not_found' | 'not_conversation_member' | 'invalid_content';

/** 以参与者身份说话：AI 运行时用它让角色发言、已读、正在输入、撤回（人设小巧思）。 */
export interface ChatParticipantPort {
  postMessage(input: PostMessageInput): Promise<PortResult<Message, PostMessageError>>;
  /** 标记某参与者读到第几条（角色已读，CHAT-07）。只前进不后退。 */
  markRead(input: { conversationId: string; participantId: string; readSeq: number }): Promise<void>;
  /** 正在输入：只实时转发，不落库（CHAT-06）。 */
  setTyping(input: { conversationId: string; participantId: string; state: 'start' | 'stop' }): Promise<void>;
  /** 撤回某参与者自己发的消息（角色撤回重发，CHAT-08）。 */
  recall(input: { conversationId: string; participantId: string; messageId: string }): Promise<PortResult<Message, 'not_found' | 'not_sender'>>;
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
  /** 写一条系统提示（如「XX 通过了你的好友申请」）。幂等键规则同 postMessage。 */
  postSystemMessage(
    tx: Tx | null,
    input: { conversationId: string; code: string; params?: Record<string, string | number | boolean>; idempotencyKey: string },
  ): Promise<Message>;
  /**
   * 设置会话内容范围。只有在 policy 判定通过后才允许设为 adult；群聊只能是 normal。
   * 之后写入的消息按此盖章（内容范围标签）。
   */
  setContentScope(input: { conversationId: string; scope: ContentScope }): Promise<PortResult<void, 'group_conversation' | 'not_found'>>;
}
