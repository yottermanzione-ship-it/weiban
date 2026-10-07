import { Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { PushAdminEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { AdminAlertService } from '../application/admin-alerts.js';
@Controller('api/v1/admin/alerts')
@RequireAuth('admin')
export class AdminAlertsController {
  constructor(@Inject(AdminAlertService) readonly alerts: AdminAlertService) {}
  @Get()
  list(@Query(new ContractPipe(E.listAdminAlerts.query!)) query: unknown) {
    return this.alerts.list(query);
  }
  @Post(':alertId/acknowledge')
  acknowledge(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.acknowledgeAdminAlert.params!)) params: { alertId: string },
  ) {
    return this.alerts.acknowledge(p.userId, params.alertId);
  }
}
