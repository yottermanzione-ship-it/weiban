/**
 * 群聊（SOC-03、SOC-06，T-063）。群会话沿用 conversations（type = 'group'），成员沿用 participants：
 * - 移出 / 退出的成员保留参与者行并写 left_at，历史消息仍能渲染发送者（Conversation.group.formerParticipants）；
 * - 群消息仍走 ChatWriteService：seq、幂等、补拉、已读游标与私聊完全一致；
 * - 群的情景模式、自己聊天、秒回归 ai-runtime（GroupCompanionEndpoints），chat 只提供数据与系统提示。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, isNull, max } from 'drizzle-orm';
import {
  CreateGroupRequest,
  GROUP_MEMBER_LIMIT,
  GROUP_MIN_CHARACTERS,
  Id,
  type ChatGroupAdminPort,
  type ChatGroupReadPort,
  type Conversation,
  type PortResult,
  type SyncPort,
  type Tx,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  asDbTx,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import {
  conversations,
  messages,
  participants,
  userConversationStates,
} from '../infra/db/schema.js';
import { CHAT_GROUP_DIRECTORY, type ChatGroupDirectory } from '../tokens.js';
import { ChatStore, type ConversationRow } from './store.js';
import { ChatWriteService } from './write.js';

type ParticipantRow = typeof participants.$inferSelect;
const TITLE_MAX = 40;

@Injectable()
export class ChatGroupService implements ChatGroupAdminPort, ChatGroupReadPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ChatStore) private readonly store: ChatStore,
    @Inject(ChatWriteService) private readonly writer: ChatWriteService,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Optional()
    @Inject(CHAT_GROUP_DIRECTORY)
    private readonly groupDirectory: ChatGroupDirectory | null,
  ) {}

  // ---------- 依赖 ----------

  private directory(): ChatGroupDirectory {
    if (!this.groupDirectory) throw new AppError('service_unavailable', '群聊通讯录服务未装配');
    return this.groupDirectory;
  }
  private async name(tx: DbTx, userId: string, characterId: string): Promise<string> {
    return (await this.directory().displayName(userId, characterId, tx)) ?? '角色';
  }
  private async run<T>(transaction: Tx | null | undefined, action: (tx: DbTx) => Promise<T>) {
    return transaction ? action(asDbTx(transaction)) : this.db.transaction(action);
  }

  // ---------- 用户接口（ChatGroupEndpoints） ----------

  async createForUser(userId: string, input: unknown): Promise<Conversation> {
    const body = parseContract(CreateGroupRequest, input);
    const result = await this.createGroupConversation(null, {
      ownerUserId: userId,
      characterIds: body.characterIds,
      title: body.title ?? null,
      createdByCharacterId: null,
      idempotencyKey: `user:${body.clientRequestId}`,
    });
    if (!result.ok) {
      if (result.error === 'limit_reached')
        throw new AppError('limit_reached', result.message ?? '群成员已达上限', {
          details: { limit: GROUP_MEMBER_LIMIT },
        });
      throw new AppError('bad_request', result.message ?? '群成员不正确');
    }
    return result.value;
  }
  async renameForUser(
    userId: string,
    conversationId: string,
    title: string | null,
  ): Promise<Conversation> {
    return this.db.transaction(async (tx) => {
      const row = await this.loadGroup(tx, conversationId, userId);
      // 3.0.1：空字符串或 null = 恢复默认名（成员名拼接，之后随成员变化自动更新）。
      if (!title?.trim()) return this.resetTitleTx(tx, row);
      return this.renameTx(tx, row, title, null);
    });
  }
  async addForUser(
    userId: string,
    conversationId: string,
    characterIds: string[],
  ): Promise<Conversation> {
    return this.db.transaction(async (tx) => {
      const row = await this.loadGroup(tx, conversationId, userId);
      const result = await this.addTx(tx, row, characterIds, null);
      if (!result.ok)
        throw new AppError('limit_reached', result.message ?? '群成员已达上限', {
          details: { limit: GROUP_MEMBER_LIMIT },
        });
      return result.value;
    });
  }
  async removeForUser(
    userId: string,
    conversationId: string,
    characterId: string,
  ): Promise<Conversation> {
    parseContract(Id, characterId);
    return this.db.transaction(async (tx) => {
      const row = await this.loadGroup(tx, conversationId, userId);
      const member = await this.activeCharacter(tx, row.id, characterId);
      if (!member) throw new AppError('not_found', '该角色不在群里');
      return this.leaveTx(tx, row, member, 'member_removed', 'user');
    });
  }
  /** 删除并退出 = 解散（SOC-03 第 3 条）：会话与消息物理删除。重复调用视为成功。 */
  async dissolveForUser(userId: string, conversationId: string): Promise<void> {
    parseContract(Id, conversationId);
    await this.db.transaction(async (tx) => {
      let row: ConversationRow;
      try {
        row = await this.store.load(tx, conversationId, userId);
      } catch (error) {
        if (error instanceof AppError && error.code === 'not_found') return;
        throw error;
      }
      if (row.type !== 'group') throw new AppError('not_group_conversation', '这不是群聊');
      const members = await this.activeMembers(tx, row.id);
      // 先让客户端把会话藏起来（契约没有「会话删除」更新类型，与私聊彻底删除的做法一致），再物理删除。
      await tx.db
        .update(userConversationStates)
        .set({ hidden: true, clearedThroughSeq: row.lastSeq, markedUnread: false })
        .where(eq(userConversationStates.conversationId, row.id));
      const conversation = await this.store.conversation(tx, row);
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.state_updated',
        data: {
          conversationId: row.id,
          state: conversation.state,
          unreadCount: conversation.unreadCount,
        },
      });
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.updated',
        data: { conversation },
      });
      await tx.db.delete(conversations).where(eq(conversations.id, row.id));
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.removed',
        data: { conversationId: row.id, reason: 'group_dissolved' },
      });
      await this.outbox.publish(tx, 'chat.group_dissolved', 'chat', {
        conversationId: row.id,
        ownerUserId: row.ownerUserId,
        createdByCharacterId: row.createdByCharacterId,
        memberCharacterIds: members.filter((m) => m.kind === 'character').map((m) => m.refId),
      });
    });
  }

  // ---------- ChatGroupAdminPort ----------

  async createGroupConversation(
    transaction: Tx | null,
    input: Parameters<ChatGroupAdminPort['createGroupConversation']>[1],
  ): Promise<PortResult<Conversation, 'limit_reached' | 'invalid_members'>> {
    parseContract(Id, input.ownerUserId);
    if (input.createdByCharacterId !== null) parseContract(Id, input.createdByCharacterId);
    if (
      typeof input.idempotencyKey !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(input.idempotencyKey)
    )
      throw new AppError('bad_request', '建群幂等键不正确');
    const ids = [...new Set(input.characterIds.map((id) => parseContract(Id, id)))];
    const title = input.title === null ? null : input.title.trim().slice(0, TITLE_MAX) || null;
    return this.run(transaction, async (tx) => {
      const owner = input.ownerUserId;
      await this.store.requireActive(tx, owner);
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('chat:group-create:' || $1 || ':' || $2,0))",
        [owner, input.idempotencyKey],
      );
      const [existing] = await tx.db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.ownerUserId, owner),
            eq(conversations.createKey, input.idempotencyKey),
          ),
        );
      if (existing) return { ok: true, value: await this.store.conversation(tx, existing) };
      if (ids.length > GROUP_MEMBER_LIMIT)
        return {
          ok: false,
          error: 'limit_reached',
          message: `群里最多 ${GROUP_MEMBER_LIMIT} 个角色`,
        };
      if (ids.length < GROUP_MIN_CHARACTERS)
        return {
          ok: false,
          error: 'invalid_members',
          message: `至少选择 ${GROUP_MIN_CHARACTERS} 个角色`,
        };
      if (input.createdByCharacterId && !ids.includes(input.createdByCharacterId))
        return { ok: false, error: 'invalid_members', message: '拉群的角色必须在群里' };
      const directory = this.directory();
      for (const id of ids)
        if (!(await directory.isActiveContact(owner, id, tx)))
          return { ok: false, error: 'invalid_members', message: '只能选择通讯录中的角色' };
      const names: string[] = [];
      for (const id of ids) names.push(await this.name(tx, owner, id));
      const at = this.clock.now();
      const conversationId = newId();
      const [row] = await tx.db
        .insert(conversations)
        .values({
          id: conversationId,
          ownerUserId: owner,
          type: 'group',
          characterId: null,
          title: title ?? defaultTitle(names),
          titleCustomized: title !== null,
          createdByCharacterId: input.createdByCharacterId,
          createKey: input.idempotencyKey,
          systemParticipantId: newId(),
          contentScope: 'normal',
          lastSeq: 0,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      if (!row) throw new AppError('internal_error', '群聊未能创建');
      await tx.db.insert(participants).values([
        { id: newId(), conversationId, kind: 'user', refId: owner, joinedAt: at, readSeq: 0 },
        ...ids.map((refId) => ({
          id: newId(),
          conversationId,
          kind: 'character',
          refId,
          joinedAt: at,
          readSeq: 0,
        })),
      ]);
      await tx.db.insert(userConversationStates).values({ conversationId, userId: owner });
      const created = await this.store.conversation(tx, row);
      await this.sync.appendUpdate(tx, owner, {
        type: 'conversation.created',
        data: { conversation: created },
      });
      await this.outbox.publish(tx, 'chat.conversation_created', 'chat', {
        conversationId,
        type: 'group',
        participants: created.participants.map((p) => ({
          participantId: p.participantId,
          kind: p.kind,
          refId: p.refId,
        })),
      });
      await this.outbox.publish(tx, 'chat.group_members_changed', 'chat', {
        conversationId,
        ownerUserId: owner,
        addedCharacterIds: ids,
        removedCharacterIds: [],
        cause: input.createdByCharacterId ? 'character' : 'created',
        byCharacterId: input.createdByCharacterId,
      });
      const byName = input.createdByCharacterId
        ? names[ids.indexOf(input.createdByCharacterId)]!
        : null;
      await this.system(
        tx,
        row,
        input.createdByCharacterId ? 'group_invited_by_character' : 'group_created',
        {
          names: names.join('、'),
          characterIds: ids.join(','),
          ...(byName && input.createdByCharacterId
            ? { name: byName, characterId: input.createdByCharacterId }
            : {}),
        },
        `group_created:${conversationId}`,
      );
      return { ok: true, value: await this.reload(tx, row.id) };
    });
  }
  async addGroupMembers(
    transaction: Tx | null,
    input: Parameters<ChatGroupAdminPort['addGroupMembers']>[1],
  ): Promise<PortResult<Conversation, 'not_found' | 'limit_reached'>> {
    return this.run(transaction, async (tx) => {
      const row = await this.tryLoadGroup(tx, input.conversationId);
      if (!row) return { ok: false, error: 'not_found', message: '群聊不存在' };
      if (input.byCharacterId) {
        parseContract(Id, input.byCharacterId);
        if (!(await this.activeCharacter(tx, row.id, input.byCharacterId)))
          return { ok: false, error: 'not_found', message: '拉人的角色不在群里' };
      }
      return this.addTx(tx, row, input.characterIds, input.byCharacterId);
    });
  }
  async renameGroup(
    transaction: Tx | null,
    input: Parameters<ChatGroupAdminPort['renameGroup']>[1],
  ): Promise<PortResult<Conversation, 'not_found'>> {
    return this.run(transaction, async (tx) => {
      const row = await this.tryLoadGroup(tx, input.conversationId);
      if (!row) return { ok: false, error: 'not_found', message: '群聊不存在' };
      if (input.byCharacterId) {
        parseContract(Id, input.byCharacterId);
        if (!(await this.activeCharacter(tx, row.id, input.byCharacterId)))
          return { ok: false, error: 'not_found', message: '改名的角色不在群里' };
      }
      return { ok: true, value: await this.renameTx(tx, row, input.title, input.byCharacterId) };
    });
  }
  async removeCharacterFromUserGroups(
    transaction: Tx,
    input: { userId: string; characterId: string },
  ): Promise<void> {
    const tx = asDbTx(transaction);
    parseContract(Id, input.userId);
    parseContract(Id, input.characterId);
    const rows = await tx.db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(participants, eq(participants.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.ownerUserId, input.userId),
          eq(conversations.type, 'group'),
          eq(participants.kind, 'character'),
          eq(participants.refId, input.characterId),
          isNull(participants.leftAt),
        ),
      )
      .orderBy(conversations.id);
    for (const { id } of rows) {
      const row = await this.store.load(tx, id, input.userId);
      const member = await this.activeCharacter(tx, row.id, input.characterId);
      if (member) await this.leaveTx(tx, row, member, 'member_left', 'system');
    }
  }

  // ---------- ChatGroupReadPort ----------

  async listGroupConversations(
    userId: string,
    filter?: { memberCharacterId?: string; exactMemberCharacterIds?: string[] },
  ): Promise<Conversation[]> {
    parseContract(Id, userId);
    return this.db.transaction(async (tx) => {
      await this.store.requireActive(tx, userId);
      const rows = await tx.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.ownerUserId, userId), eq(conversations.type, 'group')))
        .orderBy(conversations.id);
      const exact = filter?.exactMemberCharacterIds
        ? [...new Set(filter.exactMemberCharacterIds)].sort()
        : null;
      const result: Conversation[] = [];
      for (const row of rows) {
        const conversation = await this.masked(tx, row);
        const characterIds = conversation.participants
          .filter((p) => p.kind === 'character')
          .map((p) => p.refId);
        if (filter?.memberCharacterId && !characterIds.includes(filter.memberCharacterId)) continue;
        if (exact) {
          const sorted = [...characterIds].sort();
          if (sorted.length !== exact.length || sorted.some((id, i) => id !== exact[i])) continue;
        }
        result.push(conversation);
      }
      return result;
    });
  }
  async getLastUserMessageAt(conversationId: string): Promise<string | null> {
    parseContract(Id, conversationId);
    const [row] = await this.db.db
      .select({ at: max(messages.createdAt) })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.senderKind, 'user')));
    return row?.at ? new Date(row.at).toISOString() : null;
  }

  // ---------- 内部 ----------

  private async loadGroup(tx: DbTx, conversationId: string, userId: string) {
    const row = await this.store.load(tx, conversationId, userId);
    if (row.type !== 'group') throw new AppError('not_group_conversation', '这不是群聊');
    return row;
  }
  private async tryLoadGroup(tx: DbTx, conversationId: string): Promise<ConversationRow | null> {
    try {
      const row = await this.store.load(tx, conversationId);
      return row.type === 'group' ? row : null;
    } catch (error) {
      if (error instanceof AppError && error.code === 'not_found') return null;
      throw error;
    }
  }
  private async reload(tx: DbTx, conversationId: string): Promise<Conversation> {
    const [row] = await tx.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!row) throw new AppError('not_found', '会话不存在');
    return this.store.conversation(tx, row);
  }
  /** 与 ChatReadService 内部读取一致：成人范围的最后一条消息摘要显示为「[消息]」。 */
  private async masked(tx: DbTx, row: ConversationRow): Promise<Conversation> {
    const result = await this.store.conversation(tx, row);
    if (result.lastMessage) {
      const [source] = await tx.db
        .select({ scope: messages.scope })
        .from(messages)
        .where(eq(messages.id, result.lastMessage.messageId));
      if (source?.scope === 'adult') result.lastMessage = { ...result.lastMessage, text: '[消息]' };
    }
    return result;
  }
  private async activeMembers(tx: DbTx, conversationId: string): Promise<ParticipantRow[]> {
    return tx.db
      .select()
      .from(participants)
      .where(and(eq(participants.conversationId, conversationId), isNull(participants.leftAt)))
      .orderBy(participants.joinedAt, participants.id);
  }
  private async activeCharacter(tx: DbTx, conversationId: string, characterId: string) {
    const [member] = await tx.db
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.conversationId, conversationId),
          eq(participants.kind, 'character'),
          eq(participants.refId, characterId),
          isNull(participants.leftAt),
        ),
      );
    return member ?? null;
  }
  private async system(
    tx: DbTx,
    row: ConversationRow,
    code: string,
    params: Record<string, string | number | boolean>,
    idempotencyKey: string,
  ): Promise<void> {
    const current = await this.store.load(tx, row.id);
    const result = await this.writer.post(
      tx,
      current,
      {
        conversationId: row.id,
        senderParticipantId: current.systemParticipantId,
        content: { type: 'system', code, params },
        idempotencyKey,
      },
      'system',
    );
    if (!result.ok) throw new AppError('internal_error', result.message ?? '系统提示未能写入');
  }
  /** 群名没被改过时，成员变化后按当前成员名重新拼接。 */
  private async refreshDefaultTitle(tx: DbTx, row: ConversationRow): Promise<void> {
    const [current] = await tx.db.select().from(conversations).where(eq(conversations.id, row.id));
    if (!current || current.titleCustomized) return;
    const members = await this.activeMembers(tx, row.id);
    const names: string[] = [];
    for (const m of members)
      if (m.kind === 'character') names.push(await this.name(tx, row.ownerUserId, m.refId));
    const title = names.length ? defaultTitle(names) : '群聊';
    if (title === current.title) return;
    await tx.db
      .update(conversations)
      .set({ title, updatedAt: this.clock.now() })
      .where(eq(conversations.id, row.id));
  }
  private async addTx(
    tx: DbTx,
    row: ConversationRow,
    characterIdsInput: string[],
    byCharacterId: string | null,
  ): Promise<PortResult<Conversation, 'limit_reached'>> {
    const requested = [...new Set(characterIdsInput.map((id) => parseContract(Id, id)))];
    const members = await this.activeMembers(tx, row.id);
    const current = new Set(members.filter((m) => m.kind === 'character').map((m) => m.refId));
    const added = requested.filter((id) => !current.has(id));
    if (!added.length) return { ok: true, value: await this.store.conversation(tx, row) };
    if (current.size + added.length > GROUP_MEMBER_LIMIT)
      return {
        ok: false,
        error: 'limit_reached',
        message: `群里最多 ${GROUP_MEMBER_LIMIT} 个角色`,
      };
    const directory = this.directory();
    for (const id of added)
      if (!(await directory.isActiveContact(row.ownerUserId, id, tx)))
        throw new AppError('bad_request', '只能拉通讯录中的角色进群');
    const at = this.clock.now();
    const names: string[] = [];
    for (const id of added) {
      names.push(await this.name(tx, row.ownerUserId, id));
      // 以前退出过的角色复用原参与者行（唯一索引 conversation + kind + ref），历史消息的发送者保持一致。
      const [former] = await tx.db
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.conversationId, row.id),
            eq(participants.kind, 'character'),
            eq(participants.refId, id),
          ),
        );
      if (former)
        await tx.db
          .update(participants)
          .set({ leftAt: null, joinedAt: at })
          .where(eq(participants.id, former.id));
      else
        await tx.db.insert(participants).values({
          id: newId(),
          conversationId: row.id,
          kind: 'character',
          refId: id,
          joinedAt: at,
          readSeq: row.lastSeq,
        });
    }
    await this.refreshDefaultTitle(tx, row);
    const byName = byCharacterId ? await this.name(tx, row.ownerUserId, byCharacterId) : null;
    await this.system(
      tx,
      row,
      'member_joined',
      {
        names: names.join('、'),
        characterIds: added.join(','),
        ...(byName && byCharacterId ? { byName, byCharacterId } : {}),
      },
      `member_joined:${newId()}`,
    );
    // 新成员不具备当前情景模式资格时，由 ai-runtime 订阅此事件切回日常并写系统提示（SOC-03 第 4 条）。
    await this.outbox.publish(tx, 'chat.group_members_changed', 'chat', {
      conversationId: row.id,
      ownerUserId: row.ownerUserId,
      addedCharacterIds: added,
      removedCharacterIds: [],
      cause: byCharacterId ? 'character' : 'user',
      byCharacterId,
    });
    return { ok: true, value: await this.reload(tx, row.id) };
  }
  private async leaveTx(
    tx: DbTx,
    row: ConversationRow,
    member: ParticipantRow,
    code: 'member_removed' | 'member_left',
    cause: 'user' | 'system',
  ): Promise<Conversation> {
    const name = await this.name(tx, row.ownerUserId, member.refId);
    await tx.db
      .update(participants)
      .set({ leftAt: this.clock.now() })
      .where(eq(participants.id, member.id));
    await this.refreshDefaultTitle(tx, row);
    await this.system(
      tx,
      row,
      code,
      { name, names: name, characterId: member.refId },
      `${code}:${member.id}:${newId()}`,
    );
    await this.outbox.publish(tx, 'chat.group_members_changed', 'chat', {
      conversationId: row.id,
      ownerUserId: row.ownerUserId,
      addedCharacterIds: [],
      removedCharacterIds: [member.refId],
      cause,
      byCharacterId: null,
    });
    return this.reload(tx, row.id);
  }
  private async resetTitleTx(tx: DbTx, row: ConversationRow): Promise<Conversation> {
    if (!row.titleCustomized) return this.store.conversation(tx, row);
    await tx.db
      .update(conversations)
      .set({ titleCustomized: false, updatedAt: this.clock.now() })
      .where(eq(conversations.id, row.id));
    await this.refreshDefaultTitle(tx, { ...row, titleCustomized: false });
    const [current] = await tx.db.select().from(conversations).where(eq(conversations.id, row.id));
    await this.system(
      tx,
      row,
      'group_renamed',
      { title: current?.title ?? '', reset: true },
      `group_renamed:${newId()}`,
    );
    await this.outbox.publish(tx, 'chat.group_renamed', 'chat', {
      conversationId: row.id,
      ownerUserId: row.ownerUserId,
      byCharacterId: null,
    });
    return this.reload(tx, row.id);
  }
  private async renameTx(
    tx: DbTx,
    row: ConversationRow,
    titleInput: string,
    byCharacterId: string | null,
  ): Promise<Conversation> {
    const title = String(titleInput ?? '').trim();
    if (!title || title.length > TITLE_MAX) throw new AppError('bad_request', '群名为 1～40 字');
    if (title === row.title && row.titleCustomized) return this.store.conversation(tx, row);
    await tx.db
      .update(conversations)
      .set({ title, titleCustomized: true, updatedAt: this.clock.now() })
      .where(eq(conversations.id, row.id));
    const byName = byCharacterId ? await this.name(tx, row.ownerUserId, byCharacterId) : null;
    await this.system(
      tx,
      row,
      'group_renamed',
      { title, ...(byName && byCharacterId ? { byName, byCharacterId } : {}) },
      `group_renamed:${newId()}`,
    );
    await this.outbox.publish(tx, 'chat.group_renamed', 'chat', {
      conversationId: row.id,
      ownerUserId: row.ownerUserId,
      byCharacterId,
    });
    return this.reload(tx, row.id);
  }
}

/** 默认群名：成员名用「、」拼接，最多 40 字（SOC-03 第 2 条）。 */
export function defaultTitle(names: string[]): string {
  const joined = names.join('、');
  return joined.length <= TITLE_MAX ? joined : `${joined.slice(0, TITLE_MAX - 1)}…`;
}
