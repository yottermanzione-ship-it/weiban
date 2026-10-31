/**
 * 小V同学官方身份的 HTTP 接口（契约 http/official-assistant.ts）。
 * 用户端：服务号资料、合成联系人、补齐会话；管理端：公告群发。
 * 开关关掉时用户端接口返回 404（入口消失）、管理端群发返回 409，数据不删。
 */
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  OfficialAssistantAdminEndpoints,
  type OfficialBroadcastRequest,
  type OfficialContact,
  type OfficialProfile,
} from '@weiban/contracts';
import {
  AppError,
  APP_CONFIG,
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AppConfig,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { OfficialBroadcastService } from '../application/broadcast.js';
import { OfficialAssistantEngine } from '../application/engine.js';

@Controller('api/v1/official-assistant')
@RequireAuth('user')
export class OfficialAssistantController {
  constructor(
    @Inject(OfficialAssistantEngine) private readonly engine: OfficialAssistantEngine,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private requireEnabled(): void {
    if (!this.config.officialAssistant.enabled) throw new AppError('not_found', '官方客服未开启');
  }

  @Get('profile')
  getProfile(): OfficialProfile {
    this.requireEnabled();
    return this.engine.getProfile();
  }

  @Get('contact')
  getContact(@CurrentPrincipal() p: AuthPrincipal): Promise<OfficialContact> {
    this.requireEnabled();
    return this.engine.getContact(p.userId);
  }

  @Post('conversation')
  @HttpCode(200)
  async ensureConversation(
    @CurrentPrincipal() p: AuthPrincipal,
  ): Promise<{ conversationId: string }> {
    this.requireEnabled();
    const conversation = await this.engine.ensureConversation(p.userId);
    return { conversationId: conversation.conversationId };
  }
}

@Controller('api/v1/admin/official-assistant')
@RequireAuth('admin')
export class OfficialAssistantAdminController {
  constructor(
    @Inject(OfficialBroadcastService)
    private readonly broadcastService: OfficialBroadcastService,
  ) {}

  @Post('broadcast')
  @HttpCode(200)
  async broadcast(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(OfficialAssistantAdminEndpoints.broadcast.body!))
    body: OfficialBroadcastRequest,
  ) {
    return this.broadcastService.broadcast(p.userId, body);
  }
}
