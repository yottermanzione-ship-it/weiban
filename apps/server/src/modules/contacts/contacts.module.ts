import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { ChatModule } from '../chat/index.js';
import { CharactersModule } from '../characters/index.js';
import { MediaModule } from '../media/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { CONTACTS_READ_PORT } from './tokens.js';
import { ContactsCommands } from './application/commands.js';
import { ContactsReadService } from './application/read.js';
import { ContactsLifecycle } from './application/lifecycle.js';
import { ContactsController } from './http/contacts.controller.js';
@Module({
  imports: [IdentityModule, ChatModule, CharactersModule, MediaModule, RealtimeModule],
  controllers: [ContactsController],
  providers: [
    ContactsCommands,
    ContactsReadService,
    ContactsLifecycle,
    { provide: CONTACTS_READ_PORT, useExisting: ContactsReadService },
  ],
  exports: [CONTACTS_READ_PORT],
})
export class ContactsModule {}
