import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  HttpCode,
} from '@nestjs/common';
import { MemoryEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { MemoryService } from '../application/memory.js';
@Controller('api/v1/characters/:characterId/memories')
@RequireAuth('user')
export class MemoryController {
  constructor(@Inject(MemoryService) readonly memories: MemoryService) {}
  @Get()
  list(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.list.params!)) params: { characterId: string },
    @Query(new ContractPipe(E.list.query!)) query: { afterId?: string; limit: number },
  ) {
    return this.memories.list(p.userId, params.characterId, query);
  }
  @Post()
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.create.params!)) params: { characterId: string },
    @Body(new ContractPipe(E.create.body!)) body: unknown,
  ) {
    return this.memories.create(p.userId, params.characterId, body);
  }
  @Patch(':memoryId')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.update.params!)) params: { characterId: string; memoryId: string },
    @Body(new ContractPipe(E.update.body!)) body: unknown,
  ) {
    return this.memories.update(p.userId, params.characterId, params.memoryId, body);
  }
  @Delete(':memoryId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.remove.params!)) params: { characterId: string; memoryId: string },
  ) {
    await this.memories.remove(p.userId, params.characterId, params.memoryId);
  }
}
