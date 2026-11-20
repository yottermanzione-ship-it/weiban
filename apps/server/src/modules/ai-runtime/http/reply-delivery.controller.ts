import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ReplyDeliveryEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ReplyDeliveryStatusService } from '../application/reply-delivery-status.js';

@Controller('api/v1/conversations/:conversationId')
@RequireAuth('user')
export class ReplyDeliveryController {
  constructor(
    @Inject(ReplyDeliveryStatusService) private readonly delivery: ReplyDeliveryStatusService,
  ) {}
  @Post('reply-statuses')
  @HttpCode(200)
  statuses(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.statuses.params!)) params: { conversationId: string },
    @Body(new ContractPipe(E.statuses.body!)) body: { messageIds: string[] },
  ) {
    return this.delivery.list(p.userId, params.conversationId, body.messageIds);
  }
  @Post('messages/:messageId/retry-reply')
  @HttpCode(200)
  retry(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.retry.params!)) params: { conversationId: string; messageId: string },
    @Body(new ContractPipe(E.retry.body!)) body: { epoch: number },
  ) {
    return this.delivery.retry(p.userId, params.conversationId, params.messageId, body.epoch);
  }
}
