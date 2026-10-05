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
import { ModelStatusService } from '../application/resolver.js';
import { SelectionService } from '../application/selection.js';
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

@Controller('api/v1/model')
export class ModelController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(SelectionService) private readonly selection: SelectionService,
    @Inject(ModelStatusService) private readonly status: ModelStatusService,
  ) {}

  @Get('models')
  @RequireAuth(E.listModels.auth)
  async listModels(
    @Query(new ContractPipe(schema(E.listModels.query))) query: Out<typeof E.listModels.query>,
  ) {
    return { items: await this.catalog.listModels(query.capability) };
  }

  @Get('selection')
  @RequireAuth(E.getSelection.auth)
  getSelection(@CurrentPrincipal() me: AuthPrincipal): Promise<ModelSelection> {
    return this.selection.getSelection(me.userId);
  }

  @Patch('selection')
  @RequireAuth(E.updateSelection.auth)
  updateSelection(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.updateSelection.body)))
    body: Out<typeof E.updateSelection.body>,
  ): Promise<ModelSelection> {
    return this.selection.updateSelection(me.userId, body);
  }

  @Get('character-overrides/:characterId')
  @RequireAuth(E.getCharacterOverride.auth)
  getOverride(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.getCharacterOverride.params))) params: { characterId: string },
  ) {
    return this.selection.getOverride(me.userId, params.characterId);
  }

  @Put('character-overrides/:characterId')
  @RequireAuth(E.setCharacterOverride.auth)
  setOverride(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.setCharacterOverride.params))) params: { characterId: string },
    @Body(new ContractPipe(schema(E.setCharacterOverride.body)))
    body: Out<typeof E.setCharacterOverride.body>,
  ) {
    return this.selection.setOverride(me.userId, params.characterId, body.chat);
  }

  @Get('status')
  @RequireAuth(E.getModelStatus.auth)
  getStatus(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(schema(E.getModelStatus.query)))
    query: Out<typeof E.getModelStatus.query>,
  ): Promise<ModelStatus> {
    return this.status.getStatus(me.userId, query.characterId ?? null);
  }
}

@Controller('api/v1/admin/model')
export class ModelAdminController {
  constructor(
    @Inject(UpstreamService) private readonly upstreams: UpstreamService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AdminUsageService) private readonly usage: AdminUsageService,
  ) {}

  // ---------- 上游 ----------

  @Get('upstreams')
  @RequireAuth(A.listUpstreams.auth)
  async listUpstreams() {
    return { items: await this.upstreams.list() };
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
