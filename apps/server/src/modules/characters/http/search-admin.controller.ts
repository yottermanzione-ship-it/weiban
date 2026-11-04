/**
 * 5.6（T-20261104e）：后台人工修正搜索实体关联、别名、身份说明。
 * 一一对应契约 SearchAdminEndpoints（packages/contracts/src/http/search.ts）；每次修改都写审计（含原因）。
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { SearchAdminEndpoints as E } from '@weiban/contracts';
import type { z } from 'zod';
import {
  AppError,
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { SearchEntityService } from '../application/search-entities.js';

type Out<S extends z.ZodType | undefined> = z.output<NonNullable<S>>;

function schema<S extends z.ZodType>(value: S | undefined): S {
  if (!value) throw new AppError('internal_error', '契约接口缺少 schema');
  return value;
}

@Controller('api/v1/admin/search')
@RequireAuth('admin')
export class SearchAdminController {
  constructor(@Inject(SearchEntityService) private readonly service: SearchEntityService) {}

  @Get('entities')
  list(@Query(new ContractPipe(schema(E.listEntities.query))) q: Out<typeof E.listEntities.query>) {
    return this.service.listEntities(q.q);
  }

  @Get('entity')
  get(@Query(new ContractPipe(schema(E.getEntity.query))) q: Out<typeof E.getEntity.query>) {
    return this.service.getEntity(q.entityKey);
  }

  @Post('entities')
  @HttpCode(200)
  create(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.createEntity.body))) body: Out<typeof E.createEntity.body>,
  ) {
    return this.service.createEntity(me.userId, body);
  }

  @Post('entity/update')
  @HttpCode(200)
  update(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.updateEntity.body))) body: Out<typeof E.updateEntity.body>,
  ) {
    return this.service.updateEntity(me.userId, body);
  }

  @Post('entity/links')
  @HttpCode(200)
  link(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.linkEntity.body))) body: Out<typeof E.linkEntity.body>,
  ) {
    return this.service.linkEntity(me.userId, body);
  }

  @Post('entity/merge')
  @HttpCode(200)
  merge(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.mergeEntity.body))) body: Out<typeof E.mergeEntity.body>,
  ) {
    return this.service.mergeEntity(me.userId, body);
  }

  @Post('entity/split')
  @HttpCode(200)
  split(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.splitEntity.body))) body: Out<typeof E.splitEntity.body>,
  ) {
    return this.service.splitEntity(me.userId, body);
  }

  @Get('characters/:characterId')
  character(
    @Param(new ContractPipe(schema(E.getCharacter.params))) p: Out<typeof E.getCharacter.params>,
  ) {
    return this.service.characterView(p.characterId);
  }

  @Post('characters/:characterId/aliases')
  @HttpCode(200)
  alias(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.changeAlias.params))) p: Out<typeof E.changeAlias.params>,
    @Body(new ContractPipe(schema(E.changeAlias.body))) body: Out<typeof E.changeAlias.body>,
  ) {
    return this.service.changeAlias(me.userId, p.characterId, body);
  }
}
