import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  type Tx,
  Contact,
  Id,
  type IdentityAccountStatusPort,
  type ContactsReadPort,
} from '@weiban/contracts';
import {
  asDbTx,
  DATABASE,
  ENVELOPE_CRYPTO,
  parseContract,
  type Database,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { contacts } from '../infra/db/schema.js';
export type ContactRow = typeof contacts.$inferSelect;
export function contactDto(row: ContactRow): Contact {
  return Contact.parse({
    characterId: row.characterId,
    status: row.status,
    remark: row.remark,
    customAvatarMediaId: row.customAvatarMediaId,
    addressAs: row.addressAs,
    relationship: row.relationshipType,
    knownSince: row.knownSince,
    conversationId: row.status === 'active' ? row.conversationId : null,
    addedAt: row.addedAt.toISOString(),
  });
}
@Injectable()
export class ContactsReadService implements ContactsReadPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
  ) {}
  async getActiveContact(userId: string, characterId: string, input?: Tx): Promise<Contact | null> {
    parseContract(Id, userId);
    parseContract(Id, characterId);
    if ((await this.accounts.getAccountStatus(userId, input)) !== 'active') return null;
    const [row] = await (input ? asDbTx(input).db : this.db.db)
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, userId),
          eq(contacts.characterId, characterId),
          eq(contacts.status, 'active'),
        ),
      );
    return row ? contactDto(row) : null;
  }
  async getActiveContactEpoch(
    userId: string,
    characterId: string,
    input?: Tx,
  ): Promise<{ version: string; acceptAfter: string } | null> {
    parseContract(Id, userId);
    parseContract(Id, characterId);
    if ((await this.accounts.getAccountStatus(userId, input)) !== 'active') return null;
    const query = (input ? asDbTx(input).db : this.db.db)
      .select({ epoch: contacts.requestId, acceptAfter: contacts.acceptAfter })
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, userId),
          eq(contacts.characterId, characterId),
          eq(contacts.status, 'active'),
        ),
      );
    const [row] = await (input ? query.for('share') : query);
    return row ? { version: row.epoch, acceptAfter: row.acceptAfter.toISOString() } : null;
  }
  async listActiveContacts(userId: string): Promise<Contact[]> {
    parseContract(Id, userId);
    if ((await this.accounts.getAccountStatus(userId)) !== 'active') return [];
    const rows = await this.db.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.status, 'active')))
      .orderBy(contacts.characterId);
    return rows.map(contactDto);
  }
  async getPendingGreeting(userId: string, characterId: string): Promise<string | null> {
    parseContract(Id, userId);
    parseContract(Id, characterId);
    if ((await this.accounts.getAccountStatus(userId)) !== 'active') return null;
    const [row] = await this.db.db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, userId),
          eq(contacts.characterId, characterId),
          eq(contacts.status, 'active'),
        ),
      );
    if (!row?.greetingCiphertext) return null;
    const plain = await this.crypto.open(
      userId,
      `contacts:greeting:${row.id}`,
      row.greetingCiphertext,
    );
    try {
      return plain.toString('utf8');
    } finally {
      plain.fill(0);
    }
  }
}
