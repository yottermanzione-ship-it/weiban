import { Body, Controller, Delete, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { ChatActionEndpoints as A, ChatGroupEndpoints as G } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ChatActionService } from '../application/actions.js';
import { ChatGroupService } from '../application/groups.js';

/** 群聊（SOC-03）：建群、改名、加人、移出、删除并退出。 */
@Controller('api/v1/groups')
@RequireAuth('user')
export class ChatGroupController {
  constructor(@Inject(ChatGroupService) private readonly groups: ChatGroupService) {}
  @Post()
  @HttpCode(201)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(G.createGroup.body!)) body: unknown,
  ) {
    return this.groups.createForUser(p.userId, body);
  }
  @Patch(':conversationId')
  rename(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(G.renameGroup.params!)) params: { conversationId: string },
    @Body(new ContractPipe(G.renameGroup.body!)) body: { title: string },
  ) {
    return this.groups.renameForUser(p.userId, params.conversationId, body.title);
  }
  @Post(':conversationId/members')
  @HttpCode(200)
  add(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(G.addMembers.params!)) params: { conversationId: string },
    @Body(new ContractPipe(G.addMembers.body!)) body: { characterIds: string[] },
  ) {
    return this.groups.addForUser(p.userId, params.conversationId, body.characterIds);
  }
  @Delete(':conversationId/members/:characterId')
  remove(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(G.removeMember.params!))
    params: { conversationId: string; characterId: string },
  ) {
    return this.groups.removeForUser(p.userId, params.conversationId, params.characterId);
  }
  @Post(':conversationId/dissolve')
  @HttpCode(204)
  async dissolve(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(G.dissolveGroup.params!)) params: { conversationId: string },
  ) {
    await this.groups.dissolveForUser(p.userId, params.conversationId);
  }
}

/** 卡片消息按钮（ADR-0026）。 */
@Controller('api/v1/conversations')
@RequireAuth('user')
export class ChatActionController {
  constructor(@Inject(ChatActionService) private readonly actions: ChatActionService) {}
  @Post(':conversationId/messages/:messageId/action')
  @HttpCode(200)
  choose(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(A.chooseMessageAction.params!))
    params: { conversationId: string; messageId: string },
    @Body(new ContractPipe(A.chooseMessageAction.body!)) body: { actionId: string },
  ) {
    return this.actions.choose(p.userId, params.conversationId, params.messageId, body.actionId);
  }
}
