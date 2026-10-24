/**
 * channels 的持久化层（3.42）。所有 SQL 集中在这里，服务层与后台 worker 共用。
 *
 * 约定：
 * - 凭据列（bot_token_sealed / weibo_app_* / qrcode_sealed / context_token_sealed）与消息正文列
 *   （text_sealed）只存**该用户 DEK 加密后的 bytea**；本层不解密，也不碰信封密钥。
 * - 一切「后台会碰到的行」都带 generation：重建绑定会 +1，旧的后台任务因此自动作废。
 * - 解绑保留 tombstone 行，但清空凭据、游标与账号字段，并丢弃该绑定的排队消息。
 */
import type { ChannelId, ChannelBindingStatus } from '@weiban/contracts';
import { newId, type Database, type DbTx } from '../../../platform/index.js';
import type { InboundOutcomeValue, OutboundStatusValue } from '../infra/db/schema.js';

export interface BindingRow {
  id: string;
  user_id: string;
  channel: ChannelId;
  status: ChannelBindingStatus;
  character_id: string | null;
  character_name: string | null;
  account_id: string | null;
  account_name: string | null;
  bot_id: string | null;
  base_url: string;
  cursor: string;
  bot_token_sealed: Buffer | null;
  weibo_app_id_sealed: Buffer | null;
  weibo_app_secret_sealed: Buffer | null;
  context_token_sealed: Buffer | null;
  generation: number;
  bound_at: Date | null;
  last_event_at: Date | null;
  last_poll_at: Date | null;
  last_error: string | null;
}

export interface AttemptRow {
  id: string;
  user_id: string;
  channel: ChannelId;
  status: string;
  character_id: string;
  character_name: string;
  qrcode_sealed: Buffer;
  bind_url: string;
  poll_base_url: string;
  expires_at: Date;
  confirmed_binding_id: string | null;
  last_error: string | null;
}

export interface OutboundRow {
  id: string;
  binding_id: string;
  user_id: string;
  channel: ChannelId;
  chat_message_id: string;
  text_sealed: Buffer;
  status: OutboundStatusValue;
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
}

const BINDING_COLUMNS = `id,user_id,channel,status,character_id,character_name,account_id,account_name,
  bot_id,base_url,cursor,bot_token_sealed,weibo_app_id_sealed,weibo_app_secret_sealed,
  context_token_sealed,generation,bound_at,last_event_at,last_poll_at,last_error`;

const ATTEMPT_COLUMNS = `id,user_id,channel,status,character_id,character_name,qrcode_sealed,bind_url,
  poll_base_url,expires_at,confirmed_binding_id,last_error`;

export class ChannelStore {
  constructor(private readonly db: Database) {}

  async bindingsOf(userId: string): Promise<BindingRow[]> {
    const { rows } = await this.db.query<BindingRow>(
      `SELECT ${BINDING_COLUMNS} FROM channels.bindings WHERE user_id=$1`,
      [userId],
    );
    return rows;
  }

  async bindingOf(userId: string, channel: ChannelId): Promise<BindingRow | null> {
    const { rows } = await this.db.query<BindingRow>(
      `SELECT ${BINDING_COLUMNS} FROM channels.bindings WHERE user_id=$1 AND channel=$2`,
      [userId, channel],
    );
    return rows[0] ?? null;
  }

  async bindingById(id: string): Promise<BindingRow | null> {
    const { rows } = await this.db.query<BindingRow>(
      `SELECT ${BINDING_COLUMNS} FROM channels.bindings WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** 未过期的待扫码会话（同一用户同一渠道最多一条）。 */
  async pendingAttempt(userId: string, channel: ChannelId, now: Date): Promise<AttemptRow | null> {
    const { rows } = await this.db.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM channels.bind_attempts
        WHERE user_id=$1 AND channel=$2 AND status IN ('creating','wait','scanned') AND expires_at>$3`,
      [userId, channel, now],
    );
    return rows[0] ?? null;
  }

