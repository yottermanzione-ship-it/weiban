import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/index.js';
import { ChatModule } from '../chat/index.js';
import { ContactsModule } from '../contacts/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { CallService } from './application/calls.js';
import { CallStreamServer } from './infra/stream-server.js';
import { CallController } from './http/calls.controller.js';
import { CALL_SESSION_PORT } from './tokens.js';

@Module({
  imports: [BillingModule, ChatModule, ContactsModule, RealtimeModule],
  controllers: [CallController],
  providers: [
    CallService,
    CallStreamServer,
    { provide: CALL_SESSION_PORT, useExisting: CallService },
  ],
  exports: [CALL_SESSION_PORT],
})
export class CallsModule {}
