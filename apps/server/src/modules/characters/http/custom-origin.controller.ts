/** 自定义角色来源标注（契约 CustomCharacterOriginEndpoints，PLZ-04 第 4 条），T-088。 */
import { Controller, Get, Inject, Param } from '@nestjs/common';
import { CustomCharacterOriginEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CharacterPlazaService } from '../application/plaza-port.js';

@Controller('api/v1/characters/custom')
@RequireAuth('user')
export class CustomCharacterOriginController {
  constructor(@Inject(CharacterPlazaService) private readonly plaza: CharacterPlazaService) {}

  @Get(':characterId/origin')
  origin(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getOrigin.params!)) params: { characterId: string },
  ) {
    return this.plaza.getOrigin(p.userId, params.characterId);
  }
}
