import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { LegacyPersonaEndpoints as E, type LegacyPersonaReset } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { LegacyPersonaService } from '../application/legacy-persona.js';

@Controller('api/v1/characters')
@RequireAuth('user')
export class LegacyPersonaController {
  constructor(@Inject(LegacyPersonaService) private readonly service: LegacyPersonaService) {}
  @Get('legacy-personas')
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.list(principal.userId);
  }
  @Get(':characterId/legacy-persona')
  get(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param(new ContractPipe(E.get.params!)) params: { characterId: string },
  ) {
    return this.service.get(principal.userId, params.characterId);
  }
  @Post(':characterId/legacy-persona/reset')
  @HttpCode(200)
  reset(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param(new ContractPipe(E.reset.params!)) params: { characterId: string },
    @Body(new ContractPipe(E.reset.body!)) body: LegacyPersonaReset,
  ) {
    return this.service.reset(principal.userId, params.characterId, body);
  }
}
