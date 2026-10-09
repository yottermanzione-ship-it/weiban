import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { GrowthEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { GrowthService } from '../application/growth.service.js';

@Controller('api/v1/growth')
@RequireAuth('user')
export class GrowthController {
  constructor(@Inject(GrowthService) private readonly service: GrowthService) {}

  @Get(':characterId/familiarity')
  getFamiliarity(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getFamiliarity.params!)) params: { characterId: string },
  ) {
    return this.service.getFamiliarity(p.userId, params.characterId);
  }

  @Post(':characterId/familiarity/points')
  @HttpCode(200)
  addPoints(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.addPoints.params!)) params: { characterId: string },
    @Body(new ContractPipe(E.addPoints.body!)) body: unknown,
  ) {
    return this.service.addPoints(p.userId, params.characterId, body);
  }

  @Get(':characterId/days-known')
  getDaysKnown(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getDaysKnown.params!)) params: { characterId: string },
  ) {
    return this.service.getDaysKnown(p.userId, params.characterId);
  }

  @Post(':characterId/anniversaries')
  addAnniversary(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.addAnniversary.params!)) params: { characterId: string },
    @Body(new ContractPipe(E.addAnniversary.body!)) body: unknown,
  ) {
    return this.service.addAnniversary(p.userId, params.characterId, body);
  }

  @Delete(':characterId/anniversaries/:anniversaryId')
  @HttpCode(204)
  removeAnniversary(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.removeAnniversary.params!))
    params: {
      characterId: string;
      anniversaryId: string;
    },
  ) {
    return this.service.removeAnniversary(p.userId, params.characterId, params.anniversaryId);
  }
}
