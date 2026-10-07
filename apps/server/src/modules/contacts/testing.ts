export { ContactsCommands, ACCEPT_CONTACT_JOB, PURGE_CONTACT_JOB } from './application/commands.js';
export { ContactsLifecycle } from './application/lifecycle.js';
import type { Database } from '../../platform/index.js';
export class ContactsTestQueries {
  constructor(private readonly db: Database) {}
  async row(userId: string, characterId: string) {
    return (
      await this.db.query<{
        id: string;
        status: string;
        request_id: string;
        accept_after: Date;
        purge_after: Date | null;
        greeting_ciphertext: Buffer | null;
        relationship_type: string;
      }>(
        'SELECT id,status,request_id,accept_after,purge_after,greeting_ciphertext,relationship_type FROM contacts.contacts WHERE user_id=$1 AND character_id=$2',
        [userId, characterId],
      )
    ).rows[0];
  }
}
