/** 公开搜索缓存、跨进程候选额度和 Search/Fetch 节流。原查询不落库，正文不进共享缓存。 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  WebSearchHit,
  type MediaCallResult,
  type WebSearchResultItem,
  type ModelPurpose,
  type IdentityAccountStatusPort,
} from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  newId,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { localDate } from '../../../platform/time/local-time.js';
import { webSearchCache, webToolLimits } from '../infra/db/schema.js';
import { normalizeSearchQuery } from '../domain/web-search.js';
import { GatewayLimitsService } from './limits.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';

const Shared = z.object({
  items: z.array(WebSearchHit),
  modelKey: z.string(),
  usageRecordId: z.string(),
});
@Injectable()
export class WebToolsStore {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(GatewayLimitsService) private readonly limits: GatewayLimitsService,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
  ) {}
  key(modelKey: string, purpose: ModelPurpose, query: string, max: number, originalQuestion = '') {
    return createHash('sha256')
      .update(
        JSON.stringify([
          modelKey,
          purpose,
          normalizeSearchQuery(query),
          max,
          normalizeSearchQuery(originalQuestion),
        ]),
      )
      .digest('hex');
  }
  /** 短事务领取公开查询租约；供应商网络调用不占用数据库连接。 */
  async claim(key: string, purpose: ModelPurpose) {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('web:cache:' || $1,0))", [key]);
      const [row] = await tx.db
        .select()
        .from(webSearchCache)
        .where(eq(webSearchCache.queryKey, key));
      if (row && row.expiresAt > this.clock.now() && row.results) {
        const parsed = Shared.safeParse(row.results);
        if (parsed.success)
          return {
            kind: 'hit' as const,
            value: { ...parsed.data, chargedMicros: 0, latencyMs: 0 },
          };
      }
      if (row && row.leaseUntil > this.clock.now()) return { kind: 'busy' as const };
      const token = newId();
      const value = {
        queryKey: key,
        purpose,
        leaseToken: token,
        leaseUntil: new Date(this.clock.nowMs() + 120000),
        results: null,
        fetchedAt: this.clock.now(),
        expiresAt: this.clock.now(),
      };
      await tx.db
        .insert(webSearchCache)
        .values(value)
        .onConflictDoUpdate({ target: webSearchCache.queryKey, set: value });
      return { kind: 'claimed' as const, token };
    });
  }
  async finish(
    key: string,
    token: string,
    purpose: ModelPurpose,
    value: (MediaCallResult & { items: WebSearchResultItem[] }) | null,
  ) {
    const ttl =
      purpose === 'admin_public_update_search'
        ? 12 * 3600000
        : purpose === 'search_candidates'
          ? 86400000
          : 7 * 86400000;
    const results = value
      ? {
          modelKey: value.modelKey,
          usageRecordId: value.usageRecordId,
          items: value.items.map(({ content: _content, ...hit }) => {
            void _content;
            return hit;
          }),
        }
      : null;
    await this.db.db
      .update(webSearchCache)
      .set({
        results,
        fetchedAt: this.clock.now(),
        leaseUntil: this.clock.now(),
        expiresAt: new Date(this.clock.nowMs() + (value ? ttl : 0)),
      })
      .where(and(eq(webSearchCache.queryKey, key), eq(webSearchCache.leaseToken, token)));
  }
  /** 必须在同一事务先核对全部计数，失败不消耗另一层额度。 */
  private async consume(
    entries: { key: string; window: string; cap: number }[],
    userId?: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (userId && (await this.accounts.getAccountStatus(userId, tx)) !== 'active') return false;
      const rows: { entry: (typeof entries)[number]; count: number }[] = [];
      for (const entry of [...entries].sort((a, b) => a.key.localeCompare(b.key))) {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('web:limit:' || $1,0))", [
          entry.key,
        ]);
        const [row] = await tx.db
          .select()
          .from(webToolLimits)
          .where(eq(webToolLimits.key, entry.key));
        const count = row?.window === entry.window ? row.count : 0;
        if (count >= entry.cap) return false;
        rows.push({ entry, count });
      }
      for (const { entry, count } of rows)
        await this.writeCount(tx, entry.key, entry.window, count + 1);
      return true;
    });
  }
  private async writeCount(tx: DbTx, key: string, window: string, count: number) {
    const values = { key, window, count, updatedAt: this.clock.now() };
    await tx.db
      .insert(webToolLimits)
      .values(values)
      .onConflictDoUpdate({ target: webToolLimits.key, set: values });
  }
  async consumeCandidate(userId: string) {
    const config = await this.limits.get();
    const day = localDate(this.clock.now(), 'Asia/Shanghai');
    return this.consume(
      [
        { key: 'candidates:global', window: day, cap: config.searchCandidatesGlobalDay ?? 5000 },
        {
          key: `candidates:user:${userId}`,
          window: day,
          cap: config.searchCandidatesPerUserDay ?? 20,
        },
        {
          key: `candidates:minute:${userId}`,
          window: String(Math.floor(this.clock.nowMs() / 60000)),
          cap: 5,
        },
      ],
      userId,
    );
  }
  async allowRequest(kind: 'search' | 'fetch', host?: string) {
    const window = String(Math.floor(this.clock.nowMs() / 1000));
    return this.consume([
      { key: `qps:${kind}`, window, cap: kind === 'search' ? 20 : 5 },
      ...(kind === 'fetch' && host
        ? [
            {
              key: `qps:fetch-host:${createHash('sha256').update(host).digest('hex')}`,
              window,
              cap: 1,
            },
          ]
        : []),
    ]);
  }
  async cleanup() {
    await this.db.db
      .delete(webSearchCache)
      .where(
        and(
          lt(webSearchCache.expiresAt, new Date(this.clock.nowMs() - 86400000)),
          lt(webSearchCache.leaseUntil, this.clock.now()),
        ),
      );
    await this.db.db
      .delete(webToolLimits)
      .where(lt(webToolLimits.updatedAt, new Date(this.clock.nowMs() - 7 * 86400000)));
  }
}
