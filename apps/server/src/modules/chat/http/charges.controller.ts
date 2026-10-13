import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ChatEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ChatChargeService } from '../application/charges.js';

/** v3.3：POST /api/v1/messages/by-usage（契约 ChatEndpoints.listChargedMessages）。 */
@Controller('api/v1/messages')
@RequireAuth('user')
export class ChatChargeController {
  constructor(@Inject(ChatChargeService) private readonly charges: ChatChargeService) {}
  @Post('by-usage')
  @HttpCode(200)
  byUsage(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.listChargedMessages.body!)) body: { usageRecordIds: string[] },
  ) {
    return this.charges.byUsage(p.userId, body.usageRecordIds);
  }
}
