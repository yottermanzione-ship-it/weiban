/** v5 批 B：记忆分档与长上下文（契约 MemoryTierEndpoints，3.17）。 */
import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import { MemoryTierEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { MemoryService } from '../application/memory.js';
import { MemoryTierService } from '../application/memory-tier.js';
import { CompanionSettingsService } from '../application/settings.js';

@Controller('api/v1/characters/:characterId/memory-tier')
@RequireAuth('user')
export class MemoryTierController {
  constructor(
    @Inject(MemoryService) private readonly memories: MemoryService,
    @Inject(MemoryTierService) private readonly tiers: MemoryTierService,
    @Inject(CompanionSettingsService) private readonly settings: CompanionSettingsService,
  ) {}

  @Get()
  async status(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.status.params!)) params: { characterId: string },
  ) {
    const count = await this.memories.libraryCount(p.userId, params.characterId);
    const settings = await this.settings.get(p.userId, params.characterId);
    return this.tiers.status(p.userId, params.characterId, count, settings.longContext === true);
  }
}

@Controller('api/v1/admin/ai/memory-tiers')
@RequireAuth('admin')
export class MemoryTierAdminController {
  constructor(@Inject(MemoryTierService) private readonly tiers: MemoryTierService) {}

  @Get()
  get() {
    return this.tiers.adminGet();
  }

  @Put()
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.adminUpdate.body!)) body: unknown,
  ) {
    return this.tiers.adminUpdate(p.userId, body);
  }
}
