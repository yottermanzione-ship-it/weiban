import { Inject, Injectable } from '@nestjs/common';
import {
  Id,
  LocalDate,
  type ContactsReadPort,
  type IdentityAccountStatusPort,
} from '@weiban/contracts';
import { AppError, type DbTx } from '../../../platform/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';

@Injectable()
export class ProactiveGuards {
  constructor(
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
  ) {}
  async lock(tx: DbTx, userId: string): Promise<void> {
    validateId(userId);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('proactive:user:' || $1,0))", [
      userId,
    ]);
  }
  async requireContact(userId: string, characterId: string, tx?: DbTx): Promise<void> {
    validateId(userId);
    validateId(characterId);
    if (
      (await this.accounts.getAccountStatus(userId, tx)) !== 'active' ||
      !(await this.contacts.getActiveContactEpoch(userId, characterId, tx))
    ) {
      throw new AppError('not_found', '账号或联系人不可用');
    }
  }
}
export function validateId(value: string): void {
  if (!Id.safeParse(value).success) throw new AppError('bad_request', 'ID 无效');
}
export function validateDate(value: string): void {
  if (!LocalDate.safeParse(value).success) throw new AppError('bad_request', '日期无效');
}
