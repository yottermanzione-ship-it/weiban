/** 陪你专注（契约 FocusEndpoints），T-094。 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { FocusEndpoints as F } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { FocusService } from '../application/focus.service.js';

@Controller('api/v1/play/focus')
@RequireAuth('user')
export class FocusController {
  constructor(@Inject(FocusService) private readonly focus: FocusService) {}

  @Get()
  getActive(@CurrentPrincipal() p: AuthPrincipal) {
    return this.focus.getActive(p.userId);
  }

  @Post()
  @HttpCode(200)
  start(@CurrentPrincipal() p: AuthPrincipal, @Body() body: unknown) {
    return this.focus.start(p.userId, body);
  }

  @Post(':focusId/end')
  @HttpCode(200)
  end(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(F.end.params!)) params: { focusId: string },
  ) {
    return this.focus.end(p.userId, params.focusId);
  }
}
