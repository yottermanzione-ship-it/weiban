/** 人设广场用户端（契约 PlazaEndpoints），T-087。 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PlazaEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { PlazaOfficialService } from '../application/plaza-official.service.js';
import { PlazaService } from '../application/plaza.service.js';

const workParams = new ContractPipe(E.getWork.params!);
const cursorQuery = new ContractPipe(E.listNotices.query!);

@Controller('api/v1/plaza')
@RequireAuth('user')
export class PlazaController {
  constructor(
    @Inject(PlazaService) private readonly plaza: PlazaService,
    @Inject(PlazaOfficialService) private readonly official: PlazaOfficialService,
  ) {}

  @Get('works')
  listWorks(@CurrentPrincipal() p: AuthPrincipal, @Query() query: unknown) {
    return this.plaza.listWorks(p.userId, query);
  }

  @Get('works/:workId')
  getWork(@CurrentPrincipal() p: AuthPrincipal, @Param(workParams) params: { workId: string }) {
    return this.plaza.getWork(p.userId, params.workId);
  }

  @Patch('works/:workId')
  updateSettings(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(workParams) params: { workId: string },
    @Body(new ContractPipe(E.updateWorkSettings.body!)) body: unknown,
  ) {
    return this.plaza.updateWorkSettings(p.userId, params.workId, body);
  }

  @Delete('works/:workId')
  @HttpCode(204)
  async deleteWork(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(workParams) params: { workId: string },
  ) {
    await this.plaza.deleteWork(p.userId, params.workId);
  }

  @Post('works/:workId/unlist')
  @HttpCode(200)
  unlist(@CurrentPrincipal() p: AuthPrincipal, @Param(workParams) params: { workId: string }) {
    return this.plaza.unlistWork(p.userId, params.workId);
  }

  @Post('works/:workId/relist')
  @HttpCode(200)
  relist(@CurrentPrincipal() p: AuthPrincipal, @Param(workParams) params: { workId: string }) {
    return this.plaza.relistWork(p.userId, params.workId);
  }

  @Get('authors/:authorId')
  getAuthor(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getAuthor.params!)) params: { authorId: string },
  ) {
    return this.plaza.getAuthor(p.userId, params.authorId);
  }

  @Post('publish-drafts')
  @HttpCode(201)
  createDraft(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.createPublishDraft.body!)) body: unknown,
  ) {
    return this.plaza.createPublishDraft(p.userId, body);
  }

  @Post('publish-drafts/:draftId/confirm')
  @HttpCode(200)
  confirm(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.confirmPublish.params!)) params: { draftId: string },
    @Body(new ContractPipe(E.confirmPublish.body!)) body: unknown,
  ) {
    return this.plaza.confirmPublish(p.userId, params.draftId, body);
  }

  @Get('me/works')
  myWorks(@CurrentPrincipal() p: AuthPrincipal) {
    return this.plaza.listMyWorks(p.userId);
  }

  @Get('me/profile')
  myProfile(@CurrentPrincipal() p: AuthPrincipal) {
    return this.plaza.getMyProfile(p.userId);
  }

  @Put('me/profile')
  putProfile(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.putMyProfile.body!)) body: unknown,
  ) {
    return this.plaza.putMyProfile(p.userId, body);
  }

  @Get('badge')
  badge(@CurrentPrincipal() p: AuthPrincipal) {
    return this.plaza.getBadge(p.userId);
  }

  @Get('notices')
  notices(@CurrentPrincipal() p: AuthPrincipal, @Query(cursorQuery) query: { cursor?: string }) {
    return this.plaza.listNotices(p.userId, query.cursor);
  }

  @Post('works/:workId/like')
  @HttpCode(200)
  like(@CurrentPrincipal() p: AuthPrincipal, @Param(workParams) params: { workId: string }) {
    return this.plaza.like(p.userId, params.workId);
  }

  @Delete('works/:workId/like')
  unlike(@CurrentPrincipal() p: AuthPrincipal, @Param(workParams) params: { workId: string }) {
    return this.plaza.unlike(p.userId, params.workId);
  }

  @Get('works/:workId/comments')
  listComments(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(workParams) params: { workId: string },
    @Query(cursorQuery) query: { cursor?: string },
  ) {
    return this.plaza.listComments(p.userId, params.workId, query.cursor);
  }

  @Post('works/:workId/comments')
  @HttpCode(201)
  addComment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(workParams) params: { workId: string },
    @Body(new ContractPipe(E.addComment.body!)) body: unknown,
  ) {
    return this.plaza.addComment(p.userId, params.workId, body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  async deleteComment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.deleteComment.params!)) params: { commentId: string },
  ) {
    // 3.5：先按「微伴角色」tab 官方角色下的评论处理，找不到再按作品评论处理。
    if ((await this.official.deleteOwnComment(p.userId, params.commentId)) !== null) return;
    await this.plaza.deleteComment(p.userId, params.commentId);
  }

  @Post('reports')
  @HttpCode(204)
  async report(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.report.body!)) body: unknown,
  ) {
    await this.plaza.report(p.userId, body);
  }

  @Post('works/:workId/adopt')
  @HttpCode(200)
  adopt(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(workParams) params: { workId: string },
    @Body(new ContractPipe(E.adopt.body!)) body: unknown,
  ) {
    return this.plaza.adopt(p.userId, params.workId, body);
  }

  @Post('works/:workId/apply')
  @HttpCode(200)
  apply(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(workParams) params: { workId: string },
    @Body(new ContractPipe(E.apply.body!)) body: unknown,
  ) {
    return this.plaza.apply(p.userId, params.workId, body);
  }

  @Post('adoptions/:characterId/update')
  @HttpCode(200)
  updateAdopted(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.updateAdopted.params!)) params: { characterId: string },
    @Body(new ContractPipe(E.updateAdopted.body!)) body: unknown,
  ) {
    return this.plaza.updateAdopted(p.userId, params.characterId, body);
  }
}
