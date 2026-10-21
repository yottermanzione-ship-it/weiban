/**
 * play 各玩法共用的小工具：用户时区与当地日期、角色是否在通讯录、角色画像（选题 / 提议过滤用）、
 * 私聊会话与用户参与者、以用户 / 角色身份写卡片消息、data.changed 更新。
 * 只经对方模块的端口读取，不碰别人的表（R8）。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  CharacterNameReadPort,
  CharacterReadPort,
  ChatAdminPort,
  ChatParticipantPort,
  PlaySystemNoticeCode,
  ChatReadPort,
  Contact,
  ContactsReadPort,
  DataSection,
  IdentityReadPort,
  Message,
  MessageContent,
  SyncPort,
  Tx,
} from '@weiban/contracts';
import { AppError, CLOCK, type Clock, type DbTx } from '../../../platform/index.js';
import { CHARACTER_NAME_READ_PORT, CHARACTER_READ_PORT } from '../../characters/index.js';
import { CHAT_ADMIN_PORT, CHAT_PARTICIPANT_PORT, CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { PLAY_FAMILIARITY, type PlayFamiliarity } from '../tokens.js';

export const DEFAULT_TZ = 'Asia/Shanghai';

/** 3.27（H1）：好感度「恋人」阶段（六阶段第 5 级）。 */
export const LOVER_STAGE = 5;

/** 选题、提议过滤用的角色画像（PLAY-03 第 3 条、PLAY-04 第 4 条）。 */
export interface CharacterTraits {
  /** 关系类型为恋人且角色允许恋爱（儿童角色永远 false）。 */
  lover: boolean;
  /** 儿童角色（只出「适合儿童」的题）。 */
  child: boolean;
  /** 真人角色（不出涉及真实工作行程的题，SAFE-02）。 */
  realPerson: boolean;
}

export function localDateIn(now: Date, timeZone: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  try {
    return fmt(timeZone);
  } catch {
    return fmt(DEFAULT_TZ);
  }
}

@Injectable()
export class PlayContext {
  constructor(
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(CONTACTS_READ_PORT) readonly contacts: ContactsReadPort,
    @Inject(CHARACTER_READ_PORT) private readonly characters: CharacterReadPort,
    @Inject(CHARACTER_NAME_READ_PORT) private readonly names: CharacterNameReadPort,
    @Inject(CHAT_READ_PORT) private readonly chatRead: ChatReadPort,
    @Inject(CHAT_PARTICIPANT_PORT) private readonly chat: ChatParticipantPort,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(CHAT_ADMIN_PORT) private readonly chatAdmin: ChatAdminPort,
    @Optional() @Inject(PLAY_FAMILIARITY) private readonly familiarity?: PlayFamiliarity,
  ) {}

  /** 用户 IANA 时区（缺省 Asia/Shanghai）。 */
  async timeZone(userId: string, tx?: DbTx): Promise<string> {
    const profile = await this.identity.getProfile(userId, tx as Tx | undefined);
    return profile?.timeZone || DEFAULT_TZ;
  }

  /** 用户的推送与免打扰设置（ACC-03）。 */
  async notificationSettings(userId: string, tx?: DbTx) {
    return this.identity.getNotificationSettings(userId, tx as Tx | undefined);
  }

  /** 用户昵称（「{称呼}」没有专属称呼时用）。 */
  async nickname(userId: string, tx?: DbTx): Promise<string | null> {
    return (await this.identity.getProfile(userId, tx as Tx | undefined))?.nickname ?? null;
  }

  /** 用户当地今天（YYYY-MM-DD）。 */
  async localToday(userId: string, tx?: DbTx): Promise<string> {
    return localDateIn(this.clock.now(), await this.timeZone(userId, tx));
  }

  /** 通讯录中有效的角色；不在通讯录（含已删除 30 天内）时抛 character_not_available。 */
  async requireActiveContact(userId: string, characterId: string, tx?: DbTx): Promise<Contact> {
    const contact = await this.contacts.getActiveContact(userId, characterId, tx as Tx | undefined);
    if (!contact) throw new AppError('character_not_available', '这个角色不在你的通讯录里');
    return contact;
  }

