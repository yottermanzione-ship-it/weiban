/**
 * 公开动态管理后台 HTTP 接口（D-L3-02，ADM-03）。
 * 一一对应契约 PublicUpdateAdminEndpoints（packages/contracts/src/http/public-updates.ts）。
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
import { PublicUpdateAdminEndpoints as E } from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { PublicUpdateService } from '../application/public-updates.js';

type Out<S extends z.ZodType | undefined> = z.output<NonNullable<S>>;

function schema<S extends z.ZodType>(value: S | undefined): S {
  if (!value) throw new Error('契约接口缺少 schema');
  return value;
}

@Controller('api/v1/admin')
export class PublicUpdateAdminController {
  constructor(@Inject(PublicUpdateService) private readonly service: PublicUpdateService) {}

  @Get('public-updates')
  @RequireAuth(E.list.auth)
  list(@Query(new ContractPipe(schema(E.list.query))) q: Out<typeof E.list.query>) {
    return this.service.list(q);
  }

  @Get('public-updates-settings')
  @RequireAuth(E.getSettings.auth)
  getSettings() {
    return this.service.getSettings();
  }

  @Put('public-updates-settings')
  @RequireAuth(E.updateSettings.auth)
  updateSettings(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.updateSettings.body))) body: Out<typeof E.updateSettings.body>,
  ) {
    return this.service.updateSettings(me.userId, body.autoSearchEnabled);
  }

  @Get('public-updates/:updateId')
  @RequireAuth(E.get.auth)
  get(@Param(new ContractPipe(schema(E.get.params))) p: Out<typeof E.get.params>) {
    return this.service.get(p.updateId);
  }

  @Post('public-updates')
  @HttpCode(201)
  @RequireAuth(E.create.auth)
  create(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.create.body))) body: Out<typeof E.create.body>,
  ) {
    return this.service.create(me.userId, body);
  }

  @Patch('public-updates/:updateId')
  @RequireAuth(E.update.auth)
  update(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.update.params))) p: Out<typeof E.update.params>,
    @Body(new ContractPipe(schema(E.update.body))) body: Out<typeof E.update.body>,
  ) {
    return this.service.update(me.userId, p.updateId, body);
  }

  @Post('public-updates/:updateId/submit')
  @HttpCode(200)
  @RequireAuth(E.submit.auth)
  submit(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.submit.params))) p: Out<typeof E.submit.params>,
  ) {
    return this.service.submit(me.userId, p.updateId);
  }

  @Post('public-updates/:updateId/approve')
  @HttpCode(200)
  @RequireAuth(E.approve.auth)
  approve(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.approve.params))) p: Out<typeof E.approve.params>,
    @Body(new ContractPipe(schema(E.approve.body))) body: Out<typeof E.approve.body>,
  ) {
    return this.service.approve(me.userId, p.updateId, body);
  }

  @Post('public-updates/:updateId/reject')
  @HttpCode(200)
  @RequireAuth(E.reject.auth)
  reject(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.reject.params))) p: Out<typeof E.reject.params>,
    @Body(new ContractPipe(schema(E.reject.body))) body: Out<typeof E.reject.body>,
  ) {
    return this.service.reject(me.userId, p.updateId, body.note);
  }

  @Post('public-updates/:updateId/withdraw')
  @HttpCode(200)
  @RequireAuth(E.withdraw.auth)
  withdraw(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.withdraw.params))) p: Out<typeof E.withdraw.params>,
    @Body(new ContractPipe(schema(E.withdraw.body))) body: Out<typeof E.withdraw.body>,
  ) {
    return this.service.withdraw(me.userId, p.updateId, body.note);
  }

  @Delete('public-updates/:updateId')
  @HttpCode(204)
  @RequireAuth(E.remove.auth)
  async remove(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.remove.params))) p: Out<typeof E.remove.params>,
  ): Promise<void> {
    await this.service.remove(me.userId, p.updateId);
  }

  @Post('characters/:characterId/public-updates/search')
  @HttpCode(200)
  @RequireAuth(E.triggerSearch.auth)
  triggerSearch(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.triggerSearch.params))) p: Out<typeof E.triggerSearch.params>,
  ) {
    return this.service.triggerSearch(me.userId, p.characterId);
  }
}
