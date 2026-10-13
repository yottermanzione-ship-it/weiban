/** 3.5：角色创建 › 申请制作（契约 RoleRequestEndpoints / RoleRequestAdminEndpoints）。 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { RoleRequestAdminEndpoints as A, RoleRequestEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { RoleRequestService } from '../application/role-requests.service.js';

const requestParams = new ContractPipe(E.get.params!);

@Controller('api/v1/role-requests')
@RequireAuth('user')
export class RoleRequestController {
  constructor(@Inject(RoleRequestService) private readonly requests: RoleRequestService) {}

  @Get('config')
  config() {
    return this.requests.getConfig();
  }

  @Post('seen')
  @HttpCode(204)
  async seen(@CurrentPrincipal() p: AuthPrincipal) {
    await this.requests.markAllSeen(p.userId);
  }

  @Post()
  @HttpCode(200)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.create.body!)) body: unknown,
  ) {
    return this.requests.create(p.userId, body);
  }

  @Get()
  listMine(@CurrentPrincipal() p: AuthPrincipal, @Query() query: unknown) {
    return this.requests.listMine(p.userId, query);
  }

  @Get(':requestId')
  get(@CurrentPrincipal() p: AuthPrincipal, @Param(requestParams) params: { requestId: string }) {
    return this.requests.get(p.userId, params.requestId);
  }

  @Post(':requestId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(requestParams) params: { requestId: string },
  ) {
    return this.requests.cancel(p.userId, params.requestId);
  }
}

@Controller('api/v1/admin/role-requests')
@RequireAuth('admin')
export class RoleRequestAdminController {
  constructor(@Inject(RoleRequestService) private readonly requests: RoleRequestService) {}

  @Get('config')
  config() {
    return this.requests.getConfig();
  }

  @Put('config')
  updateConfig(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(A.updateConfig.body!)) body: unknown,
  ) {
    return this.requests.updateConfig(p.userId, body);
  }

  @Get()
  list(@Query() query: unknown) {
    return this.requests.adminList(query);
  }

  @Get(':requestId')
  get(@Param(requestParams) params: { requestId: string }) {
    return this.requests.adminGet(params.requestId);
  }

  @Post(':requestId/accept')
  @HttpCode(200)
  accept(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(requestParams) params: { requestId: string },
    @Body(new ContractPipe(A.accept.body!)) body: unknown,
  ) {
    return this.requests.accept(p.userId, params.requestId, body);
  }

  @Post(':requestId/progress')
  @HttpCode(200)
  progress(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(requestParams) params: { requestId: string },
    @Body(new ContractPipe(A.progress.body!)) body: unknown,
  ) {
    return this.requests.progress(p.userId, params.requestId, body);
  }

  @Post(':requestId/complete')
  @HttpCode(200)
  complete(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(requestParams) params: { requestId: string },
    @Body(new ContractPipe(A.complete.body!)) body: unknown,
  ) {
    return this.requests.complete(p.userId, params.requestId, body);
  }

  @Post(':requestId/reject')
  @HttpCode(200)
  reject(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(requestParams) params: { requestId: string },
    @Body(new ContractPipe(A.reject.body!)) body: unknown,
  ) {
    return this.requests.reject(p.userId, params.requestId, body);
  }
}
