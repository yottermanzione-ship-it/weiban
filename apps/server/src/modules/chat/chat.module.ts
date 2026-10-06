import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { ChatAdminService } from './application/admin.js';
import { ChatParticipantService } from './application/participant.js';
import { ChatReadService } from './application/read.js';
import { ChatUserService } from './application/user.js';
import { ChatWriteService } from './application/write.js';
import { ChatStore } from './application/store.js';
import { ChatLifecycle } from './application/lifecycle.js';
import { ChatController } from './http/chat.controller.js';
import {
  CHAT_ADMIN_PORT,
  CHAT_PARTICIPANT_PORT,
  CHAT_READ_PORT,
  CHAT_USER_PORT,
} from './tokens.js';
@Module({
  imports: [IdentityModule, RealtimeModule],
  controllers: [ChatController],
  providers: [
    ChatAdminService,
    ChatParticipantService,
    ChatReadService,
    ChatUserService,
    ChatWriteService,
    ChatStore,
    ChatLifecycle,
    { provide: CHAT_ADMIN_PORT, useExisting: ChatAdminService },
    { provide: CHAT_PARTICIPANT_PORT, useExisting: ChatParticipantService },
    { provide: CHAT_READ_PORT, useExisting: ChatReadService },
    { provide: CHAT_USER_PORT, useExisting: ChatUserService },
  ],
  exports: [CHAT_ADMIN_PORT, CHAT_PARTICIPANT_PORT, CHAT_READ_PORT, CHAT_USER_PORT],
})
export class ChatModule {}
