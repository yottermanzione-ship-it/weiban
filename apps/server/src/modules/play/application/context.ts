/**
 * play 各玩法共用的小工具：用户时区与当地日期、角色是否在通讯录、角色画像（选题 / 提议过滤用）、
 * 私聊会话与用户参与者、以用户 / 角色身份写卡片消息、data.changed 更新。
 * 只经对方模块的端口读取，不碰别人的表（R8）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  CharacterNameReadPort,
  CharacterReadPort,
  ChatParticipantPort,
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
import { CHAT_PARTICIPANT_PORT, CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { SYNC_PORT } from '../../realtime/index.js';

export const DEFAULT_TZ = 'Asia/Shanghai';
/** GRW-02：关系类型「恋人」。 */
export const LOVER_RELATIONSHIP = '恋人';

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
  ) {}

  /** 用户 IANA 时区（缺省 Asia/Shanghai）。 */
  async timeZone(userId: string, tx?: DbTx): Promise<string> {
    const profile = await this.identity.getProfile(userId, tx as Tx | undefined);
    return profile?.timeZone || DEFAULT_TZ;
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
    const [contact, classification] = await Promise.all([
      this.contacts.getActiveContact(userId, characterId, tx as Tx | undefined),
      this.characters.getClassification(characterId, tx as Tx | undefined),
    ]);
    // 读不到分类时按最严处理（儿童 + 真人 + 非恋人）。
    if (!classification) return { lover: false, child: true, realPerson: true };
    const child = classification.derived.isMinor;
    return {
      lover:
        !child &&
        classification.derived.romanceAllowed &&
        contact?.relationship === LOVER_RELATIONSHIP,
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
