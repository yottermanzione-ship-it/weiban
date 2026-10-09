import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { ChatModule } from '../chat/index.js';
import { CharactersModule } from '../characters/index.js';
import { MediaModule } from '../media/index.js';
import { RealtimeModule } from '../realtime/index.js';
import {
  CONTACTS_READ_PORT,
  CONTACTS_CHARACTER_STATS,
  CONTACT_CARD_RECOMMENDATION_PORT,
} from './tokens.js';
import { ContactCardRecommendationService } from './application/recommendations.js';
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
    ContactCardRecommendationService,
    { provide: CONTACT_CARD_RECOMMENDATION_PORT, useExisting: ContactCardRecommendationService },
    { provide: CONTACTS_READ_PORT, useExisting: ContactsReadService },
    { provide: CONTACTS_CHARACTER_STATS, useExisting: ContactsReadService },
  ],
  exports: [CONTACTS_READ_PORT, CONTACTS_CHARACTER_STATS, CONTACT_CARD_RECOMMENDATION_PORT],
})
export class ContactsModule {}
