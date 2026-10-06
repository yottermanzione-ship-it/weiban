import type { Database } from '../../platform/index.js';
export { ChatLifecycle } from './application/lifecycle.js';
export { ChatStore } from './application/store.js';
export class ChatTestQueries {
  constructor(private readonly db: Database) {}
  async messages(conversationId: string) {
    return (
      await this.db.query<{
        id: string;
        seq: string;
        scope: string;
        content_ciphertext: Buffer | null;
      }>(
        'SELECT id,seq,scope,content_ciphertext FROM chat.messages WHERE conversation_id=$1 ORDER BY seq',
        [conversationId],
      )
    ).rows;
  }
}
