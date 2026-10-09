import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { ContactsModule } from '../contacts/index.js';
import { HEALTH_READ_PORT } from './tokens.js';
import { HealthStore } from './application/store.js';
import { HealthService } from './application/health.service.js';
import { HealthLifecycle } from './application/lifecycle.js';
import { HealthController } from './http/health.controller.js';

@Module({
  imports: [IdentityModule, ContactsModule],
  controllers: [HealthController],
  providers: [
    HealthStore,
    HealthService,
    HealthLifecycle,
    { provide: HEALTH_READ_PORT, useExisting: HealthService },
  ],
  exports: [HEALTH_READ_PORT],
})
export class HealthModule {}