  async traits(userId: string, characterId: string, tx?: DbTx): Promise<CharacterTraits> {
    const [classification, level] = await Promise.all([
      this.characters.getClassification(characterId, tx as Tx | undefined),
      this.familiarity?.getFamiliarityLevel(userId, characterId).catch(() => null) ?? null,
    ]);
    // 读不到分类时按最严处理（儿童 + 真人 + 非恋人）。
    if (!classification) return { lover: false, child: true, realPerson: true };
    const child = classification.derived.isMinor;
    return {
      // 3.27（H1）：「恋人」只随好感度阶段（恋人阶段 = 5 起），不再看手选的关系类型。
      lover: !child && classification.derived.romanceAllowed && (level ?? 0) >= LOVER_STAGE,
      child,
      realPerson: classification.basis === 'real_person',
    };
  }

  /** 用户看到的角色名：备注优先。 */
  async characterName(userId: string, characterId: string, tx?: DbTx): Promise<string> {
    const contact = await this.contacts.getActiveContact(userId, characterId, tx as Tx | undefined);
    if (contact?.remark) return contact.remark;
    return (await this.names.getDisplayName(userId, characterId, tx as Tx | undefined)) ?? 'TA';
  }

  /**
   * 在用户与角色的私聊里写一条消息。sender = user 时幂等键必须是 UUID（客户端请求 ID）；
   * sender = character 时按 message-reliability.md 的约定自定。
   */
  async postToDirectChat(
    tx: DbTx,
    input: {
      userId: string;
      characterId: string;
      sender: 'user' | 'character';
      content: MessageContent;
      idempotencyKey: string;
      labels?: string[];
    },
  ): Promise<Message> {
    const conversation = await this.chatRead.findDirectConversation(
      input.userId,
      input.characterId,
    );
    if (!conversation) throw new AppError('character_not_available', '和这个角色的私聊不存在');
    const participant = conversation.participants.find((p) =>
      input.sender === 'user'
        ? p.kind === 'user' && p.refId === input.userId
        : p.kind === 'character' && p.refId === input.characterId,
    );
    if (!participant) throw new AppError('not_conversation_member', '不在这个私聊中');
    const result = await this.chat.postMessage(
      {
        conversationId: conversation.conversationId,
        senderParticipantId: participant.participantId,
        content: input.content,
        idempotencyKey: input.idempotencyKey,
        ...(input.labels ? { labels: input.labels } : {}),
      },
      tx as unknown as Tx,
    );
    if (!result.ok) {
      if (result.error === 'invalid_content')
        throw new AppError('bad_request', result.message ?? '消息格式不正确');
      throw new AppError('character_not_available', result.message ?? '无法写入私聊');
    }
    return result.value;
  }

  /**
   * 3.1（积压 ㊲）：玩法系统提示（PLAY_SYSTEM_NOTICE_CODES），经 ChatAdminPort.postSystemMessage 写进私聊，
   * 只对用户可见、不进模型上下文。没有私聊或写入失败时跳过（不影响玩法本身）。
   */
  async postPlayNotice(
    tx: DbTx,
    input: {
      userId: string;
      characterId: string;
      code: PlaySystemNoticeCode;
      params: Record<string, string | number | boolean>;
      idempotencyKey: string;
    },
  ): Promise<void> {
    const conversation = await this.chatRead
      .findDirectConversation(input.userId, input.characterId)
      .catch(() => null);
    if (!conversation) return;
    await this.chatAdmin.postSystemMessage(tx as unknown as Tx, {
      conversationId: conversation.conversationId,
      code: input.code,
      params: input.params,
      idempotencyKey: input.idempotencyKey.slice(0, 200),
    });
  }

  /** 「哪一块变了」通知（客户端重拉对应接口）。 */
  async dataChanged(
    tx: DbTx,
    userId: string,
    section: DataSection,
    characterId: string | null,
    itemId: string | null,
  ): Promise<void> {
    await this.sync.appendUpdate(tx as unknown as Tx, userId, {
      type: 'data.changed',
      data: { section, characterId, itemId },
    });
  }
}

/** 某个当地日期所在周的周一（YYYY-MM-DD）。 */
export function weekStartOf(localDate: string): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** 唯一索引冲突（PostgreSQL 23505），沿 cause 链查找。 */
export function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let i = 0; i < 4 && e; i++) {
    if ((e as { code?: string }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
