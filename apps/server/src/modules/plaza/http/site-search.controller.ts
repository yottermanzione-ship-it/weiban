/** 5.5：站内角色搜索（契约 SearchEndpoints.suggest / results，T-20261104b）。不调用模型、不收费。 */
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { SearchEndpoints as E } from '@weiban/contracts';
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
}
