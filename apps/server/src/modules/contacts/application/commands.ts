import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, count, eq, ne } from 'drizzle-orm';
import {
  AddContactRequest,
  Contact,
  Id,
  UpdateContactRequest,
  type CharacterReadPort,
  type ChatAdminPort,
  type IdentityAccountStatusPort,
  type IdentityReadPort,
  type MediaReadPort,
  type SyncPort,
  type PolicyPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  OUTBOX,
  P26_CONTACT_LIMIT,
  P30_CONTACT_ACCEPT_DELAY,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type JobQueue,
  type Outbox,
} from '../../../platform/index.js';
import { CHARACTER_READ_PORT } from '../../characters/index.js';
import { CHAT_ADMIN_PORT } from '../../chat/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT, IDENTITY_READ_PORT } from '../../identity/index.js';
import { MEDIA_READ_PORT } from '../../media/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { contacts } from '../infra/db/schema.js';
import { contactDto, type ContactRow } from './read.js';
export interface ContactJob {
  userId: string;
  characterId: string;
  requestId: string;
}
export const ACCEPT_CONTACT_JOB = 'contacts.accept_contact';
export const PURGE_CONTACT_JOB = 'contacts.purge_contact';
const RETENTION_MS = 30 * 86400000;

@Injectable()
export class ContactsCommands {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(CHARACTER_READ_PORT) private readonly characters: CharacterReadPort,
    @Inject(CHAT_ADMIN_PORT) private readonly chat: ChatAdminPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(MEDIA_READ_PORT) private readonly media: MediaReadPort,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
  ) {}
  async lockUser(tx: DbTx, userId: string): Promise<void> {
    parseContract(Id, userId);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('contacts:user:' || $1,0))", [
      userId,
    ]);
    if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
      throw new AppError('unauthenticated', '账号已失效');
  }
  private async row(
    tx: DbTx,
    userId: string,
    characterId: string,
  ): Promise<ContactRow | undefined> {
    const [row] = await tx.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.characterId, characterId)))
      .for('update');
    return row;
  }
  async list(userId: string): Promise<{ items: Contact[] }> {
    return this.db.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const rows = await tx.db
        .select()
        .from(contacts)
        .where(and(eq(contacts.userId, userId), ne(contacts.status, 'deleted')))
        .orderBy(contacts.characterId);
      return { items: rows.map(contactDto) };
    });
  }
  async add(userId: string, input: unknown): Promise<Contact> {
    const body = parseContract(AddContactRequest, input);
    const profile = await this.identity.getProfile(userId);
    if (!profile) throw new AppError('unauthenticated', '账号已失效');
    return this.db.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      let previous = await this.row(tx, userId, body.characterId);
      const wasDeleted = previous?.status === 'deleted';
      if (previous && previous.status !== 'deleted')
        throw new AppError('contact_exists', '已经添加或正在等待通过');
      if (!(await this.characters.canAdd(userId, body.characterId, tx)))
        throw new AppError('character_not_available', '该角色暂不能添加');
      const [total] = await tx.db
        .select({ n: count() })
        .from(contacts)
        .where(and(eq(contacts.userId, userId), ne(contacts.status, 'deleted')));
      if ((total?.n ?? 0) >= P26_CONTACT_LIMIT)
        throw new AppError('contact_limit_reached', '通讯录已满，请先删除一些角色');
      if (previous?.purgeAfter && previous.purgeAfter.getTime() <= this.clock.nowMs()) {
        await this.purgeTx(tx, previous);
        previous = undefined;
      }
      if (previous && !body.restoreMode)
        throw new AppError('restore_choice_required', '请选择恢复以前的记录或重新认识');
      const mode = previous
        ? body.restoreMode === 'restore'
          ? 'restored'
          : 'fresh_after_delete'
        : wasDeleted
          ? 'fresh_after_delete'
          : 'new';
      if (previous && mode === 'fresh_after_delete') {
        await this.purgeTx(tx, previous);
        previous = undefined;
      }
      if (body.referrerCharacterId) {
        const referrer = await this.row(tx, userId, body.referrerCharacterId);
        if (
          !referrer ||
          referrer.status !== 'active' ||
          body.referrerCharacterId === body.characterId
        )
          throw new AppError('bad_request', '推荐人必须是已添加的其他角色');
      }
      const classification = await this.characters.getClassification(body.characterId, tx);
      const id = previous?.id ?? newId();
      const requestId = newId();
      const now = this.clock.now();
      // 留出默认队列一次2秒空闲轮询余量；申请本身仍在P30的3～30秒区间内。
      const delay = randomInt(
        P30_CONTACT_ACCEPT_DELAY.minMs,
        P30_CONTACT_ACCEPT_DELAY.maxMs - 2000 + 1,
      );
      const knownSince =
        previous?.knownSince ??
        new Intl.DateTimeFormat('en-CA', {
          timeZone: profile.timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(now);
      const greetingCiphertext = body.greeting
        ? await this.crypto.seal(userId, `contacts:greeting:${id}`, body.greeting, tx)
        : null;
      const [row] = await tx.db
        .insert(contacts)
        .values({
          id,
          userId,
          characterId: body.characterId,
          status: 'pending',
          requestId,
          acceptanceMode: mode,
          acceptAfter: new Date(now.getTime() + delay),
          knownSince,
          addedAt: previous?.addedAt ?? now,
          remark: previous?.remark ?? null,
          customAvatarMediaId: previous?.customAvatarMediaId ?? null,
          addressAs: previous?.addressAs ?? null,
          conversationId: previous?.conversationId ?? null,
          relationshipType:
            previous?.relationshipType ??
            (classification?.realPersonKind === 'celebrity' ? '粉丝与偶像' : '朋友'),
          greetingCiphertext,
          referrerCharacterId: body.referrerCharacterId ?? null,
          deletedAt: null,
          purgeAfter: null,
        })
        .onConflictDoUpdate({
          target: [contacts.userId, contacts.characterId],
          set: {
            status: 'pending',
            requestId,
            acceptanceMode: mode,
            acceptAfter: new Date(now.getTime() + delay),
            greetingCiphertext,
            referrerCharacterId: body.referrerCharacterId ?? null,
            deletedAt: null,
            purgeAfter: null,
          },
        })
        .returning();
      if (!row) throw new AppError('internal_error', '申请未能保存');
      await this.jobs.send<ContactJob>(
        ACCEPT_CONTACT_JOB,
        { userId, characterId: body.characterId, requestId },
        {
          tx,
          startAfter: row.acceptAfter,
          singletonKey: requestId,
          retryLimit: 10,
          retryBackoff: true,
        },
      );
      await this.sync.appendUpdate(tx, userId, {
        type: 'contact.upserted',
        data: { contact: contactDto(row) },
      });
      await this.outbox.publish(tx, 'contacts.contact_requested', 'contacts', {
        userId,
        characterId: body.characterId,
        hasGreeting: !!body.greeting,
      });
      return contactDto(row);
    });
  }
  async accept(data: ContactJob): Promise<void> {
    parseContract(Id, data.characterId);
    parseContract(Id, data.requestId);
    try {
      await this.db.transaction(async (tx) => {
        await this.lockUser(tx, data.userId);
        const row = await this.row(tx, data.userId, data.characterId);
        if (
          !row ||
          row.status !== 'pending' ||
          row.requestId !== data.requestId ||
          row.acceptAfter.getTime() > this.clock.nowMs()
        )
          return;
        if (!(await this.characters.canAdd(data.userId, data.characterId, tx))) {
          // 下架不能留下永远pending的申请；原历史仍按软删除保留。
          if (row.conversationId) await this.softRemoveTx(tx, row);
          else await this.purgeTx(tx, row);
          return;
        }
        const conversation = await this.chat.ensureDirectConversation(tx, {
          userId: row.userId,
          characterId: row.characterId,
          restoreHistory: row.acceptanceMode === 'restored',
        });
        const [active] = await tx.db
          .update(contacts)
          .set({ status: 'active', conversationId: conversation.conversationId })
          .where(eq(contacts.id, row.id))
          .returning();
        await this.chat.postSystemMessage(tx, {
          conversationId: conversation.conversationId,
          code: 'contact_accepted',
          params: { characterId: row.characterId },
          idempotencyKey: `contact:${row.requestId}:accepted`,
        });
        await this.sync.appendUpdate(tx, row.userId, {
          type: 'contact.upserted',
          data: { contact: contactDto(active!) },
        });
        await this.outbox.publish(tx, 'contacts.contact_accepted', 'contacts', {
          userId: row.userId,
          characterId: row.characterId,
          conversationId: conversation.conversationId,
          mode: row.acceptanceMode as 'new' | 'restored' | 'fresh_after_delete',
          referrerCharacterId: row.referrerCharacterId,
        });
      });
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'unauthenticated')) throw error;
    }
  }
  async update(userId: string, characterId: string, input: unknown): Promise<Contact> {
    parseContract(Id, characterId);
    const patch = parseContract(UpdateContactRequest, input);
    if (
      patch.relationship &&
      !(
        await this.policy.checkRelationshipType({
          userId,
          characterId,
          relationshipType: patch.relationship,
        })
      ).allowed
    )
      throw new AppError('romance_not_allowed', '该角色不能使用恋爱关系');
    if (patch.customAvatarMediaId) {
      const object = await this.media.getMedia(userId, patch.customAvatarMediaId);
      if (object.purpose !== 'contact_avatar')
        throw new AppError('bad_request', '请上传通讯录头像');
    }
    const result = await this.db.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const row = await this.row(tx, userId, characterId);
      if (!row || row.status === 'deleted') throw new AppError('not_found', '联系人不存在');
      if (
        patch.relationship &&
        !(
          await this.policy.checkRelationshipType(
            { userId, characterId, relationshipType: patch.relationship },
            tx,
          )
        ).allowed
      )
        return null;
      const { relationship, ...fields } = patch;
      const values = {
        ...fields,
        ...(relationship === undefined ? {} : { relationshipType: relationship }),
      };
      const changedFields = Object.entries(values)
        .filter(([key, value]) => row[key as keyof ContactRow] !== value)
        .map(([key]) => key);
      if (!changedFields.length) return contactDto(row);
      const [updated] = await tx.db
        .update(contacts)
        .set(values)
        .where(eq(contacts.id, row.id))
        .returning();
      const contact = contactDto(updated!);
      await this.sync.appendUpdate(tx, userId, { type: 'contact.upserted', data: { contact } });
      await this.outbox.publish(tx, 'contacts.contact_updated', 'contacts', {
        userId,
        characterId,
        changedFields,
      });
      return contact;
    });
    if (result === null) throw new AppError('romance_not_allowed', '该角色不能使用恋爱关系');
    return result;
  }
  async remove(userId: string, characterId: string, mode: 'soft' | 'purge'): Promise<void> {
    parseContract(Id, characterId);
    if (!['soft', 'purge'].includes(mode)) throw new AppError('bad_request', '删除方式不正确');
    await this.db.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const row = await this.row(tx, userId, characterId);
      if (!row) return;
      if (mode === 'purge') await this.purgeTx(tx, row);
      else if (row.status !== 'deleted') await this.softRemoveTx(tx, row);
    });
  }
  private async softRemoveTx(tx: DbTx, row: ContactRow): Promise<void> {
    const purgeAfter = new Date(this.clock.nowMs() + RETENTION_MS);
    const requestId = newId();
    await this.chat.archiveDirectConversation(tx, {
      userId: row.userId,
      characterId: row.characterId,
    });
    await tx.db
      .update(contacts)
      .set({
        status: 'deleted',
        requestId,
        deletedAt: this.clock.now(),
        purgeAfter,
        greetingCiphertext: null,
      })
      .where(eq(contacts.id, row.id));
    await this.jobs.send<ContactJob>(
      PURGE_CONTACT_JOB,
      { userId: row.userId, characterId: row.characterId, requestId },
      { tx, startAfter: purgeAfter, singletonKey: requestId, retryLimit: 10, retryBackoff: true },
    );
    await this.sync.appendUpdate(tx, row.userId, {
      type: 'contact.removed',
      data: { characterId: row.characterId },
    });
    await this.outbox.publish(tx, 'contacts.contact_removed', 'contacts', {
      userId: row.userId,
      characterId: row.characterId,
      purgeAfter: purgeAfter.toISOString(),
    });
  }
  private async purgeTx(tx: DbTx, row: ContactRow): Promise<void> {
    await this.chat.purgeDirectConversation(tx, {
      userId: row.userId,
      characterId: row.characterId,
    });
    await tx.db.delete(contacts).where(eq(contacts.id, row.id));
    await this.sync.appendUpdate(tx, row.userId, {
      type: 'contact.removed',
      data: { characterId: row.characterId },
    });
    await this.outbox.publish(tx, 'contacts.contact_purged', 'contacts', {
      userId: row.userId,
      characterId: row.characterId,
      conversationId: row.conversationId,
    });
  }
  async purgeExpired(data: ContactJob): Promise<void> {
    parseContract(Id, data.characterId);
    parseContract(Id, data.requestId);
    try {
      await this.db.transaction(async (tx) => {
        await this.lockUser(tx, data.userId);
        const row = await this.row(tx, data.userId, data.characterId);
        if (
          row?.status === 'deleted' &&
          row.requestId === data.requestId &&
          row.purgeAfter &&
          row.purgeAfter.getTime() <= this.clock.nowMs()
        )
          await this.purgeTx(tx, row);
      });
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'unauthenticated')) throw error;
    }
  }
}
