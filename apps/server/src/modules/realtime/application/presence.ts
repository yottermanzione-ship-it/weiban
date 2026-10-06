import { Inject, Injectable } from '@nestjs/common';
import { ClientPresenceFrame, Id, type SyncPort } from '@weiban/contracts';
import { CLOCK, DATABASE, type Clock, type Database, type DbTx } from '../../../platform/index.js';
import { UpdateLogService } from './update-log.js';
export const REALTIME_CONTROL_CHANNEL = 'weiban_realtime_control';
export const REALTIME_TYPING_CHANNEL = 'weiban_realtime_typing';
export const PRESENCE_TTL_MS = 45000;
@Injectable()
export class PresenceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(UpdateLogService) private readonly log: UpdateLogService,
  ) {}
  async connect(userId: string, sessionId: string, connectionId: string): Promise<number> {
    Id.parse(sessionId);
    Id.parse(connectionId);
    return this.db.transaction(async (tx) => {
      if (!(await this.log.isActive(tx, userId))) return -1;
      await tx.query(
        `INSERT INTO realtime.device_presence (session_id,user_id,connection_id,foreground,last_seen_at) VALUES ($1,$2,$3,false,$4)
        ON CONFLICT (session_id) DO UPDATE SET connection_id=$3,conversation_id=NULL,foreground=false,last_seen_at=$4`,
        [sessionId, userId, connectionId, this.clock.now()],
      );
      await tx.query('SELECT pg_notify($1,$2)', [
        REALTIME_CONTROL_CHANNEL,
        JSON.stringify({ sessionId, connectionId }),
      ]);
      const cursor = await tx.query<{ seq: string }>(
        'SELECT last_update_seq AS seq FROM realtime.user_update_cursors WHERE user_id=$1',
        [userId],
      );
      return Number(cursor.rows[0]?.seq ?? 0);
    });
  }
  async focus(
    userId: string,
    sessionId: string,
    connectionId: string,
    input: unknown,
  ): Promise<void> {
    const frame = ClientPresenceFrame.parse(input);
    await this.db.transaction(async (tx) => {
      if (!(await this.log.isActive(tx, userId))) return;
      await tx.query(
        'UPDATE realtime.device_presence SET conversation_id=$4, foreground=$5,last_seen_at=$6 WHERE session_id=$1 AND user_id=$2 AND connection_id=$3',
        [
          sessionId,
          userId,
          connectionId,
          frame.data.conversationId,
          frame.data.foreground,
          this.clock.now(),
        ],
      );
    });
  }
  async touch(userId: string, sessionId: string, connectionId: string): Promise<void> {
    await this.db.query(
      'UPDATE realtime.device_presence SET last_seen_at=$4 WHERE user_id=$1 AND session_id=$2 AND connection_id=$3',
      [userId, sessionId, connectionId, this.clock.now()],
    );
  }
  async disconnect(connectionId: string): Promise<void> {
    await this.db.query('DELETE FROM realtime.device_presence WHERE connection_id=$1', [
      connectionId,
    ]);
  }
  async isViewingConversation(userId: string, conversationId: string): Promise<boolean> {
    Id.parse(userId);
    Id.parse(conversationId);
    const result = await this.db.query(
      'SELECT 1 FROM realtime.device_presence WHERE user_id=$1 AND conversation_id=$2 AND foreground=true AND last_seen_at>$3 LIMIT 1',
      [userId, conversationId, new Date(this.clock.nowMs() - PRESENCE_TTL_MS)],
    );
    return result.rows.length > 0;
  }
  async isCurrent(sessionId: string, connectionId: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT 1 FROM realtime.device_presence WHERE session_id=$1 AND connection_id=$2',
      [sessionId, connectionId],
    );
    return result.rows.length > 0;
  }
  async recordUserActivity(tx: DbTx, userId: string, at: string): Promise<void> {
    if (!(await this.log.isActive(tx, userId))) return;
    await tx.query(
      `INSERT INTO realtime.user_update_cursors (user_id,last_user_activity_at) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET last_user_activity_at=greatest(realtime.user_update_cursors.last_user_activity_at,$2)`,
      [userId, at],
    );
  }
  async getLastUserActivityAt(userId: string): Promise<string | null> {
    Id.parse(userId);
    const row = (
      await this.db.query<{ at: Date | null }>(
        'SELECT last_user_activity_at AS at FROM realtime.user_update_cursors WHERE user_id=$1',
        [userId],
      )
    ).rows[0];
    return row?.at?.toISOString() ?? null;
  }
  async sendEphemeral(
    userId: string,
    frame: Parameters<SyncPort['sendEphemeral']>[1],
  ): Promise<void> {
    // 实际帧校验在 transport 提供的通知消费者处再次执行。
    Id.parse(userId);
    Id.parse(frame.conversationId);
    Id.parse(frame.participantId);
    if (frame.type !== 'typing' || !['start', 'stop'].includes(frame.state))
      throw new Error('无效 typing 状态');
    await this.db.query('SELECT pg_notify($1,$2)', [
      REALTIME_TYPING_CHANNEL,
      JSON.stringify({
        userId,
        frame: {
          v: 1,
          type: 'typing',
          data: {
            conversationId: frame.conversationId,
            participantId: frame.participantId,
            state: frame.state,
          },
        },
      }),
    ]);
  }
  async pruneExpired(): Promise<void> {
    await this.db.query('DELETE FROM realtime.device_presence WHERE last_seen_at <= $1', [
      new Date(this.clock.nowMs() - PRESENCE_TTL_MS),
    ]);
  }
}
