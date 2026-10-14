/** 3.9：我的状态（契约 UserStatusEndpoints）。 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Put } from '@nestjs/common';
import { UserStatusEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { UserStatusService } from '../application/user-status.js';

@Controller('api/v1/me/status')
@RequireAuth('user')
export class UserStatusController {
  constructor(@Inject(UserStatusService) private readonly statuses: UserStatusService) {}

  @Get()
  async get(@CurrentPrincipal() me: AuthPrincipal) {
    return { status: await this.statuses.getUserStatus(me.userId) };
  }

  @Put()
  set(@CurrentPrincipal() me: AuthPrincipal, @Body(new ContractPipe(E.set.body!)) body: unknown) {
    return this.statuses.set(me.userId, body);
  }

  @Delete()
  @HttpCode(204)
  async clear(@CurrentPrincipal() me: AuthPrincipal) {
    await this.statuses.clear(me.userId);
  }
}
