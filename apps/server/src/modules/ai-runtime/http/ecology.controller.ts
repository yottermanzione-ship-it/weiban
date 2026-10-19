/** 角色生态 v1（契约 3.19 EcologyEndpoints / EcologyAdminEndpoints）。 */
import { Body, Controller, Get, Inject, Param, Patch, Put, Query } from '@nestjs/common';
import {
  EcologyAdminEndpoints as A,
  EcologyEndpoints as E,
  type EcologyConfig,
  type EcologyRunStatus,
} from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { EcologySettingsService } from '../application/ecology-settings.js';
import { EcologyService } from '../application/ecology.js';

@Controller('api/v1')
@RequireAuth('user')
export class EcologyController {
  constructor(
    @Inject(EcologySettingsService) private readonly settings: EcologySettingsService,
    @Inject(EcologyService) private readonly ecology: EcologyService,
  ) {}

  @Get('me/ecology')
  get(@CurrentPrincipal() p: AuthPrincipal) {
    return this.settings.get(p.userId);
  }

  @Patch('me/ecology')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.update.body!)) body: unknown,
  ) {
    return this.settings.update(p.userId, body);
  }

  @Put('me/ecology/characters/:characterId')
  setCharacter(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.setCharacter.params!)) params: { characterId: string },
    @Body(new ContractPipe(E.setCharacter.body!)) body: { enabled: boolean },
  ) {
    return this.settings.setCharacter(p.userId, params.characterId, body.enabled);
  }

  @Get('characters/:characterId/murmurs')
  murmurs(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.listMurmurs.params!)) params: { characterId: string },
    @Query(new ContractPipe(E.listMurmurs.query!)) query: { cursor?: string; limit: number },
  ) {
    return this.ecology.listMurmurs(p.userId, params.characterId, query);
  }

  @Get('characters/:characterId/ecology-profile')
  profile(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getCharacterProfile.params!)) params: { characterId: string },
  ) {
    return this.ecology.getCharacterProfile(p.userId, params.characterId);
  }
}

@Controller('api/v1/admin/ai/ecology')
@RequireAuth('admin')
export class EcologyAdminController {
  constructor(
    @Inject(EcologySettingsService) private readonly settings: EcologySettingsService,
    @Inject(EcologyService) private readonly ecology: EcologyService,
  ) {}

  @Get()
  overview(@CurrentPrincipal() p: AuthPrincipal) {
    return this.settings.adminOverview(p.userId);
  }

  @Put()
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(A.updateConfig.body!)) body: EcologyConfig,
  ) {
    return this.settings.updateConfig(p.userId, body);
  }

  @Get('runs')
  runs(
    @Query(new ContractPipe(A.listRuns.query!))
    query: {
      userId?: string;
      status?: EcologyRunStatus;
      cursor?: string;
      limit: number;
    },
  ) {
    return this.ecology.listRuns(query);
  }
}
