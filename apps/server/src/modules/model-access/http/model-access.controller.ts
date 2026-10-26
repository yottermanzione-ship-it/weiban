/**
 * model-access 的 HTTP 接口，一一对应契约 ModelAccessEndpoints / ModelAccessAdminEndpoints /
 * ModelAccessAdminUsageEndpoints（packages/contracts/src/http/model-access.ts）。请求参数一律用契约 schema 校验。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  ModelAccessEndpoints,
  ModelKey,
  type AdminCatalogEntry,
  type ModelSelection,
  type ModelStatus,
  type Upstream,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  AppError,
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CatalogService } from '../application/catalog.js';
import { LeaderboardService } from '../application/leaderboard.js';
import { ModelsDevService } from '../application/models-dev.js';
import { ModelAdminService } from '../application/models.js';
import { ModelDeletionService } from '../application/model-deletion.js';
import { GatewayLimitsService } from '../application/limits.js';
import { DisplayPricingService } from '../application/display-pricing.js';
import { UpstreamScheduler } from '../application/scheduler.js';
import { ModelStatusService } from '../application/resolver.js';
import { SelectionService } from '../application/selection.js';
import { ScenarioService } from '../application/scenarios.js';
import { UpstreamService } from '../application/upstreams.js';
import { AdminUsageService } from '../application/usage.js';

const E = ModelAccessEndpoints;
const A = ModelAccessAdminEndpoints;
const U = ModelAccessAdminUsageEndpoints;

type Out<S extends z.ZodType | undefined> = z.output<NonNullable<S>>;

function schema<S extends z.ZodType>(value: S | undefined): S {
  if (!value) throw new Error('契约接口缺少 schema');
  return value;
}

/**
 * 3.25（G1-5）：模型「暂时无法使用」的具体原因（密钥 / 余额 / 计费上限等）只给后台看；用户端接口一律去掉
 * unavailableDetail（ModelInfo、ModelRefState）与 ModelStatus.detail，用户端显示中性文案。
 */
export function withoutUnavailableDetail<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => withoutUnavailableDetail(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value))
      if (key !== 'unavailableDetail') out[key] = withoutUnavailableDetail(v);
    return out as T;
  }
  return value;
}
const hide = async <T>(value: Promise<T>): Promise<T> => withoutUnavailableDetail(await value);

@Controller('api/v1/model')
export class ModelController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(SelectionService) private readonly selection: SelectionService,
    @Inject(ModelStatusService) private readonly status: ModelStatusService,
    @Inject(ScenarioService) private readonly scenarios: ScenarioService,
  ) {}

  // ---------- 3.22 按场景的模型配置 ----------

  @Get('scenarios')
  @RequireAuth(E.getScenarioConfig.auth)
  getScenarios(@CurrentPrincipal() me: AuthPrincipal) {
    return hide(this.scenarios.getConfig(me.userId));
  }

  /** 3.28：平台固定私密模型（用户只读）；未配置返回 `{ model: null }`。 */
  @Get('private-model')
  @RequireAuth(E.privateModel.auth)
  async privateModel() {
    return { model: await this.catalog.privateModel() };
  }

  @Patch('scenarios')
  @RequireAuth(E.updateScenarioConfig.auth)
  updateScenarios(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.updateScenarioConfig.body)))
    body: Out<typeof E.updateScenarioConfig.body>,
  ) {
    return hide(this.scenarios.updateConfig(me.userId, body.selections));
  }

  @Post('scenarios/recommended')
  @HttpCode(200)
  @RequireAuth(E.applyRecommendedScenarios.auth)
  applyRecommended(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.applyRecommendedScenarios.body)))
    body: Out<typeof E.applyRecommendedScenarios.body>,
  ) {
    return hide(this.scenarios.applyRecommended(me.userId, body.overwrite === true));
  }

  @Get('character-scenarios/:characterId')
  @RequireAuth(E.getCharacterScenarios.auth)
  getCharacterScenarios(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.getCharacterScenarios.params)))
    params: { characterId: string },
  ) {
    return hide(this.scenarios.getCharacter(me.userId, params.characterId));
  }

  @Patch('character-scenarios/:characterId')
  @RequireAuth(E.updateCharacterScenarios.auth)
  updateCharacterScenarios(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.updateCharacterScenarios.params)))
    params: { characterId: string },
    @Body(new ContractPipe(schema(E.updateCharacterScenarios.body)))
    body: Out<typeof E.updateCharacterScenarios.body>,
  ) {
    return hide(this.scenarios.updateCharacter(me.userId, params.characterId, body.selections));
  }

  @Get('leaderboard-info')
  @RequireAuth(E.getLeaderboardInfo.auth)
  leaderboardInfo() {
    return this.catalog.leaderboardInfo();
  }

  @Get('models')
  @RequireAuth(E.listModels.auth)
  async listModels(
    @Query(new ContractPipe(schema(E.listModels.query))) query: Out<typeof E.listModels.query>,
  ) {
    return {
      items: await hide(this.catalog.listModels(query.capability, query.scenario)),
    };
  }

  @Get('selection')
  @RequireAuth(E.getSelection.auth)
  getSelection(@CurrentPrincipal() me: AuthPrincipal): Promise<ModelSelection> {
    return hide(this.selection.getSelection(me.userId));
  }

  @Patch('selection')
  @RequireAuth(E.updateSelection.auth)
  updateSelection(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.updateSelection.body)))
    body: Out<typeof E.updateSelection.body>,
  ): Promise<ModelSelection> {
    return hide(this.selection.updateSelection(me.userId, body));
  }

  @Get('character-overrides/:characterId')
  @RequireAuth(E.getCharacterOverride.auth)
  getOverride(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.getCharacterOverride.params))) params: { characterId: string },
  ) {
    return hide(this.selection.getOverride(me.userId, params.characterId));
  }

  @Put('character-overrides/:characterId')
  @RequireAuth(E.setCharacterOverride.auth)
  setOverride(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.setCharacterOverride.params))) params: { characterId: string },
    @Body(new ContractPipe(schema(E.setCharacterOverride.body)))
    body: Out<typeof E.setCharacterOverride.body>,
  ) {
    return hide(this.selection.setOverride(me.userId, params.characterId, body.chat));
  }

  @Get('status')
  @RequireAuth(E.getModelStatus.auth)
  async getStatus(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(schema(E.getModelStatus.query)))
    query: Out<typeof E.getModelStatus.query>,
  ): Promise<ModelStatus> {
    const { detail: _detail, ...status } = await this.status.getStatus(
      me.userId,
      query.characterId ?? null,
    );
    return status;
  }
}

