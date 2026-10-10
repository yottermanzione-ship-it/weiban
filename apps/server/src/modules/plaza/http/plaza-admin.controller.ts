/** 人设广场管理端（契约 PlazaAdminEndpoints，ADM-09），T-087。 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { PlazaAdminEndpoints as A } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { PlazaAdminService } from '../application/plaza-admin.service.js';

const workParams = new ContractPipe(A.removeWork.params!);
const userParams = new ContractPipe(A.banAuthor.params!);

@Controller('api/v1/admin/plaza')
@RequireAuth('admin')
export class PlazaAdminController {
  constructor(@Inject(PlazaAdminService) private readonly admin: PlazaAdminService) {}

  @Get('works')
  listWorks(@CurrentPrincipal() p: AuthPrincipal, @Query() query: unknown) {
    return this.admin.listWorks(p.userId, query);
  }

  @Get('works/:workId/versions/:version')
  getVersion(
    @Param(new ContractPipe(A.getWorkVersion.params!)) params: { workId: string; version: number },
  ) {
    return this.admin.getWorkVersion(params.workId, params.version);
  }

  @Post('works/:workId/remove')
  @HttpCode(200)
  remove(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(workParams) params: { workId: string },
    @Body(new ContractPipe(A.removeWork.body!)) body: unknown,
  ) {
    return this.admin.removeWork(p.userId, params.workId, body);
  }

  @Post('works/:workId/restore')
  @HttpCode(200)
  restore(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(workParams) params: { workId: string },
    @Body(new ContractPipe(A.restoreWork.body!)) body: unknown,
  ) {
    return this.admin.restoreWork(p.userId, params.workId, body);
  }

  @Post('works/:workId/tighten-classification')
  @HttpCode(200)
  tighten(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(workParams) params: { workId: string },
    @Body(new ContractPipe(A.tightenClassification.body!)) body: unknown,
  ) {
    return this.admin.tightenClassification(p.userId, params.workId, body);
  }

  @Get('reports')
  listReports(@Query() query: unknown) {
    return this.admin.listReports(query);
  }

  @Post('reports/:reportId/resolve')
  @HttpCode(200)
  resolve(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(A.resolveReport.params!)) params: { reportId: string },
    @Body(new ContractPipe(A.resolveReport.body!)) body: unknown,
  ) {
    return this.admin.resolveReport(p.userId, params.reportId, body);
  }

  @Post('comments/:commentId/delete')
  @HttpCode(204)
  async deleteComment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(A.deleteComment.params!)) params: { commentId: string },
    @Body(new ContractPipe(A.deleteComment.body!)) body: unknown,
  ) {
    await this.admin.deleteComment(p.userId, params.commentId, body);
  }

  @Post('users/:userId/ban')
  @HttpCode(204)
  async ban(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(userParams) params: { userId: string },
    @Body(new ContractPipe(A.banAuthor.body!)) body: unknown,
  ) {
    await this.admin.banAuthor(p.userId, params.userId, body);
  }

  @Post('users/:userId/unban')
  @HttpCode(204)
  async unban(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(A.unbanAuthor.params!)) params: { userId: string },
    @Body(new ContractPipe(A.unbanAuthor.body!)) body: unknown,
  ) {
    await this.admin.unbanAuthor(p.userId, params.userId, body);
  }
}
