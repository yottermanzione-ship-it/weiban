import { Inject, Injectable } from '@nestjs/common';
import {
  ContactOrganizationSnapshot,
  Id,
  type CharacterNameReadPort,
  type IdentityAccountStatusPort,
  type SyncPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  assertLegacyMigrationOwnerAllowed,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { CHARACTER_NAME_READ_PORT } from '../../characters/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import {
  LegacyOrganizationImport,
  normalizeOrganization,
  normalizeOrganizationRequest,
  organizationDigest,
  organizationNameAad,
  type OrganizationValue,
} from '../domain/organization.js';

type Epoch = { id: string; character_id: string; request_id: string };
@Injectable()
export class ContactOrganizationService {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(CHARACTER_NAME_READ_PORT) private readonly names: CharacterNameReadPort,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
  ) {}
  private async lock(tx: DbTx, userId: string, requireActive = true) {
    parseContract(Id, userId);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('contacts:user:' || $1,0))", [
      userId,
    ]);
    if (requireActive && (await this.accounts.getAccountStatus(userId, tx)) !== 'active')
      throw new AppError('unauthenticated', '账号已失效');
  }
  private async active(tx: DbTx, userId: string, ids: string[]) {
    const result = await tx.query<Epoch>(
      "SELECT id,character_id,request_id FROM contacts.contacts WHERE user_id=$1 AND status='active' AND character_id=ANY($2::uuid[]) ORDER BY character_id",
      [userId, ids],
    );
    const visible = new Map<string, Epoch>();
    for (const row of result.rows)
      if ((await this.names.getDisplayName(userId, row.character_id, tx)) !== null)
        visible.set(row.character_id, row);
    return visible;
  }
  private async snapshot(tx: DbTx, userId: string): Promise<ContactOrganizationSnapshot> {
    const state = (
      await tx.query<{ revision: number; updated_at: Date }>(
        'SELECT revision,updated_at FROM contacts.organization WHERE user_id=$1',
        [userId],
      )
    ).rows[0];
    if (!state) return { revision: 0, starredCharacterIds: [], tags: [], updatedAt: null };
    const tags = (
      await tx.query<{ tag_id: string; name_ciphertext: Buffer }>(
        'SELECT tag_id,name_ciphertext FROM contacts.organization_tags WHERE user_id=$1 ORDER BY sort_order,tag_id',
        [userId],
      )
    ).rows;
    const stars = (
      await tx.query<{ character_id: string }>(
        "SELECT s.character_id FROM contacts.organization_stars s JOIN contacts.contacts c ON c.id=s.contact_id AND c.user_id=s.user_id AND c.character_id=s.character_id AND c.request_id=s.contact_epoch AND c.status='active' WHERE s.user_id=$1 ORDER BY s.character_id",
        [userId],
      )
    ).rows;
    const members = (
      await tx.query<{ tag_id: string; character_id: string }>(
        "SELECT m.tag_id,m.character_id FROM contacts.organization_tag_members m JOIN contacts.contacts c ON c.id=m.contact_id AND c.user_id=m.user_id AND c.character_id=m.character_id AND c.request_id=m.contact_epoch AND c.status='active' WHERE m.user_id=$1 ORDER BY m.tag_id,m.character_id",
        [userId],
      )
    ).rows;
    const visible = await this.active(tx, userId, [
      ...new Set([...stars, ...members].map((row) => row.character_id)),
    ]);
    const plaintext = await this.crypto.openMany(
      userId,
      tags.map((tag) => ({ aad: organizationNameAad(tag.tag_id), sealed: tag.name_ciphertext })),
      tx,
    );
    try {
      return parseContract(ContactOrganizationSnapshot, {
        revision: state.revision,
        updatedAt: state.updated_at.toISOString(),
        starredCharacterIds: stars.map((row) => row.character_id).filter((id) => visible.has(id)),
        tags: tags.map((tag, index) => ({
          tagId: tag.tag_id,
          name: plaintext[index]!.toString('utf8'),
          characterIds: members
            .filter((row) => row.tag_id === tag.tag_id && visible.has(row.character_id))
            .map((row) => row.character_id),
        })),
      });
    } finally {
      plaintext.forEach((value) => value.fill(0));
    }
  }
  async get(userId: string) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx, userId);
      return this.snapshot(tx, userId);
    });
  }
  private ids(value: OrganizationValue) {
    return [
      ...new Set([...value.starredCharacterIds, ...value.tags.flatMap((tag) => tag.characterIds)]),
    ].sort();
  }
  private async replace(
    tx: DbTx,
    userId: string,
    value: OrganizationValue,
    revision: number,
    epochs: Map<string, Epoch>,
  ) {
    const at = this.clock.now();
    const sealed = await this.crypto.sealMany(
      userId,
      value.tags.map((tag) => ({ aad: organizationNameAad(tag.tagId), plaintext: tag.name })),
      tx,
    );
    await tx.query(
      'INSERT INTO contacts.organization(user_id,revision,updated_at) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at',
      [userId, revision, at],
    );
    await tx.query('DELETE FROM contacts.organization_stars WHERE user_id=$1', [userId]);
    await tx.query('DELETE FROM contacts.organization_tags WHERE user_id=$1', [userId]);
    if (value.starredCharacterIds.length)
      await tx.query(
        'INSERT INTO contacts.organization_stars(user_id,character_id,contact_id,contact_epoch) SELECT $1,* FROM unnest($2::uuid[],$3::uuid[],$4::uuid[])',
        [
          userId,
          value.starredCharacterIds,
          value.starredCharacterIds.map((id) => epochs.get(id)!.id),
          value.starredCharacterIds.map((id) => epochs.get(id)!.request_id),
        ],
      );
    const tagIds: string[] = [],
      characterIds: string[] = [],
      contactIds: string[] = [],
      requestIds: string[] = [];
    for (const [index, tag] of value.tags.entries()) {
      await tx.query(
        'INSERT INTO contacts.organization_tags(user_id,tag_id,name_ciphertext,sort_order) VALUES($1,$2,$3,$4)',
        [userId, tag.tagId, sealed[index], index],
      );
      for (const id of tag.characterIds) {
        tagIds.push(tag.tagId);
        characterIds.push(id);
        contactIds.push(epochs.get(id)!.id);
        requestIds.push(epochs.get(id)!.request_id);
      }
    }
    if (tagIds.length)
      await tx.query(
        'INSERT INTO contacts.organization_tag_members(user_id,tag_id,character_id,contact_id,contact_epoch) SELECT $1,* FROM unnest($2::uuid[],$3::uuid[],$4::uuid[],$5::uuid[])',
        [userId, tagIds, characterIds, contactIds, requestIds],
      );
  }
  async save(userId: string, input: unknown) {
    const request = normalizeOrganizationRequest(input),
      digest = organizationDigest(request);
    return this.database.transaction(async (tx) => {
      await this.lock(tx, userId);
      const previous = (
        await tx.query<{ request_digest: string }>(
          'SELECT request_digest FROM contacts.organization_commands WHERE user_id=$1 AND command_id=$2',
          [userId, request.clientCommandId],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_digest !== digest)
          throw new AppError('conflict', '这个保存命令已经用于不同内容', {
            details: { reason: 'contact_organization_command_conflict' },
          });
        return { snapshot: await this.snapshot(tx, userId), replayed: true };
      }
      const current = await this.snapshot(tx, userId);
      if (current.revision !== request.expectedRevision)
        throw new AppError('conflict', '星标或标签已更新，请刷新后确认', {
          details: { reason: 'contact_organization_revision_conflict', revision: current.revision },
        });
      const ids = this.ids(request),
        epochs = await this.active(tx, userId, ids);
      if (epochs.size !== ids.length)
        throw new AppError('bad_request', '只能选择当前账号仍可见的好友', {
          details: { reason: 'contact_not_active' },
        });
      await this.replace(tx, userId, request, current.revision + 1, epochs);
      await tx.query(
        'INSERT INTO contacts.organization_commands(user_id,command_id,request_digest,applied_revision) VALUES($1,$2,$3,$4)',
        [userId, request.clientCommandId, digest, current.revision + 1],
      );
      await this.sync.appendUpdate(tx, userId, {
        type: 'data.changed',
        data: { section: 'contact_organization', characterId: null, itemId: null },
      });
      return { snapshot: await this.snapshot(tx, userId), replayed: false };
    });
  }
  /** No HTTP route; isolated adapter must also prove target/database/maintenance scope. */
  async importLegacy(
    userId: string,
    raw: unknown,
    options: { additionalPreservedOwnerDigests?: readonly string[] } = {},
  ) {
    assertLegacyMigrationOwnerAllowed(userId, options.additionalPreservedOwnerDigests);
    const input = parseContract(LegacyOrganizationImport, raw);
    assertLegacyMigrationOwnerAllowed(
      input.sourceAccountId,
      options.additionalPreservedOwnerDigests,
    );
    if (input.sourceAccountId !== userId) throw new AppError('bad_request', '旧账号归属不匹配');
    const value = normalizeOrganization(input),
      digest = organizationDigest({ ...input, ...value });
    return this.database.transaction(async (tx) => {
      await this.lock(tx, userId);
      const receipt = (
        await tx.query<{ payload_digest: string }>(
          'SELECT payload_digest FROM contacts.organization_import_receipts WHERE user_id=$1 AND source_digest=$2',
          [userId, input.sourceDigest],
        )
      ).rows[0];
      const current = await this.snapshot(tx, userId);
      if (receipt) {
        if (receipt.payload_digest !== digest) throw new AppError('conflict', '迁移来源已变化');
        return { status: 'already_imported' as const, snapshot: current };
      }
      if (current.revision !== 0) return { status: 'target_preserved' as const, snapshot: current };
      if (organizationDigest(current) !== input.expectedTargetDigest)
        throw new AppError('conflict', '新版整理状态已变化');
      const ids = this.ids(value),
        epochs = await this.active(tx, userId, ids),
        reviewed = new Map(input.contactEpochs.map((row) => [row.characterId, row.requestId]));
      if (
        epochs.size !== ids.length ||
        reviewed.size !== input.contactEpochs.length ||
        reviewed.size !== ids.length ||
        ids.some((id) => epochs.get(id)?.request_id !== reviewed.get(id))
      )
        throw new AppError('conflict', '好友归属或关系版本已变化');
      await this.replace(tx, userId, value, 1, epochs);
      await tx.query(
        'INSERT INTO contacts.organization_import_receipts(user_id,source_digest,payload_digest,applied_revision,imported_at) VALUES($1,$2,$3,1,$4)',
        [userId, input.sourceDigest, digest, this.clock.now()],
      );
      return { status: 'imported' as const, snapshot: await this.snapshot(tx, userId) };
    });
  }
  /** Caller holds contacts:user. Soft delete removes membership before request_id changes. */
  async removeContact(tx: DbTx, userId: string, characterId: string) {
    const a = await tx.query(
      'DELETE FROM contacts.organization_stars WHERE user_id=$1 AND character_id=$2',
      [userId, characterId],
    );
    const b = await tx.query(
      'DELETE FROM contacts.organization_tag_members WHERE user_id=$1 AND character_id=$2',
      [userId, characterId],
    );
    if ((a.rowCount ?? 0) + (b.rowCount ?? 0) > 0)
      await tx.query(
        'UPDATE contacts.organization SET revision=CASE WHEN revision<2147483647 THEN revision+1 ELSE revision END,updated_at=$2 WHERE user_id=$1',
        [userId, this.clock.now()],
      );
  }
  async purgeCharacter(tx: DbTx, characterId: string) {
    const { rows } = await tx.query<{ user_id: string }>(
      'SELECT user_id FROM contacts.organization_stars WHERE character_id=$1 UNION SELECT user_id FROM contacts.organization_tag_members WHERE character_id=$1 ORDER BY user_id',
      [characterId],
    );
    for (const row of rows) {
      await this.lock(tx, row.user_id, false);
      await this.removeContact(tx, row.user_id, characterId);
    }
  }
  async countUserData(userId: string) {
    const { rows } = await this.database.query<{ n: number }>(
      'SELECT ((SELECT count(*) FROM contacts.organization WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_stars WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_tags WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_tag_members WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_commands WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_import_receipts WHERE user_id=$1))::int AS n',
      [userId],
    );
    return rows[0]?.n ?? 0;
  }
  async purgeUser(userId: string) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx, userId, false);
      const { rows } = await tx.query<{ n: number }>(
        'SELECT ((SELECT count(*) FROM contacts.organization WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_stars WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_tags WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_tag_members WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_commands WHERE user_id=$1)+(SELECT count(*) FROM contacts.organization_import_receipts WHERE user_id=$1))::int AS n',
        [userId],
      );
      await tx.query('DELETE FROM contacts.organization WHERE user_id=$1', [userId]);
      return rows[0]?.n ?? 0;
    });
  }
}
