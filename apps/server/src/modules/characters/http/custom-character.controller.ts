/**
 * 用户自定义角色 HTTP 控制器（CHR-07）。
 * 对应 packages/contracts/src/http/characters.ts 中的 UserCustomEndpoints。
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
} from '@nestjs/common';
import { UserCustomEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CustomCharacterService } from '../application/custom-character.js';
import { CharacterTrialService } from '../application/trials.js';

@Controller('api/v1/characters/custom')
@RequireAuth('user')
export class CustomCharacterController {
  constructor(
    @Inject(CustomCharacterService) private readonly service: CustomCharacterService,
    @Inject(CharacterTrialService) private readonly trials: CharacterTrialService,
  ) {}

  @Post('trial')
  @HttpCode(200)
  draftTrial(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.draftTrial.body!)) body: unknown,
  ) {
    return this.trials.draft(p.userId, body as Parameters<CharacterTrialService['draft']>[1]);
  }

  @Delete('trial/:conversationId')
  endTrial(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.endTrial.params!)) params: { conversationId: string },
  ) {
    return this.trials.end(p.userId, params.conversationId);
  }

  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.service.list(p.userId);
  }

  @Post()
  @HttpCode(200)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.create.body!)) body: unknown,
  ) {
    return this.service.create(p.userId, body as Parameters<typeof this.service.create>[1]);
  }

  @Patch(':characterId')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.update.params!)) params: { characterId: string },
    @Body(new ContractPipe(E.update.body!)) body: unknown,
  ) {
    return this.service.update(
      p.userId,
      params.characterId,
      body as Parameters<typeof this.service.update>[2],
    );
  }

  @Post(':characterId/trial')
  @HttpCode(200)
  startTrial(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.startTrial.params!)) params: { characterId: string },
  ) {
    return this.trials.start(p.userId, params.characterId);
  }
}
