import type { Database } from '../../platform/index.js';
export { UpdateLogService, REALTIME_UPDATE_CHANNEL } from './application/update-log.js';
export { RealtimeLifecycle } from './application/lifecycle.js';
export class RealtimeTestQueries {
  constructor(private readonly db: Database) {}
  async rows(userId: string) {
    return (
      await this.db.query<{ encrypted_payload: Buffer }>(
        'SELECT encrypted_payload FROM realtime.user_updates WHERE user_id = $1',
        [userId],
      )
    ).rows;
  }
  async removeUpdate(userId: string, seq: number) {
    await this.db.query(
      'DELETE FROM realtime.user_updates WHERE user_id = $1 AND update_seq = $2',
      [userId, seq],
    );
  }
}
export { SocketServer } from './infra/socket-server.js';
export { PresenceService } from './application/presence.js';
