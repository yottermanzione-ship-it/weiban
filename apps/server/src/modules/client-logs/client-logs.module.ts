import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { ClientLogsService } from './application/client-logs.service.js';
import {
  ClientLogsController,
  ClientLogsAdminController,
  UserClientLogsController,
} from './http/client-logs.controller.js';
import { CLIENT_LOGS_PORT } from './tokens.js';
@Module({
  imports: [IdentityModule],
  controllers: [ClientLogsController, UserClientLogsController, ClientLogsAdminController],
  providers: [ClientLogsService, { provide: CLIENT_LOGS_PORT, useExisting: ClientLogsService }],
  exports: [CLIENT_LOGS_PORT],
})
export class ClientLogsModule {}
