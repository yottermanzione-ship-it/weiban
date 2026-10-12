/** 行为规划管理端（契约 PlannerAdminEndpoints，CR-19，ADM-05 第 10 条），T-090。 */
import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import { PlannerAdminEndpoints as A, type PlanningDecisionType } from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { PlannerService } from '../application/planner.js';

type UpdateBody = z.infer<NonNullable<typeof A.updateConfig.body>>;
type ListQuery = z.infer<NonNullable<typeof A.listDecisions.query>>;

@Controller('api/v1/admin/ai')
@RequireAuth('admin')
export class PlannerAdminController {
  constructor(@Inject(PlannerService) private readonly planner: PlannerService) {}

  @Get('planner-config')
  getConfig() {
    return this.planner.listConfig();
  }

  @Put('planner-config/:decisionType')
  updateConfig(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(A.updateConfig.params!)) params: { decisionType: PlanningDecisionType },
    @Body(new ContractPipe(A.updateConfig.body!)) body: UpdateBody,
  ) {
    return this.planner.updateConfig(p.userId, params.decisionType, body);
  }

  @Get('planning-decisions')
  listDecisions(@Query(new ContractPipe(A.listDecisions.query!)) query: ListQuery) {
    return this.planner.listDecisions(query);
  }
}
