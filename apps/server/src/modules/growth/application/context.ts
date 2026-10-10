/**
 * growth 各服务共用的小工具（T-076）：用户当地日期、角色显示名、角色分类、会话内系统提示、data.changed 更新。
 * 只经对方模块的端口读取，不碰别人的表（R8）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  CharacterNameReadPort,
  CharacterReadPort,
  ChatAdminPort,
  ContactsReadPort,
  DataSection,
  IdentityReadPort,
  SyncPort,
  Tx,
} from '@weiban/contracts';
import { CLOCK, type Clock, type DbTx } from '../../../platform/index.js';
import { CHARACTER_NAME_READ_PORT, CHARACTER_READ_PORT } from '../../characters/index.js';
import { CHAT_ADMIN_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { todayInTz } from '../domain/familiarity-rules.js';

export type CharacterCategory =
  'celebrity' | 'historical' | 'private_person' | 'fictional' | 'original';

const DEFAULT_TZ = 'Asia/Shanghai';

@Injectable()
export class GrowthContext {
  constructor(
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(CONTACTS_READ_PORT) readonly contacts: ContactsReadPort,
    @Inject(CHARACTER_READ_PORT) private readonly characters: CharacterReadPort,
    @Inject(CHARACTER_NAME_READ_PORT) private readonly names: CharacterNameReadPort,
    @Inject(CHAT_ADMIN_PORT) private readonly chatAdmin: ChatAdminPort,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
  ) {}

  /** 用户 IANA 时区；用户不存在时返回 null。 */
  async timeZone(userId: string, tx?: DbTx): Promise<string | null> {
    const profile = await this.identity.getProfile(userId, tx as Tx | undefined);
    if (!profile) return null;
    return profile.timeZone || DEFAULT_TZ;
  }

  /** 用户当地今天（YYYY-MM-DD）。 */
  async localToday(userId: string, tx?: DbTx): Promise<string> {
    const tz = (await this.timeZone(userId, tx)) ?? DEFAULT_TZ;
    return this.todayIn(tz);
  }

  todayIn(timeZone: string): string {
    try {
      return todayInTz(this.clock.now(), timeZone);
    } catch {
      return todayInTz(this.clock.now(), DEFAULT_TZ);
    }
  }

  /** 用户看到的角色名：备注优先。 */
  async characterName(userId: string, characterId: string, tx?: DbTx): Promise<string> {
    const contact = await this.contacts.getActiveContact(userId, characterId, tx as Tx | undefined);
    if (contact?.remark) return contact.remark;
    return (await this.names.getDisplayName(userId, characterId, tx as Tx | undefined)) ?? 'TA';
  }

  /**
   * 角色分类（节日适用范围）与卡面是否只能用无人物模板（GRW-05 第 2 条：真人角色不出现人物肖像；
   * 历史人物允许古风插画，但素材库只有「是否含人物」一个标记，保守起见同样只用无人物模板）。
   */
  async classify(
    characterId: string,
    tx?: DbTx,
  ): Promise<{ category: CharacterCategory; portraitFreeOnly: boolean }> {
    // 3.1（积压 ㉓）：历史人物优先古风模板（cards.service pickFace），没有古风模板时仍只用无人物模板。
    const c = await this.characters.getClassification(characterId, tx as Tx | undefined);
    if (!c) return { category: 'private_person', portraitFreeOnly: true };
    const category: CharacterCategory =
      c.basis === 'real_person'
        ? ((c.realPersonKind ?? 'private_person') as CharacterCategory)
        : (c.basis as CharacterCategory);
    return { category, portraitFreeOnly: c.derived.portraitPolicy !== 'allowed' };
  }

  /** 在用户与角色的私聊里写一条系统提示（不打断聊天，GRW-05 / 设计 C 4.4）。没有私聊时跳过。 */
  async postSystem(
    tx: DbTx,
    userId: string,
    characterId: string,
    code: string,
    params: Record<string, string | number | boolean>,
    idempotencyKey: string,
  ): Promise<void> {
    const contact = await this.contacts.getActiveContact(userId, characterId, tx);
    if (!contact?.conversationId) return;
    await this.chatAdmin.postSystemMessage(tx, {
      conversationId: contact.conversationId,
      code,
      params,
      idempotencyKey: `growth:${idempotencyKey}`.slice(0, 200),
    });
  }

  /** 多设备同步：「这一块变了」，客户端重新拉对应接口。 */
  async dataChanged(
    tx: DbTx,
    userId: string,
    section: DataSection,
    characterId: string | null,
    itemId: string | null,
  ): Promise<void> {
    await this.sync.appendUpdate(tx, userId, {
      type: 'data.changed',
      data: { section, characterId, itemId },
    });
  }
}
