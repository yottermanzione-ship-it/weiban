import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClientLogAdminEndpoints as A, ClientLogEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ClientLogsService } from '../application/client-logs.service.js';
@Controller('api/v1/client-logs')
@RequireAuth('none')
export class ClientLogsController {
  constructor(@Inject(ClientLogsService) private readonly logs: ClientLogsService) {}
  @Post()
  @HttpCode(200)
  report(@Req() req: Request, @Body(new ContractPipe(E.reportAnonymous.body!)) body: unknown) {
    return this.logs.report(null, req.ip ?? 'unknown', body);
  }
}
@Controller('api/v1/me/client-logs')
@RequireAuth('user')
export class UserClientLogsController {
  constructor(@Inject(ClientLogsService) private readonly logs: ClientLogsService) {}
  @Post()
  @HttpCode(200)
  report(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.report.body!)) body: unknown,
  ) {
    return this.logs.report(p.userId, '', body);
  }
}
@Controller('api/v1/admin')
@RequireAuth('admin')
export class ClientLogsAdminController {
  constructor(@Inject(ClientLogsService) private readonly logs: ClientLogsService) {}
  @Get('client-logs') list(@Query() q: unknown) {
    return this.logs.list(q);
  }
  @Get('client-logs/:fingerprint') get(
    @Param(new ContractPipe(A.get.params!)) p: { fingerprint: string },
  ) {
    return this.logs.detail(p.fingerprint);
  }
  @Patch('client-logs/:fingerprint') update(
    @CurrentPrincipal() actor: AuthPrincipal,
    @Param(new ContractPipe(A.get.params!)) p: { fingerprint: string },
    @Body(new ContractPipe(A.update.body!)) b: unknown,
  ) {
    return this.logs.update(actor.userId, p.fingerprint, b);
  }
  @Get('users/:userId/client-logs') user(
    @Param(new ContractPipe(A.user.params!)) p: { userId: string },
  ) {
    return this.logs.user(p.userId);
  }
  @Get('support/tickets/:ticketId/client-logs') ticket(
    @Param(new ContractPipe(A.ticket.params!)) p: { ticketId: string },
  ) {
    return this.logs.ticket(p.ticketId);
  }
}
