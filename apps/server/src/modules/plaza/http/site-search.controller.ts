/**
 * 5.5：站内角色搜索（契约 SearchEndpoints.suggest / results，T-20261104b）。不调用模型、不收费。
 * 5.6（T-20261104e）：联网查找（character-candidates，S 的额度 / 缓存 / 计费不变）和点击候选
 * （character-candidates/resolve，只收候选 ID）也在这里；原 model-access 的 SearchController 已并入。
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { SearchEndpoints as E } from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { SiteSearchService } from '../application/site-search.service.js';

@Controller('api/v1/search')
@RequireAuth('user')
export class SiteSearchController {
  constructor(@Inject(SiteSearchService) private readonly search: SiteSearchService) {}

  @Get('suggest')
  suggest(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.suggest.query!)) query: { q: string },
  ) {
    return this.search.suggest(p.userId, query.q);
  }

  @Get('characters')
  results(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.results.query!))
    query: { q: string; prefer?: 'official' | 'plaza'; cursor?: string; limit: number },
  ) {
    return this.search.results(p.userId, query);
  }

  @Post('character-candidates')
  @HttpCode(200)
  candidates(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.characterCandidates.body!))
    body: z.output<NonNullable<typeof E.characterCandidates.body>>,
  ) {
    return this.search.webCandidates(p.userId, body.query);
  }

  @Post('character-candidates/resolve')
  @HttpCode(200)
  resolve(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.resolveCandidate.body!))
    body: z.output<NonNullable<typeof E.resolveCandidate.body>>,
  ) {
    return this.search.resolveWebCandidate(p.userId, body.candidateId);
  }
}
