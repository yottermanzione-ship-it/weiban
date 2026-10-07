import { Module } from '@nestjs/common';
import { SYNC_PORT } from './tokens.js';
import { SyncService } from './application/sync.js';
import { SocketServer } from './infra/socket-server.js';
import { PresenceService } from './application/presence.js';
import { IdentityModule } from '../identity/index.js';
import { UpdateLogService } from './application/update-log.js';
import { RealtimeLifecycle } from './application/lifecycle.js';
import { SyncController } from './http/sync.controller.js';
@Module({
  imports: [IdentityModule],
  controllers: [SyncController],
  providers: [
    UpdateLogService,
    RealtimeLifecycle,
    PresenceService,
    SocketServer,
    SyncService,
    { provide: SYNC_PORT, useExisting: SyncService },
  ],
  exports: [SYNC_PORT, UpdateLogService],
})
export class RealtimeModule {}
