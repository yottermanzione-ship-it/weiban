/** 3.8：帮助与反馈、投诉（契约 SupportEndpoints / SupportAdminEndpoints）。 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { SupportAdminEndpoints as A, SupportEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { SupportService } from '../application/support.service.js';

const ticketParams = new ContractPipe(E.get.params!);

@Controller('api/v1/support/tickets')
@RequireAuth('user')
export class SupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Post('seen')
  @HttpCode(204)
  async seen(@CurrentPrincipal() p: AuthPrincipal) {
    await this.support.markAllSeen(p.userId);
  }

  @Post()
  @HttpCode(200)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.create.body!)) body: unknown,
  ) {
    return this.support.create(p.userId, body);
  }

  @Get()
  listMine(@CurrentPrincipal() p: AuthPrincipal, @Query() query: unknown) {
    return this.support.listMine(p.userId, query);
  }

  @Get(':ticketId')
  get(@CurrentPrincipal() p: AuthPrincipal, @Param(ticketParams) params: { ticketId: string }) {
    return this.support.get(p.userId, params.ticketId);
  }

  @Post(':ticketId/replies')
  @HttpCode(200)
  reply(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(ticketParams) params: { ticketId: string },
    @Body(new ContractPipe(E.addReply.body!)) body: unknown,
  ) {
    return this.support.addReply(p.userId, params.ticketId, body);
  }
}

@Controller('api/v1/admin/support/tickets')
@RequireAuth('admin')
export class SupportAdminController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.support.adminList(query);
  }

  @Get(':ticketId')
  get(@Param(ticketParams) params: { ticketId: string }) {
    return this.support.adminGet(params.ticketId);
  }

  @Post(':ticketId/reply')
  @HttpCode(200)
  reply(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(ticketParams) params: { ticketId: string },
    @Body(new ContractPipe(A.reply.body!)) body: unknown,
  ) {
    return this.support.adminReply(p.userId, params.ticketId, body);
  }

  @Post(':ticketId/resolve')
  @HttpCode(200)
  resolve(@CurrentPrincipal() p: AuthPrincipal, @Param(ticketParams) params: { ticketId: string }) {
    return this.support.adminResolve(p.userId, params.ticketId);
  }

  @Post(':ticketId/reopen')
  @HttpCode(200)
  reopen(@CurrentPrincipal() p: AuthPrincipal, @Param(ticketParams) params: { ticketId: string }) {
    return this.support.adminReopen(p.userId, params.ticketId);
  }
}
