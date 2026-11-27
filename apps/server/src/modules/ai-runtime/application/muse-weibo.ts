import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type {
  ContactsReadPort,
  IdentityAccountStatusPort,
  MomentsCharacterPort,
  MuseWeiboReceipt,
  MuseWeiboSubmission,
  WeiboPublicationPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  EVENT_BUS,
  JOB_QUEUE,
  newId,
  type Clock,
  type Database,
  type DbTx,
  type EventBus,
  type JobQueue,
} from '../../../platform/index.js';
import { localDate } from '../../../platform/time/local-time.js';
import { WEIBO_PUBLICATION_PORT } from '../../characters/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { MOMENTS_CHARACTER_PORT } from '../../moments/index.js';
import { publicWeiboTextAllowed, weiboPostIdentity } from '../domain/weibo.js';

const JOB = 'ai.muse_weibo_publish';
const CONTACT_JOB = 'ai.muse_weibo_contact';

interface ContactBackfill {
  userId: string;
  characterId: string;
  epoch: string;
  afterId: string | null;
}
const RECIPIENTS_PER_PASS = 50;
const RECEIPTS_PER_PASS = 15;
const RETRY_DELAY_MS = 5 * 60_000;

interface InboxRow {
  id: string;
  character_id: string;
  author_nickname: string;
  author_weibo_id: string;
  source_url: string;
  text: string;
  published_on: string;
  accepted_at: Date;
  state: MuseWeiboReceipt['state'];
  public_update_id: string | null;
  recipient_cursor: string | null;
}

function receipt(row: InboxRow): MuseWeiboReceipt {
  return {
    receiptId: row.id,
    characterId: row.character_id,
    state: row.state,
    acceptedAt: row.accepted_at.toISOString(),
  };
}

@Injectable()
export class MuseWeiboService implements OnModuleInit {
  private readonly logger = new Logger(MuseWeiboService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(WEIBO_PUBLICATION_PORT) private readonly publication: WeiboPublicationPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(MOMENTS_CHARACTER_PORT) private readonly moments: MomentsCharacterPort,
  ) {}

  async onModuleInit() {
    await this.jobs.work(JOB, () => this.sweep());
    await this.jobs.schedule(JOB, '* * * * *');
    await this.jobs.work<ContactBackfill>(CONTACT_JOB, ({ data }) => this.backfillContact(data));
    this.bus.subscribe({
      consumer: 'ai.muse_weibo_contact_accepted',
      eventType: 'contacts.contact_accepted',
      handle: async ({ payload }, tx) => {
        // 刻意清空并重新添加的关系，保留用户删除历史的结果。
        if (payload.mode !== 'new') return;
        const { userId, characterId, conversationId } = payload;
        const active = await this.contacts.getActiveContact(userId, characterId, tx);
        if (active?.conversationId !== conversationId) return;
        const epoch = await this.contacts.getActiveContactEpoch(userId, characterId, tx);
        if (epoch)
          await this.enqueueBackfill(
            { userId, characterId, epoch: epoch.version, afterId: null },
            tx,
          );
      },
    });
  }

  private async enqueueBackfill(data: ContactBackfill, tx?: DbTx) {
    await this.jobs.send(CONTACT_JOB, data, {
      ...(tx ? { tx } : {}),
      retryLimit: 6,
      retryBackoff: true,
    });
  }

  async backfillContact(data: ContactBackfill): Promise<void> {
    const available = await this.db.query<InboxRow>(
      `SELECT *,published_on::text FROM ai_runtime.muse_weibo_inbox
        WHERE character_id=$1 AND public_update_id IS NOT NULL AND state IN ('publishing','published')
        AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`,
      [data.characterId, data.afterId, RECIPIENTS_PER_PASS],
    );
    for (const candidate of available.rows) {
      await this.db.transaction(async (tx) => {
        if (!(await this.sourceMatches(tx, candidate))) return;
        const item = await this.lock(tx, candidate.id);
        if (!item?.public_update_id || !['publishing', 'published'].includes(item.state)) return;
        if (
          (await this.contacts.getActiveContactEpoch(data.userId, data.characterId, tx))
            ?.version !== data.epoch ||
          (await this.accounts.isBanned?.(data.userId, tx))
        )
          return;
        if (!(await this.publication.isEffective(tx, data.characterId, item.public_update_id)))
          return;
        await this.writeFeed(tx, data.userId, item, item.public_update_id, 'history');
      });
    }
    if (available.rows.length === RECIPIENTS_PER_PASS) {
      await this.enqueueBackfill({ ...data, afterId: available.rows.at(-1)!.id });
    }
  }

