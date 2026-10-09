/**
 * 通话信令 HTTP（CallEndpoints，契约 http/calls.ts）。任何响应都不含费用信息（MED-06 第 10 条）。
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { CallEndpoints as C } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CallService } from '../application/calls.js';

const params = new ContractPipe(C.getCall.params!);

@Controller('api/v1/calls')
@RequireAuth('user')
export class CallController {
  constructor(@Inject(CallService) private readonly calls: CallService) {}
  @Get('availability')
  availability(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(C.getAvailability.query!)) q: { characterId: string },
  ) {
    return this.calls.availability(me.userId, q.characterId);
  }
  @Get('active')
  async active(@CurrentPrincipal() me: AuthPrincipal) {
    return { call: await this.calls.getActiveCall(me.userId) };
  }
  @Post()
  @HttpCode(201)
  start(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(C.startCall.body!))
    body: { characterId: string; clientRequestId: string },
  ) {
    return this.calls.startCall(me.userId, body);
  }
  @Get(':callId')
  get(@CurrentPrincipal() me: AuthPrincipal, @Param(params) p: { callId: string }) {
    return this.calls.getCall(me.userId, p.callId);
  }
  @Post(':callId/answer')
  @HttpCode(200)
  answer(@CurrentPrincipal() me: AuthPrincipal, @Param(params) p: { callId: string }) {
    return this.calls.answerCall(me.userId, p.callId);
  }
  @Post(':callId/decline')
  @HttpCode(200)
  decline(@CurrentPrincipal() me: AuthPrincipal, @Param(params) p: { callId: string }) {
    return this.calls.declineCall(me.userId, p.callId);
  }
  @Post(':callId/hangup')
  @HttpCode(200)
  hangUp(@CurrentPrincipal() me: AuthPrincipal, @Param(params) p: { callId: string }) {
    return this.calls.hangUp(me.userId, p.callId);
  }
  @Post(':callId/stream-ticket')
  @HttpCode(200)
  ticket(@CurrentPrincipal() me: AuthPrincipal, @Param(params) p: { callId: string }) {
    return this.calls.renewTicket(me.userId, p.callId);
  }
}
