import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  Id,
  UpdateCompanionSettingsRequest,
  type IdentityAccountStatusPort,
  type ContactsReadPort,
  type CompanionSettings,
  type SyncPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { companionSettings } from '../infra/db/schema.js';
@Injectable()
export class CompanionSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
  ) {}
  private async guard(userId: string, characterId: string | null): Promise<void> {
    parseContract(Id, userId);
    if (characterId !== null) {
      parseContract(Id, characterId);
      if (!(await this.contacts.getActiveContact(userId, characterId)))
        throw new AppError('not_found', '好友不存在');
    }
  }
  private async lock(tx: DbTx, userId: string): Promise<void> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))", [
      userId,
    ]);
    if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
      throw new AppError('unauthenticated', '账号已失效');
  }
  private async load(
    tx: DbTx,
    userId: string,
    characterId: string | null,
  ): Promise<CompanionSettings & { inheritsDefaults: boolean }> {
    const query = (id: string | null) =>
      tx.db
        .select()
        .from(companionSettings)
        .where(
          and(
            eq(companionSettings.userId, userId),
            id === null
              ? isNull(companionSettings.characterId)
              : eq(companionSettings.characterId, id),
          ),
        );
    const [specific] = await query(characterId);
    const row = specific ?? (characterId !== null ? (await query(null))[0] : undefined);
    return {
      instantReply: row?.instantReply ?? false,
      splitBubbles: row?.splitBubbles ?? true,
      updatedAt: (row?.updatedAt ?? this.clock.now()).toISOString(),
      inheritsDefaults: characterId !== null && !specific,
    };
  }
  async get(
    userId: string,
    characterId: string | null,
  ): Promise<CompanionSettings & { inheritsDefaults: boolean }> {
    await this.guard(userId, characterId);
    return this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      return this.load(tx, userId, characterId);
    });
  }
  async update(
    userId: string,
    characterId: string | null,
    input: unknown,
  ): Promise<CompanionSettings & { inheritsDefaults: boolean }> {
    const patch = parseContract(UpdateCompanionSettingsRequest, input);
    await this.guard(userId, characterId);
    return this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      if (characterId && !(await this.contacts.getActiveContactEpoch(userId, characterId, tx)))
        throw new AppError('not_found', '好友不存在');
      const old = await this.load(tx, userId, characterId);
      if (!Object.keys(patch).length) return old;
      const values = {
        userId,
        characterId,
        instantReply: patch.instantReply ?? old.instantReply,
        splitBubbles: patch.splitBubbles ?? old.splitBubbles,
        updatedAt: this.clock.now(),
      };
      await tx.db
        .insert(companionSettings)
        .values({ id: newId(), ...values })
        .onConflictDoUpdate({
          target: [companionSettings.userId, companionSettings.characterId],
          set: values,
        });
      await this.sync.appendUpdate(tx, userId, {
        type: 'settings.updated',
        data: { section: 'companion', characterId },
      });
      return { ...values, updatedAt: values.updatedAt.toISOString(), inheritsDefaults: false };
    });
  }
}
