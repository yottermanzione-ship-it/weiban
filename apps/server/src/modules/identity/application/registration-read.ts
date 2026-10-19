/** 契约 3.18 IdentityRegistrationReadPort：注册时间（v5 批 B 新用户记忆体验用）。 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { IdentityRegistrationReadPort, Tx } from '@weiban/contracts';
import { DATABASE, asDbTx, type Database } from '../../../platform/index.js';
import { users } from '../infra/db/schema.js';

@Injectable()
export class RegistrationReadService implements IdentityRegistrationReadPort {
  constructor(@Inject(DATABASE) private readonly database: Database) {}
  async getRegisteredAt(userId: string, tx?: Tx): Promise<string | null> {
    const db = tx ? asDbTx(tx).db : this.database.db;
    const [row] = await db
      .select({ createdAt: users.createdAt, status: users.status })
      .from(users)
      .where(eq(users.id, userId));
    return row && row.status === 'active' ? row.createdAt.toISOString() : null;
  }
}
