/** 聊天记录搜索（契约 ChatSearchEndpoints，CHAT-12，ADR-0027，T-078）。 */
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ChatSearchEndpoints as S } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ChatSearchService } from '../application/search.js';

@Controller('api/v1')
@RequireAuth('user')
export class ChatSearchController {
  constructor(@Inject(ChatSearchService) private readonly search: ChatSearchService) {}
  @Get('search')
  searchAll(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(S.searchAll.query!)) query: { q: string },
  ) {
    return this.search.searchAll(p.userId, query.q);
  }
  @Get('conversations/:conversationId/search')
  searchConversation(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(S.searchConversation.params!)) params: { conversationId: string },
    @Query(new ContractPipe(S.searchConversation.query!))
    query: { q: string; beforeSeq?: number; senderParticipantId?: string; limit: number },
  ) {
    return this.search.searchConversation(p.userId, params.conversationId, query);
  }
  @Get('conversations/:conversationId/messages/locate')
  locateByDate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(S.locateByDate.params!)) params: { conversationId: string },
    @Query(new ContractPipe(S.locateByDate.query!)) query: { date: string },
  ) {
    return this.search.locateByDate(p.userId, params.conversationId, query.date);
  }
  @Get('conversations/:conversationId/messages/by-type')
  listByType(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(S.listByType.params!)) params: { conversationId: string },
    @Query(new ContractPipe(S.listByType.query!))
    query: {
      contentType?: 'image' | 'link' | 'voice' | 'sticker';
      senderParticipantId?: string;
      beforeSeq?: number;
      limit: number;
    },
  ) {
    return this.search.listByType(p.userId, params.conversationId, query);
  }
}
