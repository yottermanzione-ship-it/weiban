/** 收藏（契约 LibraryEndpoints）与分享图数据（ShareEndpoints），T-078。 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { LibraryEndpoints as L, ShareEndpoints as S } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { LibraryService } from '../application/library.service.js';

@Controller('api/v1')
@RequireAuth('user')
export class LibraryController {
  constructor(@Inject(LibraryService) private readonly library: LibraryService) {}

  @Get('library/favorites')
  listFavorites(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(L.listFavorites.query!))
    query: { characterId?: string; q?: string; cursor?: string; limit: number },
  ) {
    return this.library.listFavorites(p.userId, query);
  }

  @Post('library/favorites')
  @HttpCode(200)
  addFavorites(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(L.addFavorites.body!)) body: unknown,
  ) {
    return this.library.addFavorites(p.userId, body);
  }

  @Delete('library/favorites/:favoriteId')
  @HttpCode(204)
  async removeFavorite(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(L.removeFavorite.params!)) params: { favoriteId: string },
  ) {
    await this.library.removeFavorite(p.userId, params.favoriteId);
  }

  @Post('library/share-images/prepare')
  @HttpCode(200)
  prepare(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(S.prepare.body!)) body: unknown,
  ) {
    return this.library.prepareShare(p.userId, body);
  }

  @Post('library/share-images/generated')
  @HttpCode(204)
  async recordGenerated(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(S.recordGenerated.body!)) body: unknown,
  ) {
    await this.library.recordGenerated(p.userId, body);
  }

  @Get('me/share-preferences')
  getPreferences(@CurrentPrincipal() p: AuthPrincipal) {
    return this.library.getPreferences(p.userId);
  }

  @Put('me/share-preferences')
  updatePreferences(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(S.updatePreferences.body!)) body: unknown,
  ) {
    return this.library.updatePreferences(p.userId, body);
  }
}
