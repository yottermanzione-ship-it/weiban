import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ContactsReadPort, ChatReadPort, TimelineEntry } from '@weiban/contracts';
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
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { ReplyPlanStore } from './plan-store.js';
import { invalidateReplyPlans } from './invalidate.js';
import { healthPrivate, relevance } from '../domain/memory.js';
import { takeWithin } from '../domain/prompt-assembly.js';
import { embed, toVectorLiteral } from '../domain/vector-embed.js';

const Payload = z.object({
  text: z.string().max(120),
  withCharacterIds: z.array(z.string()).max(10).default([]),
});
const Snapshot = z.object({ ids: z.array(z.string()), text: z.string().max(600) });
const Archived = z
  .array(z.object({ id: z.string(), at: z.string(), text: z.string().max(120) }))
  .max(1000);
type Row = {
  id: string;
  user_id: string;
  character_id: string;
  epoch: string;
  scope: 'normal' | 'adult';
  kind: string;
  ciphertext: Buffer | null;
  importance: number;
  occurred_at: Date;
  created_at: Date;
  archive_month: string | null;
};
export interface EpisodeInput {
  userId: string;
  characterId: string;
  kind: string;
  sourceType: string;
  sourceId: string;
  text: string;
  scope: 'normal' | 'adult';
  importance?: number;
  occurredAt?: Date;
  epoch?: string;
  withCharacterIds?: string[];
}
const keyOf = (type: string, id: string) =>
  createHash('sha256').update(`${type}:${id}`).digest('hex');
