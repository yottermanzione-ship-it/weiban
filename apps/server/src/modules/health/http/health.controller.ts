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
  HealthEndpoints as E,
  HealthTagAdminEndpoints as TA,
  HealthTagEndpoints as T,
} from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import type { z } from 'zod';
import { HealthService } from '../application/health.service.js';
import { SymptomTagService } from '../application/symptom-tags.js';

/** 经期日记（PLAY-01）。管理后台没有任何健康数据接口（health-data.md 第 6 节）。 */
@Controller('api/v1/me/health')
@RequireAuth('user')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Post('cycles')
  @HttpCode(200)
  createCycle(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.createCycle.body!)) body: unknown,
  ) {
    return this.health.createCycle(p.userId, body);
  }

  @Patch('cycles/:cycleId')
  updateCycle(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.updateCycle.params!)) params: { cycleId: string },
    @Body(new ContractPipe(E.updateCycle.body!)) body: unknown,
  ) {
    return this.health.updateCycle(p.userId, params.cycleId, body);
  }

  @Delete('cycles/:cycleId')
  @HttpCode(204)
  async deleteCycle(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.deleteCycle.params!)) params: { cycleId: string },
  ) {
    await this.health.deleteCycle(p.userId, params.cycleId);
  }

  @Get('cycles')
  listCycles(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.listCycles.query!)) query: unknown,
  ) {
    return this.health.listCycles(p.userId, query);
  }

  @Get('prediction')
  getPrediction(@CurrentPrincipal() p: AuthPrincipal) {
    return this.health.getPrediction(p.userId);
  }

  @Get('authorization')
  getAuthorization(@CurrentPrincipal() p: AuthPrincipal) {
    return this.health.getAuthorization(p.userId);
  }

  @Put('authorization')
  updateAuthorization(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.updateAuthorization.body!)) body: unknown,
  ) {
    return this.health.updateAuthorization(p.userId, body);
  }

  @Get('settings')
  getSettings(@CurrentPrincipal() p: AuthPrincipal) {
    return this.health.getSettings(p.userId);
  }

  @Put('settings')
  updateSettings(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.updateSettings.body!)) body: unknown,
  ) {
    return this.health.updateSettings(p.userId, body);
  }

  @Post('clear')
  @HttpCode(200)
  async clearAll(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.clearAll.body!)) body: unknown,
  ) {
    await this.health.clearAll(p.userId, body);
    return null;
  }
}

/** 症状标签（用户侧，只含启用的）。 */
@Controller('api/v1/health/symptom-tags')
export class SymptomTagController {
  constructor(@Inject(SymptomTagService) private readonly tags: SymptomTagService) {}

  @Get()
  @RequireAuth(T.listSymptomTags.auth)
  async list() {
    return { items: await this.tags.list(true) };
  }
}

/** 症状标签维护（ADM-04 第 5 条）：管理员只维护标签，看不到任何用户记录。 */
@Controller('api/v1/admin/health/symptom-tags')
export class SymptomTagAdminController {
  constructor(@Inject(SymptomTagService) private readonly tags: SymptomTagService) {}

  @Get()
  @RequireAuth(TA.listSymptomTags.auth)
  async list() {
    return { items: await this.tags.list(false) };
  }

  @Put()
  @RequireAuth(TA.putSymptomTags.auth)
  put(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(TA.putSymptomTags.body!))
    body: z.output<NonNullable<typeof TA.putSymptomTags.body>>,
  ) {
    return this.tags.put(p.userId, body);
  }
}
