/** 朋友圈 HTTP（MomentsEndpoints，SOC-07～SOC-09）。 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { MomentsEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { MomentsService } from '../application/moments.js';

type PageQuery = { cursor?: string; limit: number };

@Controller('api/v1/moments')
@RequireAuth('user')
export class MomentsController {
  constructor(@Inject(MomentsService) private readonly moments: MomentsService) {}
  @Get('feed')
  feed(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.listFeed.query!)) q: PageQuery,
  ) {
    return this.moments.listFeed(p.userId, q);
  }
  @Get('me')
  mine(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.listMyPosts.query!)) q: PageQuery,
  ) {
    return this.moments.listMyPosts(p.userId, q);
  }
  @Get('notifications')
  notifications(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.listNotifications.query!)) q: PageQuery,
  ) {
    return this.moments.listNotifications(p.userId, q);
  }
  @Get('badge')
  badge(@CurrentPrincipal() p: AuthPrincipal) {
    return this.moments.getBadge(p.userId);
  }
  @Post('badge/seen')
  @HttpCode(200)
  seen(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.markSeen.body!)) body: { scope: 'posts' | 'interactions' | 'all' },
  ) {
    return this.moments.markSeen(p.userId, body.scope);
  }
  @Get('characters/:characterId')
  character(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.listCharacterPosts.params!)) params: { characterId: string },
    @Query(new ContractPipe(E.listCharacterPosts.query!)) q: PageQuery,
  ) {
    return this.moments.listCharacterPostsForUser(p.userId, params.characterId, q);
  }
  @Get('posts/:postId')
  get(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getPost.params!)) params: { postId: string },
  ) {
    return this.moments.getPostForUser(p.userId, params.postId);
  }
  @Post('posts')
  @HttpCode(201)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.createPost.body!)) body: unknown,
  ) {
    return this.moments.createUserPost(p.userId, body);
  }
  @Delete('posts/:postId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.deletePost.params!)) params: { postId: string },
  ) {
    await this.moments.deleteUserPost(p.userId, params.postId);
  }
  @Post('posts/:postId/like')
  @HttpCode(200)
  like(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.like.params!)) params: { postId: string },
  ) {
    return this.moments.likeAsUser(p.userId, params.postId);
  }
  @Delete('posts/:postId/like')
  unlike(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.unlike.params!)) params: { postId: string },
  ) {
    return this.moments.unlikeAsUser(p.userId, params.postId);
  }
  @Post('posts/:postId/comments')
  @HttpCode(200)
  comment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.comment.params!)) params: { postId: string },
    @Body(new ContractPipe(E.comment.body!))
    body: { clientRequestId: string; text: string; replyToCommentId?: string | null },
  ) {
    return this.moments.commentAsUser(p.userId, params.postId, body);
  }
  @Delete('posts/:postId/comments/:commentId')
  deleteComment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.deleteComment.params!)) params: { postId: string; commentId: string },
  ) {
    return this.moments.deleteUserComment(p.userId, params.postId, params.commentId);
  }
}
