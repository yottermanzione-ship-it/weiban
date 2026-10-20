import { Body, Controller, Get, Put, Param, Inject, Query } from '@nestjs/common';
import {
  MembershipAdminEndpoints as A,
  MembershipChangeAdminEndpoints as C,
  MembershipEndpoints as E,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  RequireAuth,
  CurrentPrincipal,
  ContractPipe,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { MembershipService } from '../application/membership.js';
@Controller('api/v1')
export class MembershipController {
  constructor(@Inject(MembershipService) private readonly service: MembershipService) {}
  @Get('me/membership') @RequireAuth(E.get.auth) get(@CurrentPrincipal() me: AuthPrincipal) {
    return this.service.getMembership(me.userId);
  }
  @Get('admin/users/:userId/membership') @RequireAuth(A.get.auth) adminGet(
    @Param(new ContractPipe(A.get.params!)) params: { userId: string },
  ) {
    return this.service.getMembership(params.userId);
  }
  @Put('admin/users/:userId/membership') @RequireAuth(A.set.auth) set(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.set.params!)) params: { userId: string },
    @Body(new ContractPipe(A.set.body!)) body: unknown,
  ) {
    return this.service.set(me.userId, params.userId, body);
  }
  /** 3.21：会员手动调整记录。 */
  @Get('admin/membership/changes') @RequireAuth(C.listChanges.auth) listChanges(
    @Query(new ContractPipe(C.listChanges.query!))
    query: z.output<NonNullable<typeof C.listChanges.query>>,
  ) {
    return this.service.listChanges(query);
  }
}
