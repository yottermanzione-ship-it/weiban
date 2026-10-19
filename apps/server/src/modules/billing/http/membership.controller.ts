/**
 * 3.17（会员 v5）：PRO+ 价格 / 开通订单 / 会员配置接口，对应契约 MembershipOfferEndpoints / MembershipOrderAdminEndpoints。
 * 实现在 billing（订单要与发赠送积分同一事务）；会员到期时间仍归 identity（经 IdentityMembershipWritePort）。
 */
import { Body, Controller, Get, Inject, Post, Put, Query } from '@nestjs/common';
import {
  MembershipOfferEndpoints as E,
  MembershipOrderAdminEndpoints as A,
  type CreateMembershipOrder,
  type MembershipSettings,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { MembershipOrderService } from '../application/membership-orders.js';

@Controller('api/v1')
export class MembershipOfferController {
  constructor(@Inject(MembershipOrderService) private readonly service: MembershipOrderService) {}

  @Get('me/membership/offer')
  @RequireAuth(E.getOffer.auth)
  offer(@CurrentPrincipal() me: AuthPrincipal) {
    return this.service.offer(me.userId);
  }
}

@Controller('api/v1/admin/membership')
export class MembershipAdminController {
  constructor(@Inject(MembershipOrderService) private readonly service: MembershipOrderService) {}

  @Get('settings')
  @RequireAuth(A.getSettings.auth)
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings')
  @RequireAuth(A.updateSettings.auth)
  updateSettings(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(A.updateSettings.body!)) body: MembershipSettings,
  ) {
    return this.service.updateSettings(me.userId, body);
  }

  @Get('orders')
  @RequireAuth(A.listOrders.auth)
  listOrders(
    @Query(new ContractPipe(A.listOrders.query!))
    query: z.output<NonNullable<typeof A.listOrders.query>>,
  ) {
    return this.service.listOrders(query);
  }

  @Post('orders')
  @RequireAuth(A.createOrder.auth)
  createOrder(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(A.createOrder.body!)) body: z.output<typeof CreateMembershipOrder>,
  ) {
    return this.service.createOrder(me.userId, body);
  }
}
