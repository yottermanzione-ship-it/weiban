/** 我的补充设定（CharacterSupplementEndpoints）与「资料已更新」（PersonaUpdateEndpoints），T-079。 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { CharacterSupplementEndpoints as S, PersonaUpdateEndpoints as P } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CharacterSupplementService } from '../application/supplements.js';

@Controller('api/v1/characters')
@RequireAuth('user')
export class CharacterSupplementController {
  constructor(
    @Inject(CharacterSupplementService) private readonly supplements: CharacterSupplementService,
  ) {}

  @Get(':characterId/supplement')
  get(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(S.getSupplement.params!)) params: { characterId: string },
  ) {
    return this.supplements.getForUser(p.userId, params.characterId);
  }

  @Put(':characterId/supplement')
  put(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(S.putSupplement.params!)) params: { characterId: string },
    @Body(new ContractPipe(S.putSupplement.body!)) body: { text: string },
  ) {
    return this.supplements.put(p.userId, params.characterId, body);
  }

  @Delete(':characterId/supplement')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(S.deleteSupplement.params!)) params: { characterId: string },
  ) {
    await this.supplements.remove(p.userId, params.characterId);
  }

  @Get(':characterId/persona-updates')
  listUpdates(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(P.listPersonaUpdates.params!)) params: { characterId: string },
  ) {
    return this.supplements.listUpdates(p.userId, params.characterId);
  }

  @Post(':characterId/persona-updates/seen')
  @HttpCode(204)
  async markSeen(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(P.markPersonaUpdatesSeen.params!)) params: { characterId: string },
  ) {
    await this.supplements.markSeen(p.userId, params.characterId);
  }
}
