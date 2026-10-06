import { Body, Controller, Get, Inject, Param, Patch } from '@nestjs/common';
import { CompanionEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CompanionSettingsService } from '../application/settings.js';
@Controller('api/v1')
@RequireAuth('user')
export class CompanionSettingsController {
  constructor(
    @Inject(CompanionSettingsService) private readonly settings: CompanionSettingsService,
  ) {}
  @Get('me/companion-defaults')
  async defaults(@CurrentPrincipal() p: AuthPrincipal) {
    const { instantReply, splitBubbles, updatedAt } = await this.settings.get(p.userId, null);
    return { instantReply, splitBubbles, updatedAt };
  }
  @Patch('me/companion-defaults')
  async updateDefaults(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.updateDefaults.body!)) body: unknown,
  ) {
    const { instantReply, splitBubbles, updatedAt } = await this.settings.update(
      p.userId,
      null,
      body,
    );
    return { instantReply, splitBubbles, updatedAt };
  }
  @Get('characters/:characterId/companion-settings')
  get(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getForCharacter.params!)) params: { characterId: string },
  ) {
    return this.settings.get(p.userId, params.characterId);
  }
  @Patch('characters/:characterId/companion-settings')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.updateForCharacter.params!)) params: { characterId: string },
    @Body(new ContractPipe(E.updateForCharacter.body!)) body: unknown,
  ) {
    return this.settings.update(p.userId, params.characterId, body);
  }
}
