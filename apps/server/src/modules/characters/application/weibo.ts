import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AdminCharacterWrite, type WeiboPublicationPort } from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import {
  asDbTx,
  CLOCK,
  ENVELOPE_CRYPTO,
  PLATFORM_KEY_OWNER,
  newId,
  type Clock,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { characters, publicUpdates } from '../infra/db/schema.js';
import { parseLegacyCard } from '../domain/legacy-card.js';
/** H4-specific verified public-source import. Ordinary auto_search candidates still require review. */
@Injectable()
export class WeiboPublication implements WeiboPublicationPort {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
  ) {}
  async sourceMatches(
    transaction: Parameters<WeiboPublicationPort['sourceMatches']>[0],
    input: Parameters<WeiboPublicationPort['sourceMatches']>[1],
  ) {
    const tx = asDbTx(transaction);
    const [role] = await tx.db
      .select()
      .from(characters)
      .where(eq(characters.id, input.characterId))
      .for('share');
    if (
      !role ||
      role.kind !== 'preset' ||
      role.status !== 'published' ||
      (role.eligibilityOverride?.realPersonKind ?? role.realPersonKind) === 'private_person' ||
      (!role.legacyCard && !role.publishedCiphertext)
    )
      return false;
    const matches = (marker: { nickname: string; userId?: string } | null | undefined) =>
      !!marker &&
      (marker.userId
        ? marker.userId === input.weiboUserId
        : marker.nickname.normalize('NFKC').toLowerCase() ===
          input.nickname.normalize('NFKC').toLowerCase());
    if (role.legacyCard) {
      const marker = parseLegacyCard(role.legacyCard)?.weiboProfile;
      return !!marker?.enabled && matches(marker);
    }
    const plain = await this.crypto.open(
      PLATFORM_KEY_OWNER,
      `character:${role.id}:published:${role.personaVersion}`,
      role.publishedCiphertext!,
      tx,
    );
    try {
      const body = AdminCharacterWrite.parse(JSON.parse(plain.toString('utf8')));
      return matches(body.card?.data.profileExtra?.weibo);
    } finally {
      plain.fill(0);
    }
  }
  async isEffective(
    transaction: Parameters<WeiboPublicationPort['isEffective']>[0],
    characterId: string,
    updateId: string,
  ): Promise<boolean> {
    const result = await asDbTx(transaction).query(
      `SELECT 1 FROM characters.public_updates
        WHERE id=$1 AND character_id=$2 AND source='weibo_sync' AND status='effective'
        FOR SHARE`,
      [updateId, characterId],
    );
    return !!result.rows[0];
  }
  async publish(
    transaction: Parameters<WeiboPublicationPort['publish']>[0],
    input: Parameters<WeiboPublicationPort['publish']>[1],
  ) {
    if (!(await this.sourceMatches(transaction, input))) throw new Error('weibo marker changed');
    const tx = asDbTx(transaction);
    const canonicalKey = (url: string) => `weibo:${createHash('sha256').update(url).digest('hex')}`;
    const key = canonicalKey(input.sourceUrl);
    const keys = [key, ...(input.sourceAliases ?? []).map(canonicalKey)];
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('weibo-public-update:' || $1 || ':' || $2,0))",
      [input.characterId, key],
    );
    const old = (
      await tx.query<{ id: string; status: string }>(
        `SELECT id,status FROM characters.public_updates
          WHERE character_id=$1 AND source_key=ANY($2::text[]) AND source='weibo_sync'
          ORDER BY (status <> 'effective') DESC, (source_key=$3) DESC LIMIT 1`,
        [input.characterId, keys, key],
      )
    ).rows[0];
    if (old) return old.status === 'effective' ? old.id : null;
    const id = newId(),
      now = this.clock.now();
    await tx.db.insert(publicUpdates).values({
      id,
      characterId: input.characterId,
      kind: 'other',
      content: input.content.slice(0, 500),
      startDate: input.publishedOn,
      endDate: null,
      effectiveDate: input.publishedOn,
      sourceUrl: input.sourceUrl,
      sourceKey: key,
      source: 'weibo_sync',
      status: 'effective',
      reviewNote:
        input.origin === 'muse'
          ? 'Muse 已核实的公开来源投稿'
          : 'H4：带微博标记的公开来源同步；非人工审核',
      createdBy: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }
}
