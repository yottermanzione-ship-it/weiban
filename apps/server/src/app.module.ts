/**
 * 装配入口：唯一允许 import 所有模块的地方（repo-structure.md 第 3 节）。
 * 新增业务模块时：先在 packages/eslint-config/architecture.js 登记层级，再把模块类加到 imports。
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import type {
  ContactsReadPort,
  ChatNotificationReadPort,
  CharacterNameReadPort,
} from '@weiban/contracts';
import { ContactsModule, CONTACTS_READ_PORT } from './modules/contacts/index.js';
import { AiRuntimeModule } from './modules/ai-runtime/index.js';
import { BillingModule } from './modules/billing/index.js';
import { ChatModule, CHAT_USER_PORT, CHAT_NOTIFICATION_READ_PORT } from './modules/chat/index.js';
import {
  PushModule,
  PUSH_MODEL_SOURCE,
  PUSH_MESSAGE_SOURCE,
  type PushMessageSource,
} from './modules/push/index.js';
import { RealtimeModule, REALTIME_MESSAGE_SENDER } from './modules/realtime/index.js';
import { IdentityModule } from './modules/identity/index.js';
import {
  CharactersModule,
  CHARACTER_READ_PORT,
  CHARACTER_NAME_READ_PORT,
  CHARACTER_CONTACT_ACCESS,
} from './modules/characters/index.js';
import { PolicyModule } from './modules/policy/index.js';
import { MediaModule } from './modules/media/index.js';
import { ModelAccessModule, MODEL_NOTIFICATION_READ_PORT } from './modules/model-access/index.js';
import { PlatformModule, type PlatformOptions } from './platform/index.js';

@Global()
@Module({ imports: [ModelAccessModule], exports: [ModelAccessModule] })
class GatewayCompositionModule {}

@Global()
@Module({
  imports: [ChatModule],
  providers: [{ provide: REALTIME_MESSAGE_SENDER, useExisting: CHAT_USER_PORT }],
  exports: [ChatModule, REALTIME_MESSAGE_SENDER],
})
class ChatCompositionModule {}

@Global()
@Module({
  imports: [ContactsModule],
  providers: [
    {
      provide: CHARACTER_CONTACT_ACCESS,
      inject: [CONTACTS_READ_PORT],
      useFactory: (contacts: ContactsReadPort) => ({
        hasContact: async (userId: string, characterId: string) =>
          !!(await contacts.getActiveContact(userId, characterId)),
      }),
    },
  ],
  exports: [ContactsModule, CHARACTER_CONTACT_ACCESS],
})
class ContactsCompositionModule {}

@Global()
@Module({
  imports: [ChatModule, CharactersModule, ContactsModule, ModelAccessModule],
  providers: [
    { provide: PUSH_MODEL_SOURCE, useExisting: MODEL_NOTIFICATION_READ_PORT },
    {
      provide: PUSH_MESSAGE_SOURCE,
      inject: [CHAT_NOTIFICATION_READ_PORT, CHARACTER_NAME_READ_PORT, CONTACTS_READ_PORT],
      useFactory: (
        chat: ChatNotificationReadPort,
        characters: CharacterNameReadPort,
        contacts: ContactsReadPort,
      ): PushMessageSource => ({
        current: (userId, messageId, tx) => chat.getNotificationContext(userId, messageId, tx),
        name: async (userId, characterId, tx) => {
          if (!characterId) return '微伴';
          const contact = await contacts.getActiveContact(userId, characterId, tx);
          if (contact?.remark) return contact.remark;
          return (await characters.getDisplayName(userId, characterId, tx)) ?? '微伴';
        },
      }),
    },
  ],
  exports: [PUSH_MESSAGE_SOURCE, PUSH_MODEL_SOURCE],
})
class PushCompositionModule {}

@Module({})
export class AppModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(options),
        IdentityModule,
        RealtimeModule,
        ChatCompositionModule,
        ContactsCompositionModule,
        PushCompositionModule,
        PushModule,
        AiRuntimeModule,
        BillingModule,
        GatewayCompositionModule,
        MediaModule,
        CharactersModule,
        PolicyModule.forRoot({
          imports: [CharactersModule],
          characterReadToken: CHARACTER_READ_PORT,
        }),
      ],
    };
  }
}
