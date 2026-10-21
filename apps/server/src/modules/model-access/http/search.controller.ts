import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { SearchEndpoints, type CharacterSearchCandidate } from '@weiban/contracts';
import type { z } from 'zod';
import {
  AppError,
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  newId,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ModelGatewayMedia } from '../application/media-gateway.js';
import { WebToolsStore } from '../application/web-tools-store.js';
import { characterCandidates, privateSearchText } from '../domain/web-search.js';

const E = SearchEndpoints.characterCandidates;
@Controller('api/v1/search')
export class SearchController {
  constructor(
    @Inject(ModelGatewayMedia) private readonly media: ModelGatewayMedia,
    @Inject(WebToolsStore) private readonly store: WebToolsStore,
  ) {}
  @Post('character-candidates')
  @HttpCode(200)
  @RequireAuth(E.auth)
  async candidates(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(E.body!)) body: z.output<NonNullable<typeof E.body>>,
  ): Promise<{ items: CharacterSearchCandidate[] }> {
    if (privateSearchText(body.query))
      throw new AppError('bad_request', '只能搜索公众人物或知名作品角色，请勿输入私人信息');
    if (!(await this.media.isServiceEnabled('web_search')))
      throw new AppError('service_unavailable', '联网查找暂未开通');
    if (!(await this.store.consumeCandidate(me.userId)))
      throw new AppError('rate_limited', '今天联网找得太多啦，请稍后或明天再试');
    const result = await this.media.webSearch({
      userId: me.userId,
      purpose: 'search_candidates',
      billingOwner: 'platform',
      query: `"${body.query.replace(/["\\]/gu, '')}" (人物 OR 演员 OR 歌手 OR 动漫 OR 游戏 OR 小说角色)`,
      maxResults: 5,
      idempotencyKey: `search-candidate:${newId()}`,
    });
    if (!result.ok) throw new AppError('service_unavailable', '联网查找暂时不可用，请稍后重试');
    return { items: characterCandidates(body.query, result.value.items) };
  }
}
