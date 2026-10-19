import { BillingBoundsService } from './application/billing-bounds.js';
/**
 * model-access 模块装配（D-L0-08 后端部分）。说明见 docs/backend/model-access.md。
 * D-L0-09（AI 负责人）在本模块内加入上游适配器与模型网关（ModelGatewayPort），复用这里的
 * ModelResolver、UpstreamService.withApiKey / reportStatus、UsageRecorder、ModelStatusService。
 */
import { Module } from '@nestjs/common';
import {
  BILLING_CHARGE_QUERY_PORT,
  BILLING_MODEL_RATE_PORT,
  BillingModule,
} from '../billing/index.js';
import { POLICY_PORT } from '../policy/index.js';
import { IdentityModule } from '../identity/index.js';
import { MediaModule } from '../media/index.js';
import { ModelGatewayMedia } from './application/media-gateway.js';
import { OpenAiCompatibleMediaAdapter } from './infra/media-adapter.js';
import { GenerationCache } from './application/generation-cache.js';
import { GatewayMaintenance } from './application/gateway-maintenance.js';
import { ModelGateway } from './application/gateway.js';
import { GatewayWebSearchProvider } from './application/web-search.js';
import { OpenAiTextAdapter } from './infra/text-adapter.js';
import { CatalogService } from './application/catalog.js';
import { DisplayPricingService } from './application/display-pricing.js';
import { ModelAdminService, RatePriceSource } from './application/models.js';
import { GatewayLimitsService } from './application/limits.js';
import { UpstreamScheduler } from './application/scheduler.js';
import { ModelAccessLifecycle } from './application/lifecycle.js';
import { UsageReconciliationService } from './application/reconciliation.js';
import { ModelQuoteService, ModelResolver, ModelStatusService } from './application/resolver.js';
import { SelectionService } from './application/selection.js';
import { UpstreamService } from './application/upstreams.js';
import { AdminUsageService, UsageRecorder } from './application/usage.js';
import { ModelAdminController, ModelController } from './http/model-access.controller.js';
import { OpenAiCompatibleProbe } from './infra/upstream-probe.js';
import {
  ADULT_MODEL_READ_PORT,
  MODEL_NOTIFICATION_READ_PORT,
  MODEL_ACCESS_CHARGE_QUERY,
  MODEL_GATEWAY_PORT,
  MODEL_PLATFORM_GATEWAY_PORT,
  MODEL_GENERATION_POLICY,
  TEXT_ADAPTER,
  GATEWAY_RETRY_WAIT,
  MODEL_ACCESS_POLICY,
  MODEL_PRICE_SOURCE,
  MODEL_RATE_PORT,
  UPSTREAM_PROBE,
  WEB_SEARCH_PROVIDER,
  MODEL_GATEWAY_MEDIA_PORT,
  MEDIA_ADAPTER,
  MODEL_QUOTE_PORT,
} from './tokens.js';

@Module({
  imports: [BillingModule, IdentityModule, MediaModule],
  exports: [
    MODEL_GATEWAY_PORT,
    MODEL_PLATFORM_GATEWAY_PORT,
    MODEL_NOTIFICATION_READ_PORT,
    ADULT_MODEL_READ_PORT,
    WEB_SEARCH_PROVIDER,
    MODEL_GATEWAY_MEDIA_PORT,
    MODEL_QUOTE_PORT,
  ],
  controllers: [ModelController, ModelAdminController],
  providers: [
    BillingBoundsService,
    UpstreamService,
    GatewayLimitsService,
    UpstreamScheduler,
    GenerationCache,
    ModelGateway,
    GatewayMaintenance,
    { provide: MODEL_GATEWAY_PORT, useExisting: ModelGateway },
    { provide: MODEL_PLATFORM_GATEWAY_PORT, useExisting: ModelGateway },
    GatewayWebSearchProvider,
    ModelGatewayMedia,
    { provide: MODEL_GATEWAY_MEDIA_PORT, useExisting: ModelGatewayMedia },
    { provide: MEDIA_ADAPTER, useFactory: () => new OpenAiCompatibleMediaAdapter() },
    { provide: WEB_SEARCH_PROVIDER, useExisting: GatewayWebSearchProvider },
    { provide: TEXT_ADAPTER, useFactory: () => new OpenAiTextAdapter() },
    { provide: MODEL_GENERATION_POLICY, useExisting: POLICY_PORT },
    {
      provide: GATEWAY_RETRY_WAIT,
      useValue: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    },
    CatalogService,
    DisplayPricingService,
    SelectionService,
    { provide: MODEL_NOTIFICATION_READ_PORT, useExisting: SelectionService },
    ModelResolver,
    { provide: ADULT_MODEL_READ_PORT, useExisting: ModelResolver },
    ModelStatusService,
    ModelQuoteService,
    { provide: MODEL_QUOTE_PORT, useExisting: ModelQuoteService },
    UsageRecorder,
    AdminUsageService,
    UsageReconciliationService,
    ModelAccessLifecycle,
    { provide: UPSTREAM_PROBE, useFactory: () => new OpenAiCompatibleProbe() },
    // policy 模块（D-L0-11）上线后改为 useExisting: policy 的 PolicyPort 令牌
    { provide: MODEL_ACCESS_POLICY, useExisting: POLICY_PORT },
    // v3.3：价目表读价走 billing 的模型倍率端口（ADR-0032）
    { provide: MODEL_RATE_PORT, useExisting: BILLING_MODEL_RATE_PORT },
    RatePriceSource,
    { provide: MODEL_PRICE_SOURCE, useExisting: RatePriceSource },
    ModelAdminService,
    { provide: MODEL_ACCESS_CHARGE_QUERY, useExisting: BILLING_CHARGE_QUERY_PORT },
  ],
})
export class ModelAccessModule {}
