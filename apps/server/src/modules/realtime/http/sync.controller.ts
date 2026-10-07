import { Controller, Get, Inject, Query } from '@nestjs/common';
import { CurrentPrincipal, RequireAuth, type AuthPrincipal } from '../../../platform/index.js';
import { UpdateLogService } from '../application/update-log.js';
@Controller('api/v1/sync')
@RequireAuth('user')
export class SyncController {
  constructor(@Inject(UpdateLogService) private readonly log: UpdateLogService) {}
  @Get('state')
  getState(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.log.getState(principal.userId);
  }
  @Get('updates')
  getUpdates(@CurrentPrincipal() principal: AuthPrincipal, @Query() query: unknown) {
    return this.log.getUpdates(principal.userId, query);
  }
}
