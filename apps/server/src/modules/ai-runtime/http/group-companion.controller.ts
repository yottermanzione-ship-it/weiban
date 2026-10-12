import { Body, Controller, Get, Inject, Param, Patch } from '@nestjs/common';
import { GroupCompanionEndpoints as E, type ScenarioMode } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { GroupChatService } from '../application/group-chat.js';

/** T-065 群聊信息页微伴专属一组（SOC-03 第 3、4 条）。 */
@Controller('api/v1')
@RequireAuth('user')
export class GroupCompanionController {
  constructor(@Inject(GroupChatService) private readonly groups: GroupChatService) {}
  @Get('groups/:conversationId/companion-settings')
  get(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getSettings.params!)) params: { conversationId: string },
  ) {
    return this.groups.getSettings(p.userId, params.conversationId);
  }
  @Patch('groups/:conversationId/companion-settings')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.updateSettings.params!)) params: { conversationId: string },
    @Body(new ContractPipe(E.updateSettings.body!))
    body: { instantReply?: boolean; selfChatEnabled?: boolean; scenarioMode?: ScenarioMode },
  ) {
    return this.groups.updateSettings(p.userId, params.conversationId, body);
  }
  @Get('groups/:conversationId/scenario-modes')
  modes(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.listModes.params!)) params: { conversationId: string },
  ) {
    return this.groups.listModes(p.userId, params.conversationId);
  }
}
