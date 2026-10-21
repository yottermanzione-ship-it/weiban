import { Inject, Injectable } from '@nestjs/common';
import {
  WebSearchHit,
  type SharedSearchBillingPort,
  type SharedWebSearchPort,
  type IdentityDirectoryPort,
} from '@weiban/contracts';
import { z } from 'zod';
import { DATABASE, CLOCK, type Database, type Clock } from '../../../platform/index.js';
import { BILLING_SHARED_SEARCH_PORT } from '../../billing/index.js';
import { IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
import { ModelGatewayMedia } from './media-gateway.js';
import { CatalogService } from './catalog.js';
/** One normal platform supplier call; reimbursement remains entirely inside billing. */
@Injectable()
export class SharedWebSearch implements SharedWebSearchPort {
  constructor(
    @Inject(ModelGatewayMedia) private readonly media: ModelGatewayMedia,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(BILLING_SHARED_SEARCH_PORT) private readonly shares: SharedSearchBillingPort,
    @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory: IdentityDirectoryPort,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}
  async search(
    input: Parameters<SharedWebSearchPort['search']>[0],
  ): ReturnType<SharedWebSearchPort['search']> {
    const old = (
      await this.db.query<{
        character_id: string;
        group_id: string;
        usage_record_id: string;
        is_free: boolean;
        items: unknown;
      }>('SELECT * FROM model_access.shared_search_receipts WHERE request_key=$1', [input.key])
    ).rows[0];
    if (old) {
      if (old.character_id !== input.characterId) return { ok: false };
      const items = z.array(WebSearchHit).max(5).parse(old.items);
      if (old.is_free) await this.shares.cancel(old.group_id);
      const fee = old.is_free
        ? { collectedMicros: 0, userCharges: {} as Record<string, number> }
        : await this.shares.settle(old.group_id, old.usage_record_id);
      return {
        ok: true,
        items,
        chargedMicros: fee.collectedMicros,
        requesterChargeMicros: fee.userCharges[input.requesterUserId] ?? 0,
      };
    }
    const model = await this.catalog.internalModel('web_search');
    const [adminId] = await this.directory.listAdminUserIds();
    if (!model?.entry || !adminId || !(await this.media.isServiceEnabled('web_search')))
      return { ok: false };
    const group = await this.shares.begin({
      key: input.key,
      characterId: input.characterId,
      modelKey: model.modelKey,
      userIds: input.userIds,
    });
    if (!group || !group.userIds.length || group.state !== 'pending') return { ok: false };
    const result = await this.media.webSearch({
      userId: adminId,
      characterId: input.characterId,
      purpose: 'admin_public_update_search',
      billingOwner: 'platform',
      query: input.query,
      maxResults: 5,
      idempotencyKey: `weibo:${group.groupId}`,
    });
    if (!result.ok) {
      await this.shares.cancel(group.groupId);
      return { ok: false };
    }
    await this.db.query(
      `INSERT INTO model_access.shared_search_receipts(request_key,character_id,group_id,usage_record_id,is_free,items,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(request_key) DO NOTHING`,
      [
        input.key,
        input.characterId,
        group.groupId,
        result.value.usageRecordId,
        result.value.chargedMicros === 0,
        JSON.stringify(result.value.items),
        this.clock.now(),
      ],
    );
    let chargedMicros = 0;
    let requesterChargeMicros = 0;
    // Shared-cache hits point at an older usage; never reimburse it again.
    if (result.value.chargedMicros > 0) {
      const fee = await this.shares.settle(group.groupId, result.value.usageRecordId);
      chargedMicros = fee.collectedMicros;
      requesterChargeMicros = fee.userCharges[input.requesterUserId] ?? 0;
    } else await this.shares.cancel(group.groupId);
    return { ok: true, items: result.value.items, chargedMicros, requesterChargeMicros };
  }
}
