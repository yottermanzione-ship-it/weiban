/** 慢信（契约 LetterEndpoints），T-093。 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { LetterEndpoints as L } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { LettersService } from '../application/letters.service.js';

@Controller('api/v1/play')
@RequireAuth('user')
export class LettersController {
  constructor(@Inject(LettersService) private readonly letters: LettersService) {}

  // 固定路径（badge）在 :letterId 之前匹配。
  @Get('letters/badge')
  badge(@CurrentPrincipal() p: AuthPrincipal) {
    return this.letters.getBadge(p.userId);
  }

  @Get('letters')
  list(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(L.listLetters.query!))
    query: { box: 'received' | 'sent' | 'drafts'; characterId?: string; cursor?: string },
  ) {
    return this.letters.listLetters(p.userId, query);
  }

  @Get('letters/:letterId')
  get(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(L.getLetter.params!)) params: { letterId: string },
  ) {
    return this.letters.getLetter(p.userId, params.letterId);
  }

  @Put('letter-drafts/:characterId')
  saveDraft(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(L.saveDraft.params!)) params: { characterId: string },
    @Body() body: unknown,
  ) {
    return this.letters.saveDraft(p.userId, params.characterId, body);
  }

  @Post('letters')
  @HttpCode(200)
  send(@CurrentPrincipal() p: AuthPrincipal, @Body() body: unknown) {
    return this.letters.sendLetter(p.userId, body);
  }
}
