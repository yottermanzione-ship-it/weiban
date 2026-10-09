import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { MemorySharingEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { SocialService } from '../application/social.js';

/** T-066：设置 → 隐私 → 跨角色共享（MEM-07 第 1 条）。 */
@Controller('api/v1')
@RequireAuth('user')
export class MemorySharingController {
  constructor(@Inject(SocialService) private readonly social: SocialService) {}

  @Get('me/memory-sharing')
  get(@CurrentPrincipal() p: AuthPrincipal) {
    return this.social.getSharing(p.userId);
  }

  @Put('me/memory-sharing')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.update.body!)) body: { level: 'off' | 'basic' | 'friends' },
  ) {
    return this.social.updateSharing(p.userId, body.level);
  }
}