  async submit(input: MuseWeiboSubmission): Promise<MuseWeiboReceipt> {
    const source = weiboPostIdentity(input.sourceUrl, input.authorWeiboId);
    if (!source)
      throw new AppError('bad_request', '请提供有效的微博原帖链接；手机链接须同时提交作者 UID');
    const { sourceUrl, authorId } = source;
    if (input.publishedOn > localDate(this.clock.now(), 'Asia/Shanghai'))
      throw new AppError('bad_request', '原帖日期不能在将来');
    if (!publicWeiboTextAllowed(input.text))
      throw new AppError('bad_request', '投稿含需清除的隐私或指令内容');

    return this.db.transaction(async (tx) => {
      const now = this.clock.now();
      const find = async () =>
        (
          await tx.query<InboxRow>(
            'SELECT *,published_on::text FROM ai_runtime.muse_weibo_inbox WHERE character_id=$1 AND source_url=$2',
            [input.characterId, sourceUrl],
          )
        ).rows[0];
      const old = await find();
      if (old) return this.replay(old, input);
      if (
        !(await this.publication.sourceMatches(tx, {
          characterId: input.characterId,
          nickname: input.authorNickname,
          weiboUserId: authorId,
        }))
      )
        throw new AppError(
          'character_not_available',
          '角色未公开发布，或微博作者与角色已配置的公开账号不符',
        );
      const inserted = (
        await tx.query<InboxRow>(
          `INSERT INTO ai_runtime.muse_weibo_inbox
          (id,character_id,author_nickname,author_weibo_id,source_url,text,published_on,accepted_at,next_attempt_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
          ON CONFLICT (character_id,source_url) DO NOTHING RETURNING *`,
          [
            newId(),
            input.characterId,
            input.authorNickname,
            authorId,
            sourceUrl,
            input.text,
            input.publishedOn,
            now,
          ],
        )
      ).rows[0];
      return inserted ? receipt(inserted) : this.replay((await find())!, input);
    });
  }

  private replay(row: InboxRow, input: MuseWeiboSubmission): MuseWeiboReceipt {
    if (row.text !== input.text || row.published_on !== input.publishedOn)
      throw new AppError('conflict', '同一角色的该条微博已经接受；重试时请保留原文与日期');
    return receipt(row);
  }

  async get(receiptId: string): Promise<MuseWeiboReceipt> {
    const row = (
      await this.db.query<InboxRow>('SELECT * FROM ai_runtime.muse_weibo_inbox WHERE id=$1', [
        receiptId,
      ])
    ).rows[0];
    if (!row) throw new AppError('not_found', '微博投稿回执不存在');
    return receipt(row);
  }

  async sweep(): Promise<void> {
    const due = await this.db.query<InboxRow>(
      `SELECT *,published_on::text FROM ai_runtime.muse_weibo_inbox
        WHERE state IN ('queued','publishing','blocked') AND next_attempt_at <= $1
        ORDER BY next_attempt_at,accepted_at,id LIMIT $2`,
      [this.clock.now(), RECEIPTS_PER_PASS],
    );
    for (const candidate of due.rows) {
      const { id } = candidate;
      try {
        await this.advance(candidate);
      } catch {
        // 日志只放回执号；正文和正文相关的错误细节均不进日志。
        this.logger.warn(`Muse 微博发布暂未完成，稍后重试（回执 ${id}）`);
        await this.db.query(
          `UPDATE ai_runtime.muse_weibo_inbox SET next_attempt_at=$2
            WHERE id=$1 AND state IN ('queued','publishing','blocked') AND next_attempt_at<=$3`,
          [id, new Date(this.clock.nowMs() + RETRY_DELAY_MS), this.clock.now()],
        );
      }
    }
  }

