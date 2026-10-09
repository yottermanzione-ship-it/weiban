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
import {
  ContactCardEndpoints as C,
  ContactsEndpoints as E,
  NewFriendsEndpoints as N,
} from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ContactsCommands } from '../application/commands.js';
import { ContactCardRecommendationService } from '../application/recommendations.js';
@Controller('api/v1/contacts')
@RequireAuth('user')
export class ContactsController {
  constructor(
    @Inject(ContactsCommands) private readonly commands: ContactsCommands,
    @Inject(ContactCardRecommendationService)
    private readonly recommendations: ContactCardRecommendationService,
  ) {}
  /** 「新的朋友」列表（3.0.1）。 */
  @Get('new-friends')
  newFriends(@CurrentPrincipal() p: AuthPrincipal) {
    return this.recommendations.listNewFriends(p.userId);
  }
  @Post('new-friends/seen')
  @HttpCode(204)
  async newFriendsSeen(@CurrentPrincipal() p: AuthPrincipal) {
    await this.recommendations.markNewFriendsSeen(p.userId);
  }
  @Delete('new-friends/:itemId')
  @HttpCode(204)
  async removeNewFriend(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(N.remove.params!)) params: { itemId: string },
  ) {
    await this.recommendations.removeNewFriend(p.userId, params.itemId);
  }
  /** 名片「不感兴趣」（CHR-04 第 4 条，P-27 冷却 90 天）。 */
  @Post('recommendations/:characterId/dismiss')
  @HttpCode(204)
  async dismissRecommendation(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(C.dismissRecommendation.params!)) params: { characterId: string },
  ) {
    await this.recommendations.dismiss(p.userId, params.characterId);
  }
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
