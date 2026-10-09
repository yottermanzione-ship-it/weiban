/**
 * 装配入口：唯一允许 import 所有模块的地方（repo-structure.md 第 3 节）。
 * 新增业务模块时：先在 packages/eslint-config/architecture.js 登记层级，再把模块类加到 imports。
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import type {
  ChatReadPort,
  ContactsReadPort,
  ChatNotificationReadPort,
  CharacterNameReadPort,
  Tx,
} from '@weiban/contracts';
import {
  ContactsModule,
  CONTACTS_READ_PORT,
  CONTACTS_CHARACTER_STATS,
  type ContactsCharacterStats,
} from './modules/contacts/index.js';
import { AiRuntimeModule } from './modules/ai-runtime/index.js';
import { BillingModule } from './modules/billing/index.js';
import {
  ChatModule,
  CHAT_USER_PORT,
  CHAT_NOTIFICATION_READ_PORT,
  CHAT_GROUP_DIRECTORY,
  CHAT_READ_PORT,
  type ChatGroupDirectory,
} from './modules/chat/index.js';
import {
  PushModule,
  PUSH_MODEL_SOURCE,
  PUSH_MESSAGE_SOURCE,
  type PushMessageSource,
} from './modules/push/index.js';
import { RealtimeModule, REALTIME_MESSAGE_SENDER, SYNC_PORT } from './modules/realtime/index.js';
import { IdentityModule } from './modules/identity/index.js';
import {
  CharactersModule,
  CHARACTER_READ_PORT,
  CHARACTER_NAME_READ_PORT,
  CHARACTER_CONTACT_ACCESS,
  CHARACTER_REAL_PERSON_NAMES,
} from './modules/characters/index.js';
import { HealthModule } from './modules/health/index.js';
import { PolicyModule } from './modules/policy/index.js';
import {
  MediaModule,
  MEDIA_SYNC,
  MEDIA_MESSAGE_LOOKUP,
  MEDIA_REAL_PERSON_NAMES,
  type MediaMessageLookup,
} from './modules/media/index.js';
import { ModelAccessModule, MODEL_NOTIFICATION_READ_PORT } from './modules/model-access/index.js';
import { GrowthModule } from './modules/growth/index.js';
import { MomentsModule } from './modules/moments/index.js';
import { ProactiveModule } from './modules/proactive/index.js';
import { CallsModule } from './modules/calls/index.js';
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
      inject: [CONTACTS_READ_PORT, CONTACTS_CHARACTER_STATS],
      useFactory: (contacts: ContactsReadPort, stats: ContactsCharacterStats) => ({
        hasContact: async (userId: string, characterId: string) =>
          !!(await contacts.getActiveContact(userId, characterId)),
        hasAnyContact: (characterId: string) => stats.hasAnyActiveContact(characterId),
      }),
    },
  ],
  exports: [ContactsModule, CHARACTER_CONTACT_ACCESS],
})
class ContactsCompositionModule {}

/** 群聊（T-063）需要的通讯录与名字查询：chat 不能 import contacts / characters，由这里绑定。 */
@Global()
@Module({
  imports: [ContactsModule, CharactersModule],
  providers: [
    {
      provide: CHAT_GROUP_DIRECTORY,
      inject: [CONTACTS_READ_PORT, CHARACTER_NAME_READ_PORT],
      useFactory: (
        contacts: ContactsReadPort,
        characters: CharacterNameReadPort,
      ): ChatGroupDirectory => ({
        isActiveContact: async (userId, characterId, tx) =>
          !!(await contacts.getActiveContact(userId, characterId, tx as Tx | undefined)),
        displayName: async (userId, characterId, tx) => {
          const contact = await contacts.getActiveContact(
            userId,
            characterId,
            tx as Tx | undefined,
          );
          if (contact?.remark) return contact.remark;
          return characters.getDisplayName(userId, characterId, tx as Tx | undefined);
        },
      }),
    },
  ],
  exports: [CHAT_GROUP_DIRECTORY],
})
class ChatGroupDirectoryCompositionModule {}

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

/**
 * media（底层）需要的同步更新、消息读取、真人姓名（T-069）：media 不能 import realtime / chat / characters，
 * 由这里绑定，media 以可选注入使用。
 */
@Global()
@Module({
  imports: [RealtimeModule, ChatModule, CharactersModule],
  providers: [
    { provide: MEDIA_SYNC, useExisting: SYNC_PORT },
    { provide: MEDIA_REAL_PERSON_NAMES, useExisting: CHARACTER_REAL_PERSON_NAMES },
    {
      provide: MEDIA_MESSAGE_LOOKUP,
      inject: [CHAT_READ_PORT],
      useFactory: (chat: ChatReadPort): MediaMessageLookup => ({
        findMessageMedia: async (userId, conversationId, messageId) => {
          const conversation = await chat.getConversation(conversationId);
          if (
            !conversation ||
            !conversation.participants.some((p) => p.kind === 'user' && p.refId === userId)
          )
            return null;
          const message = await chat.getMessage(messageId, ['normal', 'adult']);
          if (!message || message.conversationId !== conversationId || !message.content)
            return null;
          const content = message.content;
          if (content.type === 'image' || content.type === 'sticker')
            return { mediaId: content.mediaId };
          return null;
        },
      }),
    },
  ],
  exports: [MEDIA_SYNC, MEDIA_REAL_PERSON_NAMES, MEDIA_MESSAGE_LOOKUP],
})
class MediaCompositionModule {}

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
        ChatGroupDirectoryCompositionModule,
        MediaCompositionModule,
        PushModule,
        AiRuntimeModule,
        BillingModule,
        GatewayCompositionModule,
        MediaModule,
        CharactersModule,
        HealthModule,
        PolicyModule.forRoot({
          imports: [CharactersModule],
          characterReadToken: CHARACTER_READ_PORT,
        }),
        GrowthModule,
        MomentsModule,
        ProactiveModule,
        CallsModule,
      ],
    };
  }
}
