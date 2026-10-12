/**
 * 卡册、成就、熟悉度总览（契约 GrowthCardEndpoints，T-076）。
 */
import { Controller, Get, Inject, Param } from '@nestjs/common';
import { GrowthCardEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { AchievementService } from '../application/achievements.service.js';
import { CardsService } from '../application/cards.service.js';
import { GrowthService } from '../application/growth.service.js';

@Controller('api/v1/growth')
@RequireAuth('user')
export class GrowthCardsController {
  constructor(
    @Inject(CardsService) private readonly cards: CardsService,
    @Inject(AchievementService) private readonly achievements: AchievementService,
    @Inject(GrowthService) private readonly growth: GrowthService,
  ) {}

  @Get('cards')
  listAlbums(@CurrentPrincipal() p: AuthPrincipal) {
    return this.cards.listAlbums(p.userId);
  }

  @Get('achievements')
  listAchievements(@CurrentPrincipal() p: AuthPrincipal) {
    return this.achievements.list(p.userId);
  }

  @Get('familiarity')
  listFamiliarity(@CurrentPrincipal() p: AuthPrincipal) {
    return this.growth.listFamiliarity(p.userId);
  }

  @Get('card/:cardId')
  getCard(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getCard.params!)) params: { cardId: string },
  ) {
    return this.cards.getCard(p.userId, params.cardId);
  }

  @Get(':characterId/cards')
  getAlbum(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getAlbum.params!)) params: { characterId: string },
  ) {
    return this.cards.getAlbum(p.userId, params.characterId);
  }
}
