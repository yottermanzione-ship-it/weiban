/**
 * model-access 模块装配（D-L0-08 后端部分）。说明见 docs/backend/model-access.md。
 * D-L0-09（AI 负责人）在本模块内加入上游适配器与模型网关（ModelGatewayPort），复用这里的
 * ModelResolver、UpstreamService.withApiKey / reportStatus、UsageRecorder、ModelStatusService。
 */
import { Module } from '@nestjs/common';
import { BILLING_CHARGE_QUERY_PORT, BillingModule } from '../billing/index.js';
import { IdentityModule } from '../identity/index.js';
import { GenerationCache } from './application/generation-cache.js';
import { GatewayMaintenance } from './application/gateway-maintenance.js';
import { ModelGateway } from './application/gateway.js';
import { OpenAiTextAdapter } from './infra/text-adapter.js';
import { CatalogService } from './application/catalog.js';
import { EmptyPriceSource, FailClosedModelPolicy } from './application/defaults.js';
import { ModelAccessLifecycle } from './application/lifecycle.js';
import { UsageReconciliationService } from './application/reconciliation.js';
import { ModelResolver, ModelStatusService } from './application/resolver.js';
import { SelectionService } from './application/selection.js';
import { UpstreamService } from './application/upstreams.js';
import { AdminUsageService, UsageRecorder } from './application/usage.js';
import { ModelAdminController, ModelController } from './http/model-access.controller.js';
import { OpenAiCompatibleProbe } from './infra/upstream-probe.js';
import {
  MODEL_ACCESS_CHARGE_QUERY,
  MODEL_GATEWAY_PORT,
  MODEL_GENERATION_POLICY,
  TEXT_ADAPTER,
  GATEWAY_RETRY_WAIT,
  MODEL_ACCESS_POLICY,
  MODEL_PRICE_SOURCE,
  UPSTREAM_PROBE,
} from './tokens.js';

@Module({
  imports: [BillingModule, IdentityModule],
  exports: [MODEL_GATEWAY_PORT],
  controllers: [ModelController, ModelAdminController],
  providers: [
    UpstreamService,
    GenerationCache,
    ModelGateway,
    GatewayMaintenance,
    { provide: MODEL_GATEWAY_PORT, useExisting: ModelGateway },
    { provide: TEXT_ADAPTER, useFactory: () => new OpenAiTextAdapter() },
    {
      provide: MODEL_GENERATION_POLICY,
      useValue: {
        checkAdultGeneration: async () => ({ allowed: false, reason: 'adult_mode_not_eligible' }),
      },
    },
    {
      provide: GATEWAY_RETRY_WAIT,
      useValue: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    },
    CatalogService,
    SelectionService,
    ModelResolver,
    ModelStatusService,
    UsageRecorder,
    AdminUsageService,
    UsageReconciliationService,
    ModelAccessLifecycle,
    { provide: UPSTREAM_PROBE, useFactory: () => new OpenAiCompatibleProbe() },
    // policy 模块（D-L0-11）上线后改为 useExisting: policy 的 PolicyPort 令牌
    { provide: MODEL_ACCESS_POLICY, useClass: FailClosedModelPolicy },
    // billing 读价目表的端口方法批准后改为真实实现（见交接说明契约变更申请）
    { provide: MODEL_PRICE_SOURCE, useClass: EmptyPriceSource },
    { provide: MODEL_ACCESS_CHARGE_QUERY, useExisting: BILLING_CHARGE_QUERY_PORT },
  ],
})
export class ModelAccessModule {}
