/**
 * 3.26（G3-1）：models.dev 公开模型数据——后台添加 / 编辑模型、导入配置时按模型名预填价格、上下文长度、最大输出、
 * 能否识图（预填可改，匹配不到后台提示手填）。
 *
 * - 数据源 https://models.dev/api.json（开源项目 sst/models.dev，公开、无需密钥），约 6MB；只保留预填字段存表
 *   model_access.models_dev_snapshot（一行）。服务器每天 04:10（北京）抓一次，后台可「立即刷新」；
 *   第一次检索时还没有缓存会先抓一次。抓取失败保留上次数据，只记失败时间与原因。
 * - 价格原文美元 / 百万 token，按后台可改的汇率（model_access.settings 键 models_dev_settings，默认 7.2）换算人民币。
 * - 只读外部公开数据，不发送任何平台数据、不带密钥。
 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type {
  ModelsDevLookupRequest,
  ModelsDevLookupResponse,
  ModelsDevStatus,
} from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  type AuditLog,
  type Clock,
  type Database,
  type JobQueue,
} from '../../../platform/index.js';
import {
  DEFAULT_USD_CNY_RATE,
  MODELS_DEV_URL,
  buildLookupIndex,
  compactModelsDev,
  lookupModel,
  type ModelsDevIndex,
  type ModelsDevLookupIndex,
} from '../domain/models-dev.js';
import { modelAccessSettings, modelsDevSnapshot } from '../infra/db/schema.js';

export const REFRESH_MODELS_DEV_JOB = 'model_access.refresh_models_dev';
export const MODELS_DEV_SETTINGS_KEY = 'models_dev_settings';
const FETCH_TIMEOUT_MS = 60_000;
const MAX_BYTES = 30_000_000;

/** 读取 models.dev 原始 JSON（测试可替换）。失败抛出带中文原因的错误。 */
export type ModelsDevFetcher = () => Promise<unknown>;
export const MODELS_DEV_FETCHER = Symbol('weiban.model-access.models-dev-fetcher');

export const defaultModelsDevFetcher: ModelsDevFetcher = async () => {
  let response: Response;
  try {
    response = await fetch(MODELS_DEV_URL, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': 'WeibanModelsDev/1.0' },
    });
  } catch {
    throw new Error('连接 models.dev 失败（网络错误或超时）');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`models.dev 返回错误（HTTP ${response.status}）`);
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new Error('models.dev 数据过大');
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('models.dev 数据过大');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('models.dev 返回的不是有效 JSON');
  }
};