  async attemptOf(userId: string, attemptId: string): Promise<AttemptRow | null> {
    const { rows } = await this.db.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM channels.bind_attempts WHERE id=$1 AND user_id=$2`,
      [attemptId, userId],
    );
    return rows[0] ?? null;
  }

  /** 作废该用户该渠道所有待扫码会话（出新码时旧码立即失效）。 */
  async discardPendingAttempts(
    tx: DbTx,
    userId: string,
    channel: ChannelId,
    now: Date,
  ): Promise<void> {
    await tx.query(
      `UPDATE channels.bind_attempts
          SET status='expired', last_error='已生成新二维码，这张作废', updated_at=$3
        WHERE user_id=$1 AND channel=$2 AND status IN ('creating','wait','scanned')`,
      [userId, channel, now],
    );
  }

  async insertAttempt(
    tx: DbTx,
    input: {
      id: string;
      userId: string;
      channel: ChannelId;
      characterId: string;
      characterName: string;
      qrcodeSealed: Buffer;
      bindUrl: string;
      expiresAt: Date;
      now: Date;
    },
  ): Promise<string> {
    const id = input.id;
    await tx.query(
      `INSERT INTO channels.bind_attempts
         (id,user_id,channel,status,character_id,character_name,qrcode_sealed,bind_url,
          poll_base_url,expires_at,created_at,updated_at)
       VALUES($1,$2,$3,'wait',$4,$5,$6,$7,'',$8,$9,$9)`,
      [
        id,
        input.userId,
        input.channel,
        input.characterId,
        input.characterName,
        input.qrcodeSealed,
        input.bindUrl,
        input.expiresAt,
        input.now,
      ],
    );
    return id;
  }

  async updateAttempt(
    tx: DbTx,
    attemptId: string,
    patch: { status?: string; pollBaseUrl?: string; lastError?: string | null },
    now: Date,
  ): Promise<void> {
    await tx.query(
      `UPDATE channels.bind_attempts
          SET status=COALESCE($2,status),
              poll_base_url=COALESCE($3,poll_base_url),
              last_error=$4,
              updated_at=$5
        WHERE id=$1`,
      [attemptId, patch.status ?? null, patch.pollBaseUrl ?? null, patch.lastError ?? null, now],
    );
  }

  /** 出站用：该用户与某角色的 active 绑定（一个角色只可能挂在一个渠道上，取第一条）。 */
  async activeBindingForCharacter(userId: string, characterId: string): Promise<BindingRow | null> {
    const { rows } = await this.db.query<BindingRow>(
      `SELECT ${BINDING_COLUMNS} FROM channels.bindings
        WHERE user_id=$1 AND character_id=$2 AND status='active'
        ORDER BY updated_at DESC
        LIMIT 1`,
      [userId, characterId],
    );
    return rows[0] ?? null;
  }

  async activeBindings(channel: ChannelId, limit: number): Promise<BindingRow[]> {
    const { rows } = await this.db.query<BindingRow>(
      `SELECT ${BINDING_COLUMNS} FROM channels.bindings
        WHERE channel=$1 AND status='active'
        ORDER BY last_poll_at NULLS FIRST
        LIMIT $2`,
      [channel, limit],
    );
    return rows;
  }

  /**
   * 保存（或重建）绑定：同一个对面账号先解除别人的旧绑定，再 upsert 自己这一行。
   * 行 id 由调用方给（密文的 AAD 与 id 绑定）：重建时必须复用已有的 id，否则旧密文解不开。
   */
  async saveBinding(
    tx: DbTx,
    input: {
      id: string;
      userId: string;
      channel: ChannelId;
      characterId: string;
      characterName: string;
      accountId: string;
      accountName: string | null;
      botId: string | null;
      baseUrl: string;
      botTokenSealed: Buffer | null;
      weiboAppIdSealed: Buffer | null;
      weiboAppSecretSealed: Buffer | null;
      now: Date;
    },
  ): Promise<BindingRow> {
    const id = input.id;
    await tx.query(
      `UPDATE channels.bindings
          SET status='revoked', account_id=NULL, account_name=NULL, bot_id=NULL, base_url='',
              cursor='', bot_token_sealed=NULL, weibo_app_id_sealed=NULL,
              weibo_app_secret_sealed=NULL, context_token_sealed=NULL,
              unbound_at=$3, last_error=$4, updated_at=$3
        WHERE channel=$1 AND account_id=$2 AND status='active' AND user_id<>$5`,
      [input.channel, input.accountId, input.now, '对面账号已改绑到其他微伴账号', input.userId],
    );
    const { rows } = await tx.query<BindingRow>(
      `INSERT INTO channels.bindings
         (id,user_id,channel,status,character_id,character_name,account_id,account_name,bot_id,base_url,
          cursor,generation,bot_token_sealed,weibo_app_id_sealed,weibo_app_secret_sealed,bound_at,
          unbound_at,last_poll_at,last_error,created_at,updated_at)
       VALUES($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,'',1,$10,$11,$12,$13,NULL,NULL,NULL,$13,$13)
       ON CONFLICT (user_id,channel) DO UPDATE SET
         status='active', character_id=excluded.character_id, character_name=excluded.character_name,
         account_id=excluded.account_id, account_name=excluded.account_name, bot_id=excluded.bot_id,
         base_url=excluded.base_url, cursor='',
         generation=channels.bindings.generation+1,
         bot_token_sealed=excluded.bot_token_sealed,
         weibo_app_id_sealed=excluded.weibo_app_id_sealed,
         weibo_app_secret_sealed=excluded.weibo_app_secret_sealed,
         context_token_sealed=NULL, bound_at=excluded.bound_at, unbound_at=NULL,
         last_poll_at=NULL, last_error=NULL, updated_at=excluded.updated_at
       RETURNING ${BINDING_COLUMNS}`,
      [
        id,
        input.userId,
        input.channel,
        input.characterId,
        input.characterName,
        input.accountId,
        input.accountName,
        input.botId,
        input.baseUrl,
        input.botTokenSealed,
        input.weiboAppIdSealed,
        input.weiboAppSecretSealed,
        input.now,
      ],
    );
    return rows[0]!;
  }

  async setCharacter(
    tx: DbTx,
    userId: string,
    channel: ChannelId,
    characterId: string,
    characterName: string,
    now: Date,
  ): Promise<void> {
    await tx.query(
      `UPDATE channels.bindings
          SET character_id=$3, character_name=$4, updated_at=$5
        WHERE user_id=$1 AND channel=$2`,
      [userId, channel, characterId, characterName, now],
    );
  }

  /** 解绑：清空凭据与账号（tombstone），丢掉排队消息；待扫码会话一并作废。 */
  async unbind(tx: DbTx, userId: string, channel: ChannelId, now: Date): Promise<void> {
    await tx.query(
      `UPDATE channels.bind_attempts
          SET status='expired', last_error='已解除绑定', updated_at=$3
        WHERE user_id=$1 AND channel=$2 AND status IN ('creating','wait','scanned')`,
      [userId, channel, now],
    );
    await tx.query(
      `UPDATE channels.outbound_messages
          SET status='skipped', last_error='已解除绑定', updated_at=$3
        WHERE user_id=$1 AND channel=$2 AND status IN ('pending','retry','sending')`,
      [userId, channel, now],
    );
    await tx.query(
      `UPDATE channels.bindings
          SET status='unbound', account_id=NULL, account_name=NULL, bot_id=NULL, base_url='',
              cursor='', bot_token_sealed=NULL, weibo_app_id_sealed=NULL,
              weibo_app_secret_sealed=NULL, context_token_sealed=NULL,
              generation=generation+1, bound_at=NULL, unbound_at=$3, last_error=NULL, updated_at=$3
        WHERE user_id=$1 AND channel=$2 AND status<>'unbound'`,
      [userId, channel, now],
    );
  }

  /** 保存轮询结果（游标 + context_token）；generation 不一致说明绑定已重建，返回 false。 */
  async recordPoll(
    tx: DbTx,
    input: {
      bindingId: string;
      generation: number;
      cursor: string;
      contextTokenSealed: Buffer | null;
      now: Date;
    },
  ): Promise<boolean> {
    const result = await tx.query(
      `UPDATE channels.bindings
          SET cursor=$3,
              context_token_sealed=COALESCE($4,context_token_sealed),
              last_poll_at=$5, updated_at=$5
        WHERE id=$1 AND generation=$2 AND status='active'`,
      [input.bindingId, input.generation, input.cursor, input.contextTokenSealed, input.now],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async touchPollError(bindingId: string, message: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE channels.bindings SET last_poll_at=$2, last_error=$3, updated_at=$2
        WHERE id=$1 AND status='active'`,
      [bindingId, now, message.slice(0, 200)],
    );
  }

  /** 会话永久失效（iLink errcode -14）：停轮询、清凭据、留 tombstone。 */
  async markRevoked(
    tx: DbTx,
    bindingId: string,
    generation: number,
    reason: string,
    now: Date,
  ): Promise<void> {
    await tx.query(
      `UPDATE channels.bindings
          SET status='revoked', account_id=NULL, account_name=NULL, bot_id=NULL, base_url='',
              cursor='', bot_token_sealed=NULL, weibo_app_id_sealed=NULL,
              weibo_app_secret_sealed=NULL, context_token_sealed=NULL,
              unbound_at=$4, last_error=$3, updated_at=$4
        WHERE id=$1 AND generation=$2`,
      [bindingId, generation, reason.slice(0, 200), now],
    );
  }

  async markRevokedQuiet(bindingId: string, reason: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE channels.bindings
          SET status='revoked', account_id=NULL, account_name=NULL, bot_id=NULL, base_url='',
              cursor='', bot_token_sealed=NULL, weibo_app_id_sealed=NULL,
              weibo_app_secret_sealed=NULL, context_token_sealed=NULL,
              unbound_at=$3, last_error=$2, updated_at=$3
        WHERE id=$1`,
      [bindingId, reason.slice(0, 200), now],
    );
  }

  async touchEvent(bindingId: string, now: Date): Promise<void> {
    await this.db.query(
      'UPDATE channels.bindings SET last_event_at=$2, updated_at=$2 WHERE id=$1',
      [bindingId, now],
    );
  }

  /** 入站流水：唯一键命中返回 null（重复投递，不再处理）。 */
  async insertInbound(input: {
    bindingId: string;
    userId: string;
    channel: ChannelId;
    externalMessageId: string;
    senderId: string;
    textSealed: Buffer | null;
    contextTokenSealed: Buffer | null;
    messageCreatedAt: Date | null;
    now: Date;
  }): Promise<{ id: string; clientMsgId: string } | null> {
    const id = newId();
    const clientMsgId = newId();
    const { rows } = await this.db.query<{ id: string; client_msg_id: string }>(
      `INSERT INTO channels.inbound_messages
         (id,binding_id,user_id,channel,external_message_id,sender_id,text_sealed,context_token_sealed,
          client_msg_id,message_created_at,outcome,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$11)
       ON CONFLICT (binding_id, external_message_id) DO NOTHING
       RETURNING id, client_msg_id`,
      [
        id,
        input.bindingId,
        input.userId,
        input.channel,
        input.externalMessageId,
        input.senderId,
        input.textSealed,
        input.contextTokenSealed,
        clientMsgId,
        input.messageCreatedAt,
        input.now,
      ],
    );
    const row = rows[0];
    return row ? { id: row.id, clientMsgId: row.client_msg_id } : null;
  }

  async finishInbound(
    id: string,
    outcome: InboundOutcomeValue,
    reason: string | null,
    chatMessageId: string | null,
    now: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE channels.inbound_messages
          SET outcome=$2, reason=$3, chat_message_id=$4, updated_at=$5
        WHERE id=$1 AND outcome='pending'`,
      [id, outcome, reason?.slice(0, 200) ?? null, chatMessageId, now],
    );
  }

  /** 出站排队：同一条聊天消息只排一次。 */
  async enqueueOutbound(
    tx: DbTx,
    input: {
      bindingId: string;
      userId: string;
      channel: ChannelId;
      chatMessageId: string;
      textSealed: Buffer;
      now: Date;
    },
  ): Promise<string | null> {
    const id = newId();
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO channels.outbound_messages
         (id,binding_id,user_id,channel,chat_message_id,text_sealed,status,attempts,next_attempt_at,
          created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,'pending',0,$7,$7,$7)
       ON CONFLICT (binding_id, chat_message_id) DO NOTHING
       RETURNING id`,
      [
        id,
        input.bindingId,
        input.userId,
        input.channel,
        input.chatMessageId,
        input.textSealed,
        input.now,
      ],
    );
    return rows[0]?.id ?? null;
  }

  /** 领一批到期的出站消息（并发安全：SKIP LOCKED，并直接置 sending）。 */
  async claimOutbound(limit: number, now: Date): Promise<OutboundRow[]> {
    const { rows } = await this.db.query<OutboundRow>(
      `UPDATE channels.outbound_messages o
          SET status='sending', attempts=o.attempts+1, updated_at=$1
        WHERE o.id IN (
          SELECT id FROM channels.outbound_messages
           WHERE status IN ('pending','retry') AND next_attempt_at<=$1
           ORDER BY next_attempt_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED)
        RETURNING o.id,o.binding_id,o.user_id,o.channel,o.chat_message_id,o.text_sealed,
                  o.status,o.attempts,o.next_attempt_at,o.last_error`,
      [now, limit],
    );
    return rows;
  }

  async finishOutbound(
    id: string,
    patch: {
      status: OutboundStatusValue;
      lastError?: string | null;
      nextAttemptAt?: Date;
      now: Date;
    },
  ): Promise<void> {
    await this.db.query(
      `UPDATE channels.outbound_messages
          SET status=$2,
              last_error=$3,
              next_attempt_at=COALESCE($4,next_attempt_at),
              sent_at=CASE WHEN $2='sent' THEN $5 ELSE sent_at END,
              updated_at=$5
        WHERE id=$1`,
      [
        id,
        patch.status,
        patch.lastError?.slice(0, 200) ?? null,
        patch.nextAttemptAt ?? null,
        patch.now,
      ],
    );
  }

  async countOutboundDue(now: Date): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM channels.outbound_messages
        WHERE status IN ('pending','retry') AND next_attempt_at<=$1`,
      [now],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** 进程在发送途中崩溃时，sending 行会卡住：超过 2 分钟的统一打回 retry。 */
  async recoverStuckOutbound(before: Date): Promise<number> {
    const result = await this.db.query(
      `UPDATE channels.outbound_messages
          SET status='retry', last_error=COALESCE(last_error,'发送中断，稍后重试'),
              next_attempt_at=$1, updated_at=$1
        WHERE status='sending' AND updated_at<$1`,
      [before],
    );
    return result.rowCount ?? 0;
  }

  /** 过期未用的二维码会话改成 expired（页面据此提示重新生成）。 */
  async expireStaleAttempts(now: Date): Promise<void> {
    await this.db.query(
      `UPDATE channels.bind_attempts
          SET status='expired', last_error=COALESCE(last_error,'二维码已过期，请重新生成'), updated_at=$1
        WHERE status IN ('creating','wait','scanned') AND expires_at<=$1`,
      [now],
    );
  }

  /** 清理历史：7 天前的绑定会话、已完成的入站 / 出站流水。绑定行本身保留（tombstone）。 */
  async pruneHistory(before: Date): Promise<void> {
    await this.db.query('DELETE FROM channels.bind_attempts WHERE created_at<$1', [before]);
    await this.db.query(
      `DELETE FROM channels.inbound_messages
        WHERE created_at<$1 AND outcome IN ('accepted','duplicate','rejected','failed')`,
      [before],
    );
    await this.db.query(
      `DELETE FROM channels.outbound_messages
        WHERE created_at<$1 AND status IN ('sent','skipped','failed')`,
      [before],
    );
  }

  /** 注销：物理删除该用户的全部渠道数据（可重复调用）。 */
  async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const removed: number[] = [];
      for (const table of [
        'channels.outbound_messages',
        'channels.inbound_messages',
        'channels.bind_attempts',
        'channels.bindings',
      ]) {
        const result = await tx.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
        removed.push(result.rowCount ?? 0);
      }
      return removed.reduce((sum, count) => sum + count, 0);
    });
  }

  async countUserData(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM channels.bindings WHERE user_id=$1) +
         (SELECT count(*) FROM channels.bind_attempts WHERE user_id=$1) +
         (SELECT count(*) FROM channels.inbound_messages WHERE user_id=$1) +
         (SELECT count(*) FROM channels.outbound_messages WHERE user_id=$1)
       )::text AS count`,
      [userId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** 后台任务只找「本新站用户自己绑好」的行；不存在任何导入旧站凭据的入口。 */
  async activeBindingIds(channel: ChannelId): Promise<Array<{ id: string; generation: number }>> {
    const { rows } = await this.db.query<{ id: string; generation: number }>(
      `SELECT id,generation FROM channels.bindings WHERE channel=$1 AND status='active'`,
      [channel],
    );
    return rows;
  }
}
