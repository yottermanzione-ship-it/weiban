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
import { LegacyFavoritesEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { LegacyFavoritesService } from '../application/legacy-favorites.service.js';

@Controller('api/v1/library/legacy-favorites')
@RequireAuth('user')
export class LegacyFavoritesController {
  constructor(@Inject(LegacyFavoritesService) private readonly service: LegacyFavoritesService) {}
  @Get('source')
  source(@CurrentPrincipal() p: AuthPrincipal) {
    return this.service.source(p.userId);
  }
  @Post('import')
  @HttpCode(200)
  import(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.import.body!)) body: unknown,
  ) {
    return this.service.import(p.userId, body);
  }
  @Get()
  list(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.list.query!)) query: { cursor?: string; limit: number },
  ) {
    return this.service.list(p.userId, query);
  }
  @Delete(':favoriteId')
  @HttpCode(204)
  remove(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.remove.params!)) params: { favoriteId: string },
  ) {
    return this.service.remove(p.userId, params.favoriteId);
  }
}
