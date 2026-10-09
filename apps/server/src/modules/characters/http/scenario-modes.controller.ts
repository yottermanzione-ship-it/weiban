/**
 * 情景模式管理后台 HTTP 接口（ADM-05 第 8 条）。
 * 一一对应契约 ScenarioModeAdminEndpoints（packages/contracts/src/http/admin-content.ts）。
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
} from '@nestjs/common';
import { ScenarioModeAdminEndpoints as E } from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ScenarioModeService } from '../application/scenario-modes.js';

type Out<S extends z.ZodType | undefined> = z.output<NonNullable<S>>;

function schema<S extends z.ZodType>(value: S | undefined): S {
  if (!value) throw new Error('契约接口缺少 schema');
  return value;
}

@Controller('api/v1/admin/scenario-modes')
export class ScenarioModeAdminController {
  constructor(@Inject(ScenarioModeService) private readonly service: ScenarioModeService) {}

  @Get()
  @RequireAuth(E.listScenarioModes.auth)
  async list() {
    return { items: await this.service.list() };
  }

  @Post()
  @HttpCode(201)
  @RequireAuth(E.createScenarioMode.auth)
  create(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.createScenarioMode.body)))
    body: Out<typeof E.createScenarioMode.body>,
  ) {
    return this.service.create(me.userId, body);
  }

  @Patch(':id')
  @RequireAuth(E.updateScenarioMode.auth)
  update(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.updateScenarioMode.params))) params: { id: string },
    @Body(new ContractPipe(schema(E.updateScenarioMode.body)))
    body: Out<typeof E.updateScenarioMode.body>,
  ) {
    return this.service.update(me.userId, params.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireAuth(E.deleteScenarioMode.auth)
  async delete(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.deleteScenarioMode.params))) params: { id: string },
  ): Promise<void> {
    await this.service.delete(me.userId, params.id);
  }
}
