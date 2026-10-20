import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import {
  GrowthAdminEndpoints as A,
  type UpdateFamiliarityStageSettingsRequest,
} from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { FamiliarityStageSettingsService } from '../application/stage-settings.js';

/** 3.25（G1-6）：后台调整好感度六阶段阈值。 */
@Controller('api/v1/admin/growth')
export class GrowthAdminController {
  constructor(
    @Inject(FamiliarityStageSettingsService)
    private readonly stages: FamiliarityStageSettingsService,
  ) {}

  @Get('familiarity-stages')
  @RequireAuth(A.getFamiliarityStages.auth)
  getStages() {
    return this.stages.get();
  }

  @Put('familiarity-stages')
  @RequireAuth(A.updateFamiliarityStages.auth)
  updateStages(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(A.updateFamiliarityStages.body!))
    body: UpdateFamiliarityStageSettingsRequest,
  ) {
    return this.stages.update(me.userId, body);
  }
}
