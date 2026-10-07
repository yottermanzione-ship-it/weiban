import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ContactsEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ContactsCommands } from '../application/commands.js';
@Controller('api/v1/contacts')
@RequireAuth('user')
export class ContactsController {
  constructor(@Inject(ContactsCommands) private readonly commands: ContactsCommands) {}
  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.commands.list(p.userId);
  }
  @Post()
  @HttpCode(200)
  add(@CurrentPrincipal() p: AuthPrincipal, @Body(new ContractPipe(E.add.body!)) body: unknown) {
    return this.commands.add(p.userId, body);
  }
  @Patch(':characterId')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.update.params!)) params: { characterId: string },
    @Body(new ContractPipe(E.update.body!)) body: unknown,
  ) {
    return this.commands.update(p.userId, params.characterId, body);
  }
  @Delete(':characterId')
  @HttpCode(204)
  remove(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.remove.params!)) params: { characterId: string },
    @Query(new ContractPipe(E.remove.query!)) query: { mode: 'soft' | 'purge' },
  ) {
    return this.commands.remove(p.userId, params.characterId, query.mode);
  }
}
