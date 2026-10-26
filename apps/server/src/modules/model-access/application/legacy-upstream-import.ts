/** Operator-only maintenance: no probe, defaults, catalog, prices, balances or legacy ciphertext copy. */
import { Inject, Injectable } from '@nestjs/common';
import { v5 as uuidV5 } from 'uuid';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  PLATFORM_KEY_OWNER,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { maskParts, normalizeApiKey, upstreamAad } from '../domain/rules.js';
import {
  legacyFail,
  legacyKind,
  parseLegacyMetadata,
  validateLegacyPayload,
  type LegacyReceiverMetadata,
} from '../domain/legacy-import.js';

export interface LegacyImportResult {
  batchId: string;
  createdCount: number;
  unchangedCount: number;
  targetIds: string[];
}
@Injectable()
export class LegacyUpstreamImportService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}
  async apply(
    operatorId: string,
    metadata: LegacyReceiverMetadata,
    raw: unknown,
  ): Promise<LegacyImportResult> {
    metadata = parseLegacyMetadata(metadata);
    if (operatorId !== metadata.operatorId) legacyFail('OPERATOR_MISMATCH');
    const data = validateLegacyPayload(raw, metadata, this.clock.now());
    if (!this.crypto.isAvailable()) legacyFail('PLATFORM_CRYPTO_UNAVAILABLE');
    return this.database.transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('legacy-upstream-import:' || $1,0))",
        [metadata.batchId],
      );
      validateLegacyPayload(data, metadata, this.clock.now());
      const result: LegacyImportResult = {
        batchId: metadata.batchId,
        createdCount: 0,
        unchangedCount: 0,
        targetIds: [],
      };
      for (const row of data.accounts) {
        // A fresh batch namespace makes NEW UUIDs; repeat application never overwrites a row.
        const id = uuidV5(row.sourceId, metadata.batchId);
        result.targetIds.push(id);
        const existing = await tx.query<{ id: string }>(
          'SELECT id FROM model_access.upstreams WHERE id=$1 FOR UPDATE',
          [id],
        );
        if (existing.rows.length) {
          result.unchangedCount++;
          continue;
        }
        const key = normalizeApiKey(row.apiKey);
        if (!key) legacyFail('CREDENTIAL_INVALID');
        const sealed = await this.crypto.seal(PLATFORM_KEY_OWNER, upstreamAad(id), key, tx);
        const mask = maskParts(key),
          now = this.clock.now();
        await tx.query(
          `INSERT INTO model_access.upstreams
          (id,name,kind,base_url,secret_ciphertext,display_prefix,display_suffix,status,status_changed_at,created_at,updated_at,provider,priority,weight,enabled,last_tested_at,note)
          VALUES($1,$2,$3,$4,$5,$6,$7,'unavailable',$8,$8,$8,$9,1,100,false,NULL,$10)`,
          [
            id,
            `旧版待核-${row.vendor}-${result.targetIds.length}-${metadata.batchId.slice(0, 8)}`,
            legacyKind(row.vendor),
            row.baseUrl,
            sealed,
            mask.prefix,
            mask.suffix,
            now,
            row.vendor === 'mimo' ? 'xiaomi_mimo' : row.vendor,
            `Legacy import batch ${metadata.batchId}; pending protocol, pricing and consent validation`,
          ],
        );
        await tx.query(
          `INSERT INTO model_access.upstream_status(id,upstream_id,from_status,to_status,source,failure,changed_at)
          VALUES($1,$2,NULL,'unavailable','created',NULL,$3)`,
          [newId(), id, now],
        );
        result.createdCount++;
      }
      await this.audit.record(
        {
          module: 'model_access',
          action: 'legacy_import.completed',
          actorType: 'admin',
          actorId: operatorId,
          targetType: 'legacy_import_batch',
          targetId: metadata.batchId,
          details: {
            exportId: data.exportId,
            createdCount: result.createdCount,
            unchangedCount: result.unchangedCount,
          },
        },
        tx,
      );
      return result;
    });
  }
}
