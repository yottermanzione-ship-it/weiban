/** 回收不确定在途冻结、恢复已保存结果的结算、清除24h结果、探测临时故障上游。 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { BillingReservationPort } from '@weiban/contracts';
import { and, eq, inArray, lt, ne } from 'drizzle-orm';
import {
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  type Clock,
  type Database,
  type JobQueue,
} from '../../../platform/index.js';
import { BILLING_RESERVATION_PORT } from '../../billing/index.js';
import { generationResults, upstreams } from '../infra/db/schema.js';
import { UPSTREAM_PROBE, type UpstreamProbe } from '../tokens.js';
import { GenerationCache } from './generation-cache.js';
import { ModelGateway } from './gateway.js';
import { UpstreamService } from './upstreams.js';
import { UsageRecorder } from './usage.js';

@Injectable()
export class GatewayMaintenance implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(GenerationCache) private readonly cache: GenerationCache,
    @Inject(ModelGateway) private readonly gateway: ModelGateway,
    @Inject(UpstreamService) private readonly upstreamService: UpstreamService,
    @Inject(UsageRecorder) private readonly recorder: UsageRecorder,
    @Inject(BILLING_RESERVATION_PORT) private readonly billing: BillingReservationPort,
    @Inject(UPSTREAM_PROBE) private readonly probe: UpstreamProbe,
  ) {}
  async onModuleInit(): Promise<void> {
    await this.jobs.work('model_access.recover_generations', () => this.recover());
    await this.jobs.schedule('model_access.recover_generations', '* * * * *');
    await this.jobs.work('model_access.probe_upstreams', () => this.probeUpstreams());
    await this.jobs.schedule('model_access.probe_upstreams', '*/5 * * * *');
  }
  async recover(): Promise<void> {
    const old = await this.database.db
      .select()
      .from(generationResults)
      .where(
        and(
          ne(generationResults.phase, 'complete'),
          lt(generationResults.createdAt, new Date(this.clock.nowMs() - 90000)),
        ),
      )
      .limit(100);
    for (const row of old) {
      if (row.phase === 'result') {
        await this.gateway.finalize(row, await this.cache.open(row));
        continue;
      }
      // attach 写入前崩溃时也能用同一稳定键找回冻结 ID。
      const record = await this.recorder.byIdempotencyKey(`gateway:${row.id}`);
      const holdId = row.holdId ?? record?.holdId;
      if (holdId) {
        const release = await this.billing.release({
          holdId,
          reason: 'call_failed',
          usageRecordId: record?.id,
          upstreamId: row.upstreamId ?? record?.upstreamId ?? undefined,
        });
        if (record) await this.recorder.writeReleaseSnapshot(record.id, release);
      }
      if (record)
        await this.recorder.finish(record.id, {
          status: 'failed',
          errorCode: 'interrupted',
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          estimated: false,
          latencyMs: 0,
          retryCount: 0,
        });
      await this.cache.save(row, { ok: false, error: 'provider_unavailable' }, 'complete');
    }
    await this.database.db
      .delete(generationResults)
      .where(
        and(
          eq(generationResults.phase, 'complete'),
          lt(generationResults.expiresAt, this.clock.now()),
        ),
      );
  }
  async probeUpstreams(): Promise<void> {
    const failed = await this.database.db
      .select()
      .from(upstreams)
      .where(
        and(
          inArray(upstreams.status, ['unavailable']),
          // 只自动探测临时故障；失效密钥或额度需要管理员处理。最长24h。
          ne(upstreams.status, 'active'),
        ),
      );
    for (const upstream of failed) {
      if (this.clock.nowMs() - upstream.statusChangedAt.getTime() > 86400000) continue;
      const result = await this.upstreamService.withApiKey(upstream.id, (apiKey) =>
        this.probe.test({
          kind: 'openai_compatible',
          baseUrl: upstream.baseUrl,
          apiKey,
        }),
      );
      await this.database.db
        .update(upstreams)
        .set({ lastTestedAt: this.clock.now() })
        .where(eq(upstreams.id, upstream.id));
      if (result.ok) await this.upstreamService.reportStatus(upstream.id, 'active', 'probe');
      else if (result.reason === 'invalid_key' || result.reason === 'insufficient_balance')
        await this.upstreamService.reportStatus(
          upstream.id,
          result.reason === 'invalid_key' ? 'invalid' : 'quota_exhausted',
          'probe',
          result.reason,
        );
    }
  }
}
