/**
 * 人设版本管理后台 HTTP 接口（ADM-06）。
 * 一一对应契约 PersonaVersionAdminEndpoints（packages/contracts/src/http/admin-content.ts）。
 */
import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { PersonaVersionAdminEndpoints as E } from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CharacterService } from '../application/characters.js';

type Out<S extends z.ZodType | undefined> = z.output<NonNullable<S>>;

function schema<S extends z.ZodType>(value: S | undefined): S {
  if (!value) throw new Error('契约接口缺少 schema');
  return value;
}

@Controller('api/v1/admin/characters/:characterId/persona-versions')
export class PersonaVersionAdminController {
  constructor(@Inject(CharacterService) private readonly service: CharacterService) {}

  @Get()
  @RequireAuth(E.listPersonaVersions.auth)
  async list(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.listPersonaVersions.params)))
    params: Out<typeof E.listPersonaVersions.params>,
  ) {
    return { items: await this.service.listPersonaVersions(me.userId, params.characterId) };
  }

  @Post(':version/rollback')
  @RequireAuth(E.rollbackPersonaVersion.auth)
  async rollback(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(E.rollbackPersonaVersion.params)))
    params: Out<typeof E.rollbackPersonaVersion.params>,
  ) {
    return this.service.rollbackPersonaVersion(me.userId, params.characterId, params.version);
  }
}