@Controller('api/v1/admin/model')
export class ModelAdminController {
  @Get('leaderboard-source')
  @RequireAuth(A.getLeaderboardSource.auth)
  leaderboardSource() {
    return this.catalog.leaderboardSource();
  }

  @Put('leaderboard-source')
  @RequireAuth(A.updateLeaderboardSource.auth)
  updateLeaderboardSource(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.updateLeaderboardSource.body)))
    body: Out<typeof A.updateLeaderboardSource.body>,
  ) {
    return this.catalog.setLeaderboardSource(me.userId, body);
  }

  // ---------- 3.24 榜单自动获取 ----------

  @Get('leaderboard-status')
  @RequireAuth(A.getLeaderboardStatus.auth)
  leaderboardStatus() {
    return this.leaderboard.status();
  }

  @Put('leaderboard/match/:modelKey')
  @RequireAuth(A.updateArenaName.auth)
  updateArenaName(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.updateArenaName.params))) params: { modelKey: string },
    @Body(new ContractPipe(schema(A.updateArenaName.body)))
    body: Out<typeof A.updateArenaName.body>,
  ) {
    return this.leaderboard.updateArenaName(me.userId, params.modelKey, body.arenaModelName);
  }

  @Post('leaderboard/refresh')
  @HttpCode(200)
  @RequireAuth(A.refreshLeaderboard.auth)
  refreshLeaderboard(@CurrentPrincipal() me: AuthPrincipal) {
    return this.leaderboard.requestRefresh(me.userId);
  }

  @Post('leaderboard/import')
  @HttpCode(200)
  @RequireAuth(A.importLeaderboard.auth)
  importLeaderboard(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.importLeaderboard.body)))
    body: Out<typeof A.importLeaderboard.body>,
  ) {
    return this.leaderboard.importText(me.userId, body.text);
  }

  // ---------- 3.26 models.dev 公开模型数据（预填价格 / 上下文 / 最大输出 / 识图） ----------

  @Get('models-dev')
  @RequireAuth(A.getModelsDevStatus.auth)
  modelsDevStatus() {
    return this.modelsDev.status();
  }

  @Post('models-dev/refresh')
  @HttpCode(200)
  @RequireAuth(A.refreshModelsDev.auth)
  refreshModelsDev(@CurrentPrincipal() me: AuthPrincipal) {
    return this.modelsDev.refresh(me.userId);
  }

  @Put('models-dev/settings')
  @RequireAuth(A.updateModelsDevSettings.auth)
  updateModelsDevSettings(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.updateModelsDevSettings.body)))
    body: Out<typeof A.updateModelsDevSettings.body>,
  ) {
    return this.modelsDev.updateRate(me.userId, body.usdCnyRate);
  }

  @Post('models-dev/lookup')
  @HttpCode(200)
  @RequireAuth(A.lookupModelsDev.auth)
  lookupModelsDev(
    @Body(new ContractPipe(schema(A.lookupModelsDev.body)))
    body: Out<typeof A.lookupModelsDev.body>,
  ) {
    return this.modelsDev.lookup(body);
  }

  constructor(
    @Inject(LeaderboardService) private readonly leaderboard: LeaderboardService,
    @Inject(ModelsDevService) private readonly modelsDev: ModelsDevService,
    @Inject(UpstreamService) private readonly upstreams: UpstreamService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AdminUsageService) private readonly usage: AdminUsageService,
    @Inject(ModelAdminService) private readonly models: ModelAdminService,
    @Inject(ModelDeletionService) private readonly deletion: ModelDeletionService,
    @Inject(UpstreamScheduler) private readonly scheduler: UpstreamScheduler,
    @Inject(GatewayLimitsService) private readonly limits: GatewayLimitsService,
    @Inject(DisplayPricingService) private readonly displayPricing: DisplayPricingService,
  ) {}

  // ---------- 3.22 场景推荐模型 / 平台内部模型 ----------

  @Get('scenario-settings')
  @RequireAuth(A.getScenarioSettings.auth)
  getScenarioSettings() {
    return this.catalog.modelUses();
  }

  @Put('scenario-settings')
  @RequireAuth(A.updateScenarioSettings.auth)
  updateScenarioSettings(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.updateScenarioSettings.body)))
    body: Out<typeof A.updateScenarioSettings.body>,
  ) {
    return this.catalog.setModelUses(me.userId, body);
  }

  /** 3.28：一次性初始化固定私密模型（仅当 fixed 从未存在时复制推荐私密模型；写审计）。 */
  @Post('private-model/initialize')
  @HttpCode(200)
  @RequireAuth(A.initializeFixedPrivateModel.auth)
  initializeFixedPrivateModel(@CurrentPrincipal() me: AuthPrincipal) {
    return this.catalog.initializeFixedPrivateModel(me.userId);
  }

  // ---------- 3.17 展示倍率基准 ----------

  @Get('display-multiplier')
  @RequireAuth(A.getDisplayMultiplierSettings.auth)
  getDisplayMultiplier() {
    return this.displayPricing.getSettings();
  }

  @Put('display-multiplier')
  @RequireAuth(A.updateDisplayMultiplierSettings.auth)
  updateDisplayMultiplier(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.updateDisplayMultiplierSettings.body)))
    body: Out<typeof A.updateDisplayMultiplierSettings.body>,
  ) {
    return this.displayPricing.updateSettings(me.userId, body);
  }

  // ---------- 上游账号池（v3.4） ----------

  @Patch('upstreams/:upstreamId')
  @RequireAuth(A.updateUpstream.auth)
  updateUpstream(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.updateUpstream.params))) params: { upstreamId: string },
    @Body(new ContractPipe(schema(A.updateUpstream.body))) body: Out<typeof A.updateUpstream.body>,
  ): Promise<Upstream> {
    return this.upstreams.update(me.userId, params.upstreamId, body);
  }

  @Post('upstreams/batch')
  @HttpCode(200)
  @RequireAuth(A.batchUpstreams.auth)
  async batchUpstreams(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.batchUpstreams.body))) body: Out<typeof A.batchUpstreams.body>,
  ) {
    return { items: await this.upstreams.batch(me.userId, body.upstreamIds, body.action) };
  }

  @Get('upstreams/:upstreamId/models')
  @RequireAuth(A.listUpstreamModels.auth)
  listUpstreamModels(
    @Param(new ContractPipe(schema(A.listUpstreamModels.params))) params: { upstreamId: string },
  ) {
    return this.upstreams.models(params.upstreamId);
  }

  @Get('limits')
  @RequireAuth(A.getGatewayLimits.auth)
  getLimits() {
    return this.limits.get();
  }

  @Put('limits')
  @RequireAuth(A.updateGatewayLimits.auth)
  updateLimits(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.updateGatewayLimits.body)))
    body: Out<typeof A.updateGatewayLimits.body>,
  ) {
    return this.limits.update(me.userId, body);
  }

  @Post('usage/overview')
  @HttpCode(200)
  @RequireAuth(U.usageOverview.auth)
  usageOverview(
    @Body(new ContractPipe(schema(U.usageOverview.body))) body: Out<typeof U.usageOverview.body>,
  ) {
    return this.usage.overview(body);
  }

  // ---------- 模型（目录 + 倍率，v3.3） ----------

  @Get('models')
  @RequireAuth(A.listModels.auth)
  async listAdminModels() {
    return { items: await this.models.list() };
  }

  // 3.23：删除模型（软删，可批量）。放在 models/:modelKey 之前，免得被当成模型键。
  @Post('models/delete-preview')
  @HttpCode(200)
  @RequireAuth(A.previewDeleteModels.auth)
  previewDeleteModels(
    @Body(new ContractPipe(schema(A.previewDeleteModels.body)))
    body: Out<typeof A.previewDeleteModels.body>,
  ) {
    return this.deletion.preview(body.modelKeys);
  }

  @Post('models/delete')
  @HttpCode(200)
  @RequireAuth(A.deleteModels.auth)
  deleteModels(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.deleteModels.body))) body: Out<typeof A.deleteModels.body>,
  ) {
    return this.deletion.delete(me.userId, body.modelKeys);
  }

  @Put('models/:modelKey')
  @RequireAuth(A.upsertModel.auth)
  upsertModel(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.upsertModel.params))) params: { modelKey: string },
    @Body(new ContractPipe(schema(A.upsertModel.body))) body: Out<typeof A.upsertModel.body>,
  ) {
    if (!ModelKey.safeParse(params.modelKey).success) {
      throw new AppError('bad_request', '模型键格式不正确（路径中的 / 需要 URL 编码为 %2F）');
    }
    return this.models.upsert(me.userId, params.modelKey, body);
  }

  // ---------- 上游 ----------

  @Get('upstreams')
  @RequireAuth(A.listUpstreams.auth)
  async listUpstreams() {
    return { items: await this.upstreams.list((id) => this.scheduler.inFlight(id)) };
  }

  @Post('upstreams')
  @HttpCode(201)
  @RequireAuth(A.createUpstream.auth)
  createUpstream(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.createUpstream.body))) body: Out<typeof A.createUpstream.body>,
  ): Promise<Upstream> {
    return this.upstreams.create(me.userId, body);
  }

  @Put('upstreams/:upstreamId/key')
  @RequireAuth(A.rotateUpstreamKey.auth)
  rotateKey(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.rotateUpstreamKey.params))) params: { upstreamId: string },
    @Body(new ContractPipe(schema(A.rotateUpstreamKey.body)))
    body: Out<typeof A.rotateUpstreamKey.body>,
  ): Promise<Upstream> {
    return this.upstreams.rotateKey(me.userId, params.upstreamId, body.apiKey);
  }

  @Post('upstreams/:upstreamId/test')
  @HttpCode(200)
  @RequireAuth(A.testUpstream.auth)
  testUpstream(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.testUpstream.params))) params: { upstreamId: string },
  ): Promise<Upstream> {
    return this.upstreams.test(me.userId, params.upstreamId);
  }

  @Delete('upstreams/:upstreamId')
  @HttpCode(204)
  @RequireAuth(A.deleteUpstream.auth)
  async deleteUpstream(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.deleteUpstream.params))) params: { upstreamId: string },
  ): Promise<void> {
    await this.upstreams.delete(me.userId, params.upstreamId);
  }

  // ---------- 模型目录 ----------

  @Get('catalog')
  @RequireAuth(A.listCatalog.auth)
  async listCatalog() {
    return { items: await this.catalog.adminList() };
  }

  @Put('catalog/:modelKey')
  @RequireAuth(A.upsertCatalogEntry.auth)
  upsertCatalog(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.upsertCatalogEntry.params))) params: { modelKey: string },
    @Body(new ContractPipe(schema(A.upsertCatalogEntry.body)))
    body: Out<typeof A.upsertCatalogEntry.body>,
  ): Promise<AdminCatalogEntry> {
    if (!ModelKey.safeParse(params.modelKey).success) {
      throw new AppError('bad_request', '模型键格式不正确（路径中的 / 需要 URL 编码为 %2F）');
    }
    return this.catalog.upsert(me.userId, params.modelKey, body);
  }

  // ---------- 用量与费用（ADM-08） ----------

  @Post('usage/summary')
  @HttpCode(200)
  @RequireAuth(U.usageSummary.auth)
  usageSummary(
    @Body(new ContractPipe(schema(U.usageSummary.body))) body: Out<typeof U.usageSummary.body>,
  ) {
    return this.usage.summary(body);
  }

  @Post('usage/records')
  @HttpCode(200)
  @RequireAuth(U.listUsageRecords.auth)
  usageRecords(
    @Body(new ContractPipe(schema(U.listUsageRecords.body)))
    body: Out<typeof U.listUsageRecords.body>,
  ) {
    return this.usage.records(body);
  }

  @Post('usage/export')
  @HttpCode(200)
  @RequireAuth(U.exportUsageRecords.auth)
  usageExport(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(U.exportUsageRecords.body)))
    body: Out<typeof U.exportUsageRecords.body>,
  ) {
    return this.usage.export(me.userId, body.filter);
  }
}
