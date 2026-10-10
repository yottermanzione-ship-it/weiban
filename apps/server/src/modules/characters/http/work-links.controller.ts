/**
 * 作品链接库与默认音色（T-069）：WorkLinkAdminEndpoints（契约 http/character-extras.ts）。
 */
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
  Put,
} from '@nestjs/common';
import { WorkLinkAdminEndpoints as W } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CharacterWorkLinkService } from '../application/work-links.js';

@Controller('api/v1/admin/characters/:characterId')
@RequireAuth('admin')
export class WorkLinkAdminController {
  constructor(@Inject(CharacterWorkLinkService) private readonly links: CharacterWorkLinkService) {}
  @Get('work-links')
  list(@Param(new ContractPipe(W.listWorkLinks.params!)) p: { characterId: string }) {
    return this.links.adminList(p.characterId);
  }
  @Post('work-links')
  @HttpCode(201)
  create(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(W.createWorkLink.params!)) p: { characterId: string },
    @Body(new ContractPipe(W.createWorkLink.body!)) body: unknown,
  ) {
    return this.links.adminCreate(me.userId, p.characterId, body);
  }
  @Patch('work-links/:workLinkId')
  update(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(W.updateWorkLink.params!))
    p: { characterId: string; workLinkId: string },
    @Body(new ContractPipe(W.updateWorkLink.body!)) body: unknown,
  ) {
    return this.links.adminUpdate(me.userId, p.characterId, p.workLinkId, body);
  }
  @Delete('work-links/:workLinkId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(W.deleteWorkLink.params!))
    p: { characterId: string; workLinkId: string },
  ) {
    await this.links.adminDelete(me.userId, p.characterId, p.workLinkId);
  }
  @Get('voice')
  getVoice(@Param(new ContractPipe(W.getDefaultVoice.params!)) p: { characterId: string }) {
    return this.links.getDefaultVoice(p.characterId);
  }
  @Put('voice')
  setVoice(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(W.setDefaultVoice.params!)) p: { characterId: string },
    @Body(new ContractPipe(W.setDefaultVoice.body!)) body: { voiceId: string | null },
  ) {
    return this.links.setDefaultVoice(me.userId, p.characterId, body.voiceId);
  }
}