@Injectable()
export class SharedEpisodesService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ReplyPlanStore) private readonly store: ReplyPlanStore,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}
  async onModuleInit() {
    await this.jobs.work('ai.archive_episodes', () => this.archive());
    await this.jobs.schedule('ai.archive_episodes', '17 * * * *');
    this.bus.subscribe({
      consumer: 'ai.shared_episode_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (
          p.senderKind !== 'character' ||
          !p.senderRefId ||
          p.conversationType !== 'direct' ||
          !['voice', 'image', 'letter', 'daily_question'].includes(p.contentType)
        )
          return;
        for (const userId of p.userRecipientIds) {
          const kind =
            p.contentType === 'voice'
              ? 'voice_sent'
              : p.contentType === 'image'
                ? 'photo_sent'
                : 'play';
          await this.record(tx, {
            userId,
            characterId: p.senderRefId,
            kind,
            sourceType: 'message',
            sourceId: p.messageId,
            scope: p.scope,
            text:
              kind === 'voice_sent'
                ? '我给你发了一条语音。'
                : kind === 'photo_sent'
                  ? '我给你发了一张照片。'
                  : '我们有了一次问答或书信互动。',
            occurredAt: new Date(event.occurredAt),
          });
        }
      },
    });
    this.bus.subscribe({
      consumer: 'ai.shared_episode_post',
      eventType: 'moments.post_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.authorKind === 'character' && p.authorCharacterId)
          await this.record(tx, {
            userId: p.ownerUserId,
            characterId: p.authorCharacterId,
            kind: 'moment_posted',
            sourceType: 'post',
            sourceId: p.postId,
            scope: 'normal',
            text: '我发了一条朋友圈。',
            occurredAt: new Date(event.occurredAt),
          });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.shared_episode_comment',
      eventType: 'moments.comment_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.authorKind === 'character' && p.authorCharacterId)
          await this.record(tx, {
            userId: p.ownerUserId,
            characterId: p.authorCharacterId,
            kind: p.replyToKind ? 'moment_replied' : 'moment_commented',
            sourceType: 'comment',
            sourceId: p.commentId,
            scope: 'normal',
            text: p.replyToKind ? '我回复了一条朋友圈评论。' : '我评论了一条朋友圈。',
            occurredAt: new Date(event.occurredAt),
          });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.shared_episode_like',
      eventType: 'moments.post_liked',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.likerKind === 'character' && p.likerCharacterId)
          await this.record(tx, {
            userId: p.ownerUserId,
            characterId: p.likerCharacterId,
            kind: 'moment_commented',
            sourceType: 'like',
            sourceId: p.postId,
            scope: 'normal',
            importance: 2,
            text: '我给一条朋友圈点了赞。',
            occurredAt: new Date(event.occurredAt),
          });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.shared_episode_recall',
      eventType: 'chat.message_recalled',
      handle: async (event, tx) => {
        await this.forgetSource(tx, 'message', event.payload.messageId);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.shared_episode_purge',
      eventType: 'contacts.contact_purged',
      handle: async (event, tx) => {
        const { userId, characterId } = event.payload;
        await this.store.lock(tx, userId);
        for (const table of ['shared_episode_states', 'shared_episode_months', 'shared_episodes'])
          await tx.query(`DELETE FROM ai_runtime.${table} WHERE user_id=$1 AND character_id=$2`, [
            userId,
            characterId,
          ]);
      },
    });
  }
  async record(transaction: DbTx | null, input: EpisodeInput): Promise<string | null> {
    const text = input.text.replace(/\s+/gu, ' ').trim().slice(0, 120);
    if (!text || healthPrivate(text)) return null;
    const write = async (tx: DbTx) => {
      if (!(await this.store.lock(tx, input.userId))) return null;
      const epoch = await this.contacts.getActiveContactEpoch(input.userId, input.characterId, tx);
      const at = input.occurredAt ?? this.clock.now();
      if (
        !epoch ||
        (input.epoch && input.epoch !== epoch.version) ||
        at < new Date(epoch.acceptAfter)
      )
        return null;
      if (input.sourceType === 'message') {
        const source = await this.chat.getMessage(input.sourceId, [input.scope], tx);
        if (
          !source ||
          source.status !== 'normal' ||
          source.labels?.includes('health') ||
          source.labels?.includes('quirk_draft')
        )
          return null;
      }
      const id = newId();
      const ciphertext = await this.store.crypto.seal(
        input.userId,
        `ai:episode:${id}`,
        JSON.stringify({ text, withCharacterIds: input.withCharacterIds ?? [] }),
        tx,
      );
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO ai_runtime.shared_episodes(id,user_id,character_id,epoch,scope,kind,source_key,ciphertext,embedding,importance,occurred_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::vector(256),$10,$11,$12) ON CONFLICT(user_id,character_id,epoch,source_key) DO NOTHING RETURNING id`,
        [
          id,
          input.userId,
          input.characterId,
          epoch.version,
          input.scope,
          input.kind,
          keyOf(input.sourceType, input.sourceId),
          ciphertext,
          toVectorLiteral(embed(text)),
          input.importance ?? 5,
          at,
          this.clock.now(),
        ],
      );
      return inserted.rows[0]?.id ?? null;
    };
    return transaction ? write(transaction) : this.db.transaction(write);
  }
  private async open(row: Row, tx: DbTx) {
    if (!row.ciphertext) return null;
    const bytes = await this.store.crypto.open(
      row.user_id,
      `ai:episode:${row.id}`,
      row.ciphertext,
      tx,
    );
    try {
      return Payload.parse(JSON.parse(bytes.toString('utf8')));
    } finally {
      bytes.fill(0);
    }
  }
  async context(userId: string, characterId: string, scope: 'normal' | 'adult', query: string) {
    return this.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, userId))) return { stable: '', recent: '', relevant: '' };
      const epoch = await this.contacts.getActiveContactEpoch(userId, characterId, tx);
      if (!epoch) return { stable: '', recent: '', relevant: '' };
      const now = this.clock.now();
      const rows = (
        await tx.query<Row>(
          `SELECT * FROM ai_runtime.shared_episodes WHERE user_id=$1 AND character_id=$2 AND epoch=$3 AND deleted_at IS NULL AND ciphertext IS NOT NULL AND ($4='adult' OR scope='normal') ORDER BY occurred_at DESC LIMIT 500`,
          [userId, characterId, epoch.version, scope],
        )
      ).rows;
      const decoded: (Row & { text: string })[] = [];
      for (const row of rows) {
        const payload = await this.open(row, tx);
        if (payload && !healthPrivate(payload.text)) decoded.push({ ...row, text: payload.text });
      }
      const state = (
        await tx.query<{ frozen_at: Date; ciphertext: Buffer }>(
          'SELECT * FROM ai_runtime.shared_episode_states WHERE user_id=$1 AND character_id=$2 AND epoch=$3 AND scope=$4',
          [userId, characterId, epoch.version, scope],
        )
      ).rows[0];
      let frozen: z.infer<typeof Snapshot> | null = null;
      const aad = `ai:episodes-window:${characterId}:${epoch.version}:${scope}`;
      if (state && state.frozen_at.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) {
        const bytes = await this.store.crypto.open(userId, aad, state.ciphertext, tx);
        try {
          frozen = Snapshot.parse(JSON.parse(bytes.toString('utf8')));
        } finally {
          bytes.fill(0);
        }
      }
      if (!frozen) {
        const chosen = decoded
          .filter((e) => now.getTime() - e.occurred_at.getTime() <= 7 * 86400000)
          .sort(
            (a, b) =>
              b.importance - a.importance || b.occurred_at.getTime() - a.occurred_at.getTime(),
          )
          .slice(0, 8);
        frozen = {
          ids: chosen.map((e) => e.id),
          text: takeWithin(
            chosen.map((e) => `- ${e.occurred_at.toISOString().slice(0, 10)} ${e.text}`),
            600,
          ).join('\n'),
        };
        await tx.query(
          `INSERT INTO ai_runtime.shared_episode_states(user_id,character_id,epoch,scope,frozen_at,ciphertext) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,character_id,epoch,scope) DO UPDATE SET frozen_at=EXCLUDED.frozen_at,ciphertext=EXCLUDED.ciphertext`,
          [
            userId,
            characterId,
            epoch.version,
            scope,
            now,
            await this.store.crypto.seal(userId, aad, JSON.stringify(frozen), tx),
          ],
        );
      }
      const selected = new Set(frozen.ids);
      const recent = decoded
        .filter((e) => !selected.has(e.id) && e.created_at > (state?.frozen_at ?? now))
        .slice(0, 5);
      recent.forEach((e) => selected.add(e.id));
      const relevant = query.trim()
        ? decoded
            .filter((e) => !selected.has(e.id))
            .sort(
              (a, b) =>
                relevance(b.text, query, b.importance, now.getTime() - b.occurred_at.getTime()) -
                relevance(a.text, query, a.importance, now.getTime() - a.occurred_at.getTime()),
            )
            .slice(0, 3)
            .map((e) => e.text)
        : [];
      const months = (
        await tx.query<{ id: string; ciphertext: Buffer }>(
          "SELECT id,ciphertext FROM ai_runtime.shared_episode_months WHERE user_id=$1 AND character_id=$2 AND epoch=$3 AND ($4='adult' OR scope='normal') ORDER BY month DESC LIMIT 2",
          [userId, characterId, epoch.version, scope],
        )
      ).rows;
      if (query.trim())
        for (const month of months) {
          const bytes = await this.store.crypto.open(
            userId,
            `ai:episodes-month:${month.id}`,
            month.ciphertext,
            tx,
          );
          try {
            const items = Archived.parse(JSON.parse(bytes.toString('utf8')));
            relevant.push(
              ...items
                .filter((e) => relevance(e.text, query, 5, now.getTime() - Date.parse(e.at)) > 0.15)
                .slice(-3)
                .map((e) => e.text),
            );
          } finally {
            bytes.fill(0);
          }
        }
      return {
        stable: frozen.text,
        recent: takeWithin(
          recent.map((e) => e.text),
          300,
        ).join('\n'),
        relevant: takeWithin(relevant, 350).join('\n'),
      };
    });
  }
  async list(userId: string, characterId: string, since: Date): Promise<TimelineEntry[]> {
    return this.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, userId))) return [];
      const epoch = await this.contacts.getActiveContactEpoch(userId, characterId, tx);
      if (!epoch) return [];
      const rows = (
        await tx.query<Row>(
          `SELECT * FROM ai_runtime.shared_episodes WHERE user_id=$1 AND character_id=$2 AND epoch=$3 AND scope='normal' AND deleted_at IS NULL AND occurred_at>=$4 ORDER BY occurred_at DESC LIMIT 2000`,
          [userId, characterId, epoch.version, since],
        )
      ).rows;
      const result: TimelineEntry[] = [];
      for (const row of rows) {
        const payload = await this.open(row, tx);
        if (payload && !healthPrivate(payload.text))
          result.push({
            entryId: row.id,
            source: 'shared_episode',
            occurredAt: row.occurred_at.toISOString(),
            kind: null,
            summary: payload.text,
            moodAfter: null,
            withCharacterIds: payload.withCharacterIds,
            ref: null,
          });
      }
      return result;
    });
  }
  async remove(userId: string, characterId: string, id: string) {
    await this.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, userId))) throw new AppError('unauthenticated', '账号已失效');
      if (!(await this.contacts.getActiveContactEpoch(userId, characterId, tx)))
        throw new AppError('not_found', '好友不存在');
      const row = (
        await tx.query<Row>(
          'SELECT * FROM ai_runtime.shared_episodes WHERE id=$1 AND user_id=$2 AND character_id=$3 FOR UPDATE',
          [id, userId, characterId],
        )
      ).rows[0];
      if (row) await this.erase(tx, row);
    });
  }
  private async erase(tx: DbTx, row: Row) {
    if (row.archive_month) {
      const month = (
        await tx.query<{ id: string; ciphertext: Buffer }>(
          'SELECT id,ciphertext FROM ai_runtime.shared_episode_months WHERE user_id=$1 AND character_id=$2 AND epoch=$3 AND scope=$4 AND month=$5 FOR UPDATE',
          [row.user_id, row.character_id, row.epoch, row.scope, row.archive_month],
        )
      ).rows[0];
      if (month) {
        const bytes = await this.store.crypto.open(
          row.user_id,
          `ai:episodes-month:${month.id}`,
          month.ciphertext,
          tx,
        );
        let items: z.infer<typeof Archived>;
        try {
          items = Archived.parse(JSON.parse(bytes.toString('utf8'))).filter((e) => e.id !== row.id);
        } finally {
          bytes.fill(0);
        }
        await tx.query('UPDATE ai_runtime.shared_episode_months SET ciphertext=$2 WHERE id=$1', [
          month.id,
          await this.store.crypto.seal(
            row.user_id,
            `ai:episodes-month:${month.id}`,
            JSON.stringify(items),
            tx,
          ),
        ]);
      }
    }
    await tx.query(
      'UPDATE ai_runtime.shared_episodes SET ciphertext=NULL,embedding=NULL,deleted_at=$2 WHERE id=$1',
      [row.id, this.clock.now()],
    );
    await tx.query(
      'DELETE FROM ai_runtime.shared_episode_states WHERE user_id=$1 AND character_id=$2',
      [row.user_id, row.character_id],
    );
    await invalidateReplyPlans(tx, this.store, row.user_id, row.character_id);
    // Pending group inputs must also be regenerated after forgetting.
    await tx.query(
      `UPDATE ai_runtime.group_reply_plans SET status='cancelled',plan_ciphertext=NULL,input_ciphertext=NULL,result_ciphertext=NULL,lease_id=NULL,lease_until=NULL,retry_epoch=retry_epoch+1,updated_at=$2 WHERE user_id=$1 AND status IN ('queued','generating','waiting')`,
      [row.user_id, this.clock.now()],
    );
  }
  async forgetSource(tx: DbTx, type: string, id: string) {
    const rows = (
      await tx.query<Row>(
        'SELECT * FROM ai_runtime.shared_episodes WHERE source_key=$1 ORDER BY user_id',
        [keyOf(type, id)],
      )
    ).rows;
    for (const row of rows) {
      if (await this.store.lock(tx, row.user_id)) await this.erase(tx, row);
    }
  }
  async archive() {
    const users = (
      await this.db.query<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM ai_runtime.shared_episodes WHERE ciphertext IS NOT NULL AND occurred_at<$1 LIMIT 50`,
        [new Date(this.clock.nowMs() - 90 * 86400000)],
      )
    ).rows;
    for (const { user_id: userId } of users)
      await this.db.transaction(async (tx) => {
        if (!(await this.store.lock(tx, userId))) return;
        const rows = (
          await tx.query<Row>(
            'SELECT * FROM ai_runtime.shared_episodes WHERE user_id=$1 AND ciphertext IS NOT NULL AND occurred_at<$2 ORDER BY occurred_at LIMIT 500',
            [userId, new Date(this.clock.nowMs() - 90 * 86400000)],
          )
        ).rows;
        for (const row of rows) {
          const payload = await this.open(row, tx);
          if (!payload) continue;
          const month = row.occurred_at.toISOString().slice(0, 7);
          const old = (
            await tx.query<{ id: string; ciphertext: Buffer }>(
              'SELECT * FROM ai_runtime.shared_episode_months WHERE user_id=$1 AND character_id=$2 AND epoch=$3 AND scope=$4 AND month=$5 FOR UPDATE',
              [userId, row.character_id, row.epoch, row.scope, month],
            )
          ).rows[0];
          let items: z.infer<typeof Archived> = [];
          const id = old?.id ?? newId();
          if (old) {
            const bytes = await this.store.crypto.open(
              userId,
              `ai:episodes-month:${id}`,
              old.ciphertext,
              tx,
            );
            try {
              items = Archived.parse(JSON.parse(bytes.toString('utf8')));
            } finally {
              bytes.fill(0);
            }
          }
          if (!items.some((item) => item.id === row.id))
            items.push({ id: row.id, at: row.occurred_at.toISOString(), text: payload.text });
          await tx.query(
            `INSERT INTO ai_runtime.shared_episode_months(id,user_id,character_id,epoch,scope,month,ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,character_id,epoch,scope,month) DO UPDATE SET ciphertext=EXCLUDED.ciphertext`,
            [
              id,
              userId,
              row.character_id,
              row.epoch,
              row.scope,
              month,
              await this.store.crypto.seal(
                userId,
                `ai:episodes-month:${id}`,
                JSON.stringify(items.slice(-1000)),
                tx,
              ),
            ],
          );
          await tx.query(
            'UPDATE ai_runtime.shared_episodes SET ciphertext=NULL,embedding=NULL,archive_month=$2 WHERE id=$1',
            [row.id, month],
          );
        }
        await tx.query(
          'DELETE FROM ai_runtime.shared_episode_months WHERE user_id=$1 AND month<$2',
          [userId, new Date(this.clock.nowMs() - 730 * 86400000).toISOString().slice(0, 7)],
        );
      });
  }
}