@Injectable()
export class ModelsDevService implements OnModuleInit {
  private readonly logger = new Logger('ModelsDev');
  /** 内存里的检索索引（按缓存的抓取时间失效）。 */
  private cache: { fetchedAt: number; index: ModelsDevLookupIndex } | null = null;
  private inflight: Promise<void> | null = null;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(MODELS_DEV_FETCHER) private readonly fetcher: ModelsDevFetcher,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work(REFRESH_MODELS_DEV_JOB, async () => {
      await this.refresh(null);
    });
    await this.jobs.schedule(REFRESH_MODELS_DEV_JOB, '10 4 * * *', { tz: 'Asia/Shanghai' });
  }

  async status(): Promise<ModelsDevStatus> {
    const [row] = await this.database.db
      .select({
        fetchedAt: modelsDevSnapshot.fetchedAt,
        lastAttemptAt: modelsDevSnapshot.lastAttemptAt,
        lastError: modelsDevSnapshot.lastError,
        modelCount: modelsDevSnapshot.modelCount,
        providerCount: modelsDevSnapshot.providerCount,
      })
      .from(modelsDevSnapshot)
      .where(eq(modelsDevSnapshot.id, 1));
    return {
      sourceUrl: MODELS_DEV_URL,
      fetchedAt: row?.fetchedAt?.toISOString() ?? null,
      modelCount: row?.modelCount ?? 0,
      providerCount: row?.providerCount ?? 0,
      lastAttemptAt: row?.lastAttemptAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      usdCnyRate: await this.rate(),
    };
  }

  async rate(): Promise<number> {
    const [row] = await this.database.db
      .select({ value: modelAccessSettings.value })
      .from(modelAccessSettings)
      .where(eq(modelAccessSettings.key, MODELS_DEV_SETTINGS_KEY));
    const value = (row?.value as { usdCnyRate?: unknown } | undefined)?.usdCnyRate;
    return typeof value === 'number' && value > 0 ? value : DEFAULT_USD_CNY_RATE;
  }

  async updateRate(adminId: string, usdCnyRate: number): Promise<ModelsDevStatus> {
    const now = this.clock.now();
    const before = await this.rate();
    await this.database.transaction(async (tx) => {
      await tx.db
        .insert(modelAccessSettings)
        .values({ key: MODELS_DEV_SETTINGS_KEY, value: { usdCnyRate }, updatedAt: now, updatedBy: adminId })
        .onConflictDoUpdate({
          target: modelAccessSettings.key,
          set: { value: { usdCnyRate }, updatedAt: now, updatedBy: adminId },
        });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'models_dev.rate_updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'model_settings',
          targetId: null,
          details: { before, after: usdCnyRate },
        },
        tx,
      );
    });
    return this.status();
  }

  /** 抓取并替换缓存（定时任务 adminId = null；后台「立即刷新」传管理员）。失败保留上次数据。 */
  async refresh(adminId: string | null): Promise<ModelsDevStatus> {
    if (!this.inflight)
      this.inflight = this.doRefresh(adminId).finally(() => {
        this.inflight = null;
      });
    await this.inflight;
    return this.status();
  }

  private async doRefresh(adminId: string | null): Promise<void> {
    const now = this.clock.now();
    let index: ModelsDevIndex | null = null;
    let error: string | null = null;
    try {
      index = compactModelsDev(await this.fetcher());
    } catch (e) {
      error = (e instanceof Error ? e.message : '抓取失败').slice(0, 300);
      this.logger.warn(`models.dev 抓取失败：${error}`);
    }
    await this.database.transaction(async (tx) => {
      const values = index
        ? {
            fetchedAt: now,
            lastAttemptAt: now,
            lastError: null,
            modelCount: index.models.length,
            providerCount: Object.keys(index.providers).length,
            data: index,
            updatedAt: now,
          }
        : { lastAttemptAt: now, lastError: error, updatedAt: now };
      await tx.db
        .insert(modelsDevSnapshot)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: modelsDevSnapshot.id, set: values });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'models_dev.refreshed',
          actorType: adminId ? 'admin' : 'system',
          ...(adminId ? { actorId: adminId } : {}),
          targetType: 'model_settings',
          targetId: null,
          details: { models: index?.models.length ?? 0, error },
        },
        tx,
      );
    });
    if (index) this.cache = { fetchedAt: now.getTime(), index: buildLookupIndex(index) };
  }

  private async lookupIndex(): Promise<{ index: ModelsDevLookupIndex; fetchedAt: Date } | null> {
    const [meta] = await this.database.db
      .select({ fetchedAt: modelsDevSnapshot.fetchedAt })
      .from(modelsDevSnapshot)
      .where(eq(modelsDevSnapshot.id, 1));
    const fetchedAt = meta?.fetchedAt ?? null;
    if (!fetchedAt) return null;
    if (this.cache?.fetchedAt === fetchedAt.getTime())
      return { index: this.cache.index, fetchedAt };
    const [row] = await this.database.db
      .select({ data: modelsDevSnapshot.data, fetchedAt: modelsDevSnapshot.fetchedAt })
      .from(modelsDevSnapshot)
      .where(eq(modelsDevSnapshot.id, 1));
    if (!row?.data || !row.fetchedAt) return null;
    this.cache = { fetchedAt: row.fetchedAt.getTime(), index: buildLookupIndex(row.data) };
    return { index: this.cache.index, fetchedAt: row.fetchedAt };
  }

  async lookup(body: ModelsDevLookupRequest): Promise<ModelsDevLookupResponse> {
    let loaded = await this.lookupIndex();
    if (!loaded) {
      // 第一次用：先抓一次（失败就全部返回 null，后台看 fetchedAt 提示「还没有数据」）
      await this.refresh(null).catch(() => undefined);
      loaded = await this.lookupIndex();
    }
    const usdCnyRate = await this.rate();
    return {
      fetchedAt: loaded?.fetchedAt.toISOString() ?? null,
      usdCnyRate,
      items: body.items.map((item) => ({
        name: item.name,
        match: loaded ? lookupModel(loaded.index, item.name, item.vendor, usdCnyRate) : null,
      })),
    };
  }
}
