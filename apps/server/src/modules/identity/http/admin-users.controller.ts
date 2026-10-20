/** 3.21（10-20 批 E2）：契约 AdminUsersEndpoints（后台用户列表、概况、封禁、替用户注销）。 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { AdminUsersEndpoints as A } from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { AccountService } from '../application/accounts.js';
import { AdminUsersService } from '../application/admin-users.js';

@Controller('api/v1/admin/users')
export class AdminUsersController {
  constructor(
    @Inject(AdminUsersService) private readonly service: AdminUsersService,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  @Get()
  @RequireAuth(A.listUsers.auth)
  list() {
    return this.service.list();
  }

  @Get('overview')
  @RequireAuth(A.overview.auth)
  overview() {
    return this.service.overview();
  }

  @Post(':userId/ban')
  @HttpCode(200)
  @RequireAuth(A.banUser.auth)
  ban(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.banUser.params!)) params: { userId: string },
    @Body(new ContractPipe(A.banUser.body!)) body: z.output<NonNullable<typeof A.banUser.body>>,
  ) {
    return this.service.ban(me.userId, params.userId, body.reason);
  }

  @Post(':userId/unban')
  @HttpCode(200)
  @RequireAuth(A.unbanUser.auth)
  unban(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.unbanUser.params!)) params: { userId: string },
  ) {
    return this.service.unban(me.userId, params.userId);
  }

  @Post(':userId/deletion')
  @HttpCode(200)
  @RequireAuth(A.deleteUser.auth)
  async delete(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.deleteUser.params!)) params: { userId: string },
    @Body(new ContractPipe(A.deleteUser.body!))
    body: z.output<NonNullable<typeof A.deleteUser.body>>,
  ) {
    await this.accounts.adminRequestDeletion(me.userId, params.userId, body);
    return { status: 'deleting' as const };
  }
}