  private async advance(candidate: InboxRow): Promise<void> {
    const { id } = candidate;
    const row = await this.db.transaction(async (tx) => {
      // 按角色彻底删除的加锁顺序，先锁角色，再锁投稿。
      const eligible = await this.sourceMatches(tx, candidate);
      const item = await this.lock(tx, id);
      if (!item || item.state === 'published' || item.state === 'withdrawn') return null;
      if (!eligible) {
        await this.defer(tx, id);
        return null;
      }
      const updateId =
        item.public_update_id ??
        (await this.publication.publish(tx, {
          characterId: item.character_id,
          nickname: item.author_nickname,
          weiboUserId: item.author_weibo_id,
          sourceUrl: item.source_url,
          sourceAliases: weiboPostIdentity(item.source_url)!.sourceAliases,
          origin: 'muse',
          content: item.text || '点击查看原帖图片或视频。',
          publishedOn: item.published_on,
        }));
      if (!updateId || !(await this.publication.isEffective(tx, item.character_id, updateId))) {
        await this.updateState(tx, id, 'withdrawn');
        return null;
      }
      await tx.query(
        `UPDATE ai_runtime.muse_weibo_inbox SET state='publishing', public_update_id=$2 WHERE id=$1`,
        [id, updateId],
      );
      return item;
    });
    if (!row) return;

    const recipients = await this.contacts.listActiveRecipients(
      row.character_id,
      row.recipient_cursor,
      RECIPIENTS_PER_PASS,
    );
    let previous = row.recipient_cursor;
    for (const recipient of recipients) {
      const progressed = await this.db.transaction(async (tx) => {
        const eligible = await this.sourceMatches(tx, row);
        const item = await this.lock(tx, id);
        if (item?.state !== 'publishing' || item.recipient_cursor !== previous) return false;
        if (!eligible) {
          await this.defer(tx, id);
          return false;
        }
        const updateId = item.public_update_id!;
        // 从通讯录读取的候选只是快照；领取之后的删除、重新添加或封禁不能穿透。
        const active = await this.contacts.getActiveContactEpoch(
          recipient.userId,
          item.character_id,
          tx,
        );
        if (
          active?.version === recipient.epoch &&
          !(await this.accounts.isBanned?.(recipient.userId, tx))
        ) {
          if (!(await this.publication.isEffective(tx, item.character_id, updateId))) {
            await this.updateState(tx, id, 'withdrawn');
            return false;
          }
          // 首次加好友和公开扫尾作业可能重叠，先接受的旧稿仍按历史送达。
          const delivery = item.accepted_at < new Date(active.acceptAfter) ? 'history' : 'live';
          await this.writeFeed(tx, recipient.userId, item, updateId, delivery);
        }
        await tx.query('UPDATE ai_runtime.muse_weibo_inbox SET recipient_cursor=$2 WHERE id=$1', [
          id,
          recipient.userId,
        ]);
        return true;
      });
      if (!progressed) return;
      previous = recipient.userId;
    }

    if (recipients.length < RECIPIENTS_PER_PASS) {
      await this.db.query(
        `UPDATE ai_runtime.muse_weibo_inbox SET state='published',recipient_cursor=NULL
          WHERE id=$1 AND state='publishing' AND recipient_cursor IS NOT DISTINCT FROM $2::uuid`,
        [id, previous],
      );
    } else {
      // 已推进的长队列让其它投稿先获得一轮处理机会。
      await this.db.query(
        `UPDATE ai_runtime.muse_weibo_inbox SET next_attempt_at=$2
          WHERE id=$1 AND state='publishing' AND recipient_cursor=$3`,
        [id, new Date(this.clock.nowMs() + 1000), previous],
      );
    }
  }

  private async writeFeed(
    tx: DbTx,
    userId: string,
    item: InboxRow,
    updateId: string,
    museWeibo: 'live' | 'history',
  ) {
    const posted = await this.moments.createPost(tx, {
      ownerUserId: userId,
      characterId: item.character_id,
      text: item.text || '点击查看原帖图片或视频。',
      imageMediaIds: [],
      link: {
        url: item.source_url,
        title: `微博原帖 · ${item.published_on}`,
        source: '微博',
        coverMediaId: null,
        appHint: 'web',
      },
      sourceRef: { kind: 'public_update', id: updateId },
      forwardedPublic: true,
      museWeibo,
      idempotencyKey: `muse-weibo:${item.id}`,
    });
    if (!posted.ok) throw new Error('active contact changed');
  }

  private async lock(tx: DbTx, id: string): Promise<InboxRow | undefined> {
    return (
      await tx.query<InboxRow>(
        'SELECT *,published_on::text FROM ai_runtime.muse_weibo_inbox WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
  }

  private sourceMatches(tx: DbTx, item: InboxRow) {
    return this.publication.sourceMatches(tx, {
      characterId: item.character_id,
      nickname: item.author_nickname,
      weiboUserId: item.author_weibo_id,
    });
  }

  private async defer(tx: DbTx, id: string) {
    await tx.query(
      `UPDATE ai_runtime.muse_weibo_inbox SET state='blocked',next_attempt_at=$2 WHERE id=$1`,
      [id, new Date(this.clock.nowMs() + RETRY_DELAY_MS)],
    );
  }

  private async updateState(tx: DbTx, id: string, state: 'withdrawn') {
    await tx.query(
      'UPDATE ai_runtime.muse_weibo_inbox SET state=$2,recipient_cursor=NULL WHERE id=$1',
      [id, state],
    );
  }
}
