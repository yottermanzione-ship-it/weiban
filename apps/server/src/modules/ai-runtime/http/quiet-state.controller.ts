import { Controller, Get, Inject } from '@nestjs/common';
import { CurrentPrincipal, RequireAuth, type AuthPrincipal } from '../../../platform/index.js';
import { QuietStateService } from '../application/quiet-state.js';

/** 契约 QuietStateEndpoints（T-072）。 */
@Controller('api/v1')
@RequireAuth('user')
export class QuietStateController {
  constructor(@Inject(QuietStateService) private readonly quiet: QuietStateService) {}

  /** GET /api/v1/me/quiet-state */
  @Get('me/quiet-state')
  get(@CurrentPrincipal() p: AuthPrincipal) {
    return this.quiet.getQuietState(p.userId);
  }
}
