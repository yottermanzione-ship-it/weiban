import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ChatEndpoints as E, type SendMessageRequest } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ChatReadService } from '../application/read.js';
import { ChatUserService } from '../application/user.js';
@Controller('api/v1/conversations')
@RequireAuth('user')
export class ChatController {
  constructor(
    @Inject(ChatReadService) private readonly reader: ChatReadService,
    @Inject(ChatUserService) private readonly users: ChatUserService,
  ) {}
  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.reader.listForUser(p.userId);
  }
  @Get(':conversationId')
  get(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getConversation.params!)) params: { conversationId: string },
  ) {
    return this.reader.forUser(p.userId, params.conversationId);
  }
  @Get(':conversationId/messages')
  page(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.listMessages.params!)) params: { conversationId: string },
    @Query(new ContractPipe(E.listMessages.query!)) query: unknown,
  ) {
    return this.reader.pageForUser(p.userId, params.conversationId, query);
  }
  @Post(':conversationId/messages')
  @HttpCode(200)
  send(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.sendMessage.params!)) params: { conversationId: string },
    @Body(new ContractPipe(E.sendMessage.body!)) body: SendMessageRequest,
  ) {
    return this.users.sendMessage(p.userId, params.conversationId, body);
  }
  @Post(':conversationId/messages/:messageId/recall')
  @HttpCode(200)
  recall(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.recallMessage.params!))
    params: { conversationId: string; messageId: string },
  ) {
    return this.users.recall(p.userId, params.conversationId, params.messageId);
  }
  @Post(':conversationId/messages/:messageId/hide')
  @HttpCode(204)
  hide(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.hideMessage.params!))
    params: { conversationId: string; messageId: string },
  ) {
    return this.users.hide(p.userId, params.conversationId, params.messageId);
  }
  @Post(':conversationId/read')
  @HttpCode(204)
  read(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.markRead.params!)) params: { conversationId: string },
    @Body(new ContractPipe(E.markRead.body!)) body: { readSeq: number },
  ) {
    return this.users.markRead(p.userId, params.conversationId, body.readSeq);
  }
  @Post(':conversationId/unread')
  @HttpCode(204)
  unread(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.markUnread.params!)) params: { conversationId: string },
  ) {
    return this.users.markUnread(p.userId, params.conversationId);
  }
  @Patch(':conversationId/state')
  state(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.updateState.params!)) params: { conversationId: string },
    @Body(new ContractPipe(E.updateState.body!)) body: unknown,
  ) {
    return this.users.updateState(p.userId, params.conversationId, body);
  }
  @Post(':conversationId/clear')
  @HttpCode(200)
  clear(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.clearHistory.params!)) params: { conversationId: string },
  ) {
    return this.users.clear(p.userId, params.conversationId);
  }
}
