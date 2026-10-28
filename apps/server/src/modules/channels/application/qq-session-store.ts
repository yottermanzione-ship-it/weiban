import { Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppError, DATABASE, type Database, type DbTx } from '../../../platform/index.js';
import type { BindingRow } from './channel-store.js';
import { QQ_REPLY_MAX } from '../domain/qq-openapi.js';

export interface QqSessionRow {
  binding_id: string;
  generation: number;
  app_fingerprint: string;
  app_id_sealed: Buffer;
  app_secret_sealed: Buffer;
  pairing_hash: Buffer | null;
  pairing_expires_at: Date | null;
  pairing_failures: number;
  reply_id_sealed: Buffer | null;
  reply_expires_at: Date | null;
  reply_seq: number;
}
export interface QqDeliveryRef {
  sealed: Buffer;
  sequence: number;
  expiresAt: Date;
}
@Injectable()
export class QqSessionStore {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  async recordError(binding: BindingRow, message: string | null, now: Date): Promise<void> {
    await this.db.query(
      "UPDATE channels.bindings SET last_error=$3,last_poll_at=$4,updated_at=$4 WHERE id=$1 AND generation=$2 AND channel='qq'",
      [binding.id, binding.generation, message, now],
    );
  }
  async get(bindingId: string): Promise<QqSessionRow | null> {
    return (
      (
        await this.db.query<QqSessionRow>(
          'SELECT * FROM channels.qq_sessions WHERE binding_id=$1',
          [bindingId],
        )
      ).rows[0] ?? null
    );
  }
  async assertAvailable(tx: DbTx, fingerprint: string, userId: string): Promise<void> {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [fingerprint]);
    const occupied = await tx.query<{ user_id: string }>(
      'SELECT b.user_id FROM channels.qq_sessions q JOIN channels.bindings b ON b.id=q.binding_id WHERE q.app_fingerprint=$1',
      [fingerprint],
    );
    if (occupied.rows.some((row) => row.user_id !== userId))
      throw new AppError(
        'conflict',
        '这个QQ机器人已有其他站内账号绑定，不会自动接管或解除他人的连接',
      );
  }
  async save(
    tx: DbTx,
    binding: BindingRow,
    input: {
      fingerprint: string;
      appIdSealed: Buffer;
      secretSealed: Buffer;
      hash: Buffer;
      expiresAt: Date;
      now: Date;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO channels.qq_sessions (binding_id,generation,app_fingerprint,app_id_sealed,app_secret_sealed,pairing_hash,pairing_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(binding_id) DO UPDATE SET generation=excluded.generation,app_fingerprint=excluded.app_fingerprint,
      app_id_sealed=excluded.app_id_sealed,app_secret_sealed=excluded.app_secret_sealed,pairing_hash=excluded.pairing_hash,pairing_expires_at=excluded.pairing_expires_at,
      pairing_failures=0,reply_id_sealed=NULL,reply_expires_at=NULL,reply_seq=0`,
      [
        binding.id,
        binding.generation,
        input.fingerprint,
        input.appIdSealed,
        input.secretSealed,
        input.hash,
        input.expiresAt,
      ],
    );
    await tx.query(
      "UPDATE channels.bindings SET status='unbound',bound_at=NULL,context_token_sealed=NULL,updated_at=$2 WHERE id=$1 AND channel='qq'",
      [binding.id, input.now],
    );
  }
  async refresh(
    tx: DbTx,
    binding: BindingRow,
    character: { characterId: string; name: string },
    hashForGeneration: (generation: number) => Buffer,
    expiresAt: Date,
    now: Date,
  ): Promise<void> {
    const result = await tx.query<{ generation: number }>(
      `UPDATE channels.bindings SET generation=generation+1,status='unbound',character_id=$3,character_name=$4,context_token_sealed=NULL,last_error=NULL,updated_at=$5
      WHERE id=$1 AND user_id=$2 AND channel='qq' AND status<>'active' RETURNING generation`,
      [binding.id, binding.user_id, character.characterId, character.name, now],
    );
    const generation = result.rows[0]?.generation;
    if (!generation) throw new AppError('conflict', 'QQ状态已改变，请刷新页面');
    await tx.query(
      'UPDATE channels.qq_sessions SET generation=$2,pairing_hash=$3,pairing_expires_at=$4,pairing_failures=0,reply_id_sealed=NULL,reply_expires_at=NULL,reply_seq=0 WHERE binding_id=$1',
      [binding.id, generation, hashForGeneration(generation), expiresAt],
    );
    await tx.query(
      "UPDATE channels.outbound_messages SET status='skipped',last_error='QQ绑定码已更新',updated_at=$2 WHERE binding_id=$1 AND status IN ('pending','sending','retry')",
      [binding.id, now],
    );
  }
  async runnable(now: Date): Promise<BindingRow[]> {
    return (
      await this.db.query<BindingRow>(
        `SELECT b.* FROM channels.bindings b JOIN channels.qq_sessions q ON q.binding_id=b.id AND q.generation=b.generation
      WHERE b.channel='qq' AND (b.status='active' OR (b.status='unbound' AND q.pairing_hash IS NOT NULL AND q.pairing_expires_at>$1 AND q.pairing_failures<10))`,
        [now],
      )
    ).rows;
  }
  async consume(
    binding: BindingRow,
    hash: Buffer,
    peerSealed: Buffer,
    replySealed: Buffer,
    replyExpiresAt: Date,
    now: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query<QqSessionRow & { status: string }>(
          `SELECT q.*,b.status FROM channels.qq_sessions q JOIN channels.bindings b ON b.id=q.binding_id
        WHERE q.binding_id=$1 AND q.generation=$2 AND b.generation=$2 AND b.user_id=$3 AND b.channel='qq' FOR UPDATE OF q,b`,
          [binding.id, binding.generation, binding.user_id],
        )
      ).rows[0];
      if (
        !row ||
        row.status !== 'unbound' ||
        !row.pairing_hash ||
        !row.pairing_expires_at ||
        row.pairing_expires_at <= now ||
        row.pairing_failures >= 10
      )
        return false;
      if (row.pairing_hash.length !== hash.length || !timingSafeEqual(row.pairing_hash, hash)) {
        await tx.query(
          'UPDATE channels.qq_sessions SET pairing_failures=pairing_failures+1 WHERE binding_id=$1',
          [binding.id],
        );
        return false;
      }
      await tx.query(
        'UPDATE channels.qq_sessions SET pairing_hash=NULL,pairing_expires_at=NULL,reply_id_sealed=$2,reply_expires_at=$3,reply_seq=1 WHERE binding_id=$1',
        [binding.id, replySealed, replyExpiresAt],
      );
      await tx.query(
        "UPDATE channels.bindings SET status='active',context_token_sealed=$2,bound_at=$3,last_event_at=$3,last_error=NULL,updated_at=$3 WHERE id=$1",
        [binding.id, peerSealed, now],
      );
      return true;
    });
  }
  async setReply(binding: BindingRow, sealed: Buffer, expiresAt: Date): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE channels.qq_sessions q SET reply_id_sealed=$3,reply_expires_at=$4,reply_seq=0
      FROM channels.bindings b WHERE q.binding_id=$1 AND q.generation=$2 AND b.id=q.binding_id AND b.generation=$2 AND b.channel='qq' AND b.status='active'`,
      [binding.id, binding.generation, sealed, expiresAt],
    );
    return result.rowCount === 1;
  }
  async reserveDelivery(
    outboundId: string,
    binding: BindingRow,
    now: Date,
  ): Promise<QqDeliveryRef | null> {
    return this.db.transaction(async (tx) => {
      const session = (
        await tx.query<QqSessionRow>(
          `SELECT q.* FROM channels.qq_sessions q JOIN channels.bindings b ON b.id=q.binding_id
        WHERE q.binding_id=$1 AND q.generation=$2 AND b.generation=$2 AND b.status='active' AND b.channel='qq' FOR UPDATE OF q`,
          [binding.id, binding.generation],
        )
      ).rows[0];
      if (!session) return null;
      const row = (
        await tx.query<{
          qq_reply_id_sealed: Buffer | null;
          qq_reply_seq: number | null;
          qq_reply_expires_at: Date | null;
        }>(
          "SELECT qq_reply_id_sealed,qq_reply_seq,qq_reply_expires_at FROM channels.outbound_messages WHERE id=$1 AND binding_id=$2 AND channel='qq' AND status='sending' FOR UPDATE",
          [outboundId, binding.id],
        )
      ).rows[0];
      if (!row) return null;
      if (row.qq_reply_id_sealed && row.qq_reply_seq && row.qq_reply_expires_at)
        return row.qq_reply_expires_at > now
          ? {
              sealed: row.qq_reply_id_sealed,
              sequence: row.qq_reply_seq,
              expiresAt: row.qq_reply_expires_at,
            }
          : null;
      if (
        !session.reply_id_sealed ||
        !session.reply_expires_at ||
        session.reply_expires_at <= now ||
        session.reply_seq >= QQ_REPLY_MAX
      )
        return null;
      const sequence = session.reply_seq + 1;
      await tx.query('UPDATE channels.qq_sessions SET reply_seq=$2 WHERE binding_id=$1', [
        binding.id,
        sequence,
      ]);
      await tx.query(
        'UPDATE channels.outbound_messages SET qq_reply_id_sealed=$2,qq_reply_seq=$3,qq_reply_expires_at=$4 WHERE id=$1',
        [outboundId, session.reply_id_sealed, sequence, session.reply_expires_at],
      );
      return { sealed: session.reply_id_sealed, sequence, expiresAt: session.reply_expires_at };
    });
  }
}
