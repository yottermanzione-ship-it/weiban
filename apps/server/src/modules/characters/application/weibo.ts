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
  async publish(
    transaction: Parameters<WeiboPublicationPort['publish']>[0],
    input: Parameters<WeiboPublicationPort['publish']>[1],
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
      throw new Error('weibo role unavailable');
    if (role.legacyCard) {
      const marker = parseLegacyCard(role.legacyCard)?.weiboProfile;
      if (
        !marker?.enabled ||
        marker.nickname !== input.nickname ||
        marker.userId !== input.weiboUserId
      )
        throw new Error('weibo marker changed');
    } else {
      const plain = await this.crypto.open(
        PLATFORM_KEY_OWNER,
        `character:${role.id}:published:${role.personaVersion}`,
        role.publishedCiphertext!,
        tx,
      );
      try {
        const body = AdminCharacterWrite.parse(JSON.parse(plain.toString('utf8')));
        if (
          body.card?.data.profileExtra?.weibo?.nickname !== input.nickname ||
          body.card?.data.profileExtra?.weibo?.userId !== input.weiboUserId
        )
          throw new Error('weibo marker changed');
      } finally {
        plain.fill(0);
      }
    }
    const key = `weibo:${createHash('sha256').update(input.sourceUrl).digest('hex')}`;
    const old = (
      await tx.query<{ id: string; status: string }>(
        "SELECT id,status FROM characters.public_updates WHERE character_id=$1 AND source_key=$2 AND source='weibo_sync'",
        [input.characterId, key],
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
      reviewNote: 'H4：带微博标记的公开来源同步；非人工审核',
      createdBy: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }
}
