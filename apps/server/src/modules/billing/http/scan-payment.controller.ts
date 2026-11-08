import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  ScanPaymentEndpoints as E,
  ScanPaymentAdminEndpoints as A,
  ScanMonitorEndpoints as M,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ScanPaymentService } from '../application/scan-payments.js';
type Out<T extends z.ZodType | undefined> = z.output<NonNullable<T>>;
@Controller('api/v1/billing/scan')
export class ScanPaymentController {
  constructor(@Inject(ScanPaymentService) private readonly service: ScanPaymentService) {}
  @Get('options')
  @RequireAuth(E.options.auth)
  options() {
    return this.service.options();
  }
  @Post('orders')
  @RequireAuth(E.create.auth)
  create(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(E.create.body!)) body: Out<typeof E.create.body>,
  ) {
    return this.service.create(me.userId, body);
  }
  @Get('orders')
  @RequireAuth(E.list.auth)
  list(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(E.list.query!)) query: Out<typeof E.list.query>,
  ) {
    return this.service.list(me.userId, query);
  }
  @Get('orders/:orderId')
  @RequireAuth(E.get.auth)
  get(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(E.get.params!)) params: Out<typeof E.get.params>,
  ) {
    return this.service.get(me.userId, params.orderId);
  }
  @Post('orders/:orderId/cancel')
  @RequireAuth(E.cancel.auth)
  cancel(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(E.cancel.params!)) params: Out<typeof E.cancel.params>,
  ) {
    return this.service.get(me.userId, params.orderId, true);
  }
  @Post('monitor/pair')
  @RequireAuth(M.pair.auth)
  pair(@Body(new ContractPipe(M.pair.body!)) body: Out<typeof M.pair.body>) {
    return this.service.pair(body);
  }
  @Post('monitor/report')
  @RequireAuth(M.report.auth)
  report(@Body(new ContractPipe(M.report.body!)) body: Out<typeof M.report.body>) {
    return this.service.report(body);
  }
}
@Controller('api/v1/admin/scan-payments')
export class ScanPaymentAdminController {
  constructor(@Inject(ScanPaymentService) private readonly service: ScanPaymentService) {}
  @Post('manual-receipts')
  @RequireAuth(A.manualReceipt.auth)
  manualReceipt(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(A.manualReceipt.body!)) body: Out<typeof A.manualReceipt.body>,
  ) {
    return this.service.manualReceipt(me.userId, body);
  }
  @Get('settings')
  @RequireAuth(A.settings.auth)
  settings() {
    return this.service.settings();
  }
  @Put('settings')
  @RequireAuth(A.saveSettings.auth)
  saveSettings(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(A.saveSettings.body!)) body: Out<typeof A.saveSettings.body>,
  ) {
    return this.service.saveSettings(me.userId, body);
  }
  @Get('orders')
  @RequireAuth(A.orders.auth)
  orders(@Query(new ContractPipe(A.orders.query!)) query: Out<typeof A.orders.query>) {
    return this.service.list(null, query);
  }
  @Get('receipts')
  @RequireAuth(A.receipts.auth)
  receipts(@Query(new ContractPipe(A.receipts.query!)) query: Out<typeof A.receipts.query>) {
    return this.service.receipts(query);
  }
  @Post('receipts/:receiptId/resolve')
  @RequireAuth(A.resolve.auth)
  resolve(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.resolve.params!)) params: Out<typeof A.resolve.params>,
    @Body(new ContractPipe(A.resolve.body!)) body: Out<typeof A.resolve.body>,
  ) {
    return this.service.resolve(me.userId, params.receiptId, body.orderId, body.reason);
  }
  @Get('devices')
  @RequireAuth(A.devices.auth)
  devices() {
    return this.service.devices();
  }
  @Post('devices')
  @RequireAuth(A.pairCode.auth)
  pairCode(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(A.pairCode.body!)) body: Out<typeof A.pairCode.body>,
  ) {
    return this.service.pairCode(me.userId, body.name);
  }
  @Put('devices/:deviceId')
  @RequireAuth(A.activate.auth)
  activate(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.activate.params!)) params: Out<typeof A.activate.params>,
    @Body(new ContractPipe(A.activate.body!)) body: Out<typeof A.activate.body>,
  ) {
    return this.service.activate(me.userId, params.deviceId, body.active);
  }
}
