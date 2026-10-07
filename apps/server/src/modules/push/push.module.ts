import { Module } from '@nestjs/common';
import { PUSH_PORT, PushService } from './application/push.js';
import { IdentityModule } from '../identity/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { PushRequestStore } from './application/request-store.js';
import { PushDeliveryEngine } from './application/delivery-engine.js';
import { PushLifecycle } from './application/lifecycle.js';
import { PushDeviceService } from './application/devices.js';
import { PushDevicesController } from './http/devices.controller.js';
import { AdminAlertsController } from './http/admin-alerts.controller.js';
import { AdminAlertService } from './application/admin-alerts.js';
import { PUSH_CHANNELS, PushChannels } from './infra/channels.js';
import { PUSH_HTTP, PushHttpTransport } from './infra/http-transport.js';
@Module({
  imports: [IdentityModule, RealtimeModule],
  exports: [PUSH_PORT],
  providers: [
    PushService,
    { provide: PUSH_PORT, useExisting: PushService },
    PushDeviceService,
    PushRequestStore,
    PushDeliveryEngine,
    PushLifecycle,
    AdminAlertService,
    PushChannels,
    PushHttpTransport,
    { provide: PUSH_HTTP, useExisting: PushHttpTransport },
    { provide: PUSH_CHANNELS, useExisting: PushChannels },
  ],
  controllers: [PushDevicesController, AdminAlertsController],
})
export class PushModule {}
