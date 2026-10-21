/**
 * 装配入口：唯一允许 import 所有模块的地方（repo-structure.md 第 3 节）。
 * 新增业务模块时：先在 packages/eslint-config/architecture.js 登记层级，再把模块类加到 imports。
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type {
  ChatReadPort,
  ContactsReadPort,
  ChatNotificationReadPort,
  CharacterNameReadPort,
  ModelGatewayMediaPort,
  Tx,
  PersonaUpdateSummarizerPort,
  CardCopywriterPort,
  SyncPort,
  CharacterTrialCleanupPort,
} from '@weiban/contracts';
import {
  ContactsModule,
  CONTACTS_READ_PORT,
  CONTACTS_CHARACTER_STATS,
  type ContactsCharacterStats,
} from './modules/contacts/index.js';
import {
  AiRuntimeModule,
  AI_CALL_AGENT_PORT,
  AI_TRIAL_CLEANUP_PORT,
  AI_IMPORT_ANALYZER,
  AI_PLAZA_PUBLISH_CHECK,
  AI_ACTIVE_HOURS,
  AI_PERSONA_UPDATE_SUMMARIZER,
  AI_CARD_LINE_WRITER,
} from './modules/ai-runtime/index.js';
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
import { IdentityModule, IDENTITY_ACCOUNT_STATUS_PORT } from './modules/identity/index.js';
import {
  CharactersModule,
  CHARACTER_READ_PORT,
  CHARACTER_TRIAL_CLEANUP_PORT,
  CHARACTER_NAME_READ_PORT,
  CHARACTER_CONTACT_ACCESS,
  CHARACTER_REAL_PERSON_NAMES,
  CHARACTER_SUPPLEMENT_PORT,
  CHARACTER_PLAZA_PORT,
  CHARACTER_PLAZA_ORIGIN_STATUS,
  CHARACTER_PERSONA_SUMMARIZER,
  type CharacterPlazaOriginStatus,
} from './modules/characters/index.js';
import { HealthModule } from './modules/health/index.js';
import { PolicyModule, compareClassification } from './modules/policy/index.js';
import {
  MediaModule,
  MEDIA_SYNC,
  MEDIA_ACCOUNT_STATUS,
  type MediaAccountStatus,
  MEDIA_MESSAGE_LOOKUP,
  MEDIA_REAL_PERSON_NAMES,
  type MediaMessageLookup,
  type MediaRealPersonNames,
} from './modules/media/index.js';
import {
  ModelAccessModule,
  MODEL_NOTIFICATION_READ_PORT,
  MODEL_GATEWAY_MEDIA_PORT,
} from './modules/model-access/index.js';
import {
  GrowthModule,
  GROWTH_HOLIDAY_SOURCE,
  GROWTH_CARD_LOOKUP,
  GROWTH_CARD_COPYWRITER,
  GROWTH_CARD_PORT,
  GROWTH_READ_PORT,
} from './modules/growth/index.js';
import { MomentsModule, MOMENTS_READ_PORT } from './modules/moments/index.js';
import {
  LibraryModule,
  LIBRARY_MOMENTS_READ,
  LIBRARY_CARD_LOOKUP,
} from './modules/library/index.js';
import { ImporterModule, IMPORTER_ANALYZER } from './modules/importer/index.js';
import { ProactiveModule, HOLIDAY_EVENT_PORT } from './modules/proactive/index.js';
import {
  CallsModule,
  CALL_AGENT_PORT,
  CALL_SERVICE_STATUS,
  type CallServiceStatus,
} from './modules/calls/index.js';
import {
  PlayModule,
  PLAY_CARD_ISSUER,
  PLAY_ACTIVE_HOURS,
  PLAY_FAMILIARITY,
} from './modules/play/index.js';
import { SupportModule } from './modules/support/index.js';
import {
  PlazaModule,
  PLAZA_CHARACTERS,
  PLAZA_CLASSIFICATION_POLICY,
  PLAZA_ORIGIN_STATUS,
  PLAZA_PRESET_NAMES,
  PLAZA_PUBLISH_CHECK,
  PLAZA_SUPPLEMENT_READ,
  type PlazaClassificationPolicy,
} from './modules/plaza/index.js';
import { PlatformModule, type PlatformOptions } from './platform/index.js';

@Global()
@Module({
  imports: [ModelAccessModule],
  providers: [
    // T-071：通话是否开通 = 语音识别与语音合成都已开通（MED-06 第 11 条；CallAgentPort 未绑定时 calls 仍视为未开通）。
    {
      provide: CALL_SERVICE_STATUS,
      inject: [MODEL_GATEWAY_MEDIA_PORT],
      useFactory: (media: ModelGatewayMediaPort): CallServiceStatus => ({
        isVoiceCallEnabled: async () =>
          (await media.isServiceEnabled('speech_recognition')) &&
          (await media.isServiceEnabled('speech_synthesis')),
      }),
    },
  ],
  exports: [ModelAccessModule, CALL_SERVICE_STATUS],
})
class GatewayCompositionModule {}

/**
 * T-072：calls 的角色一侧（CallAgentPort）由 ai-runtime 实现，calls 不能 import ai-runtime，由这里绑定。
 * T-081：importer 的 ImportAnalyzerPort（截图识别、发言人识别、草稿生成）同样由 ai-runtime 实现、这里绑定。
 * T-089：plaza 的 PlazaPublishCheckPort（发布前隐私片段 + 儿童特征重检）由 ai-runtime 实现、这里绑定；检测失败时 plaza 拒绝发布。
 */
@Global()
@Module({
  imports: [AiRuntimeModule],
  providers: [
    { provide: CALL_AGENT_PORT, useExisting: AI_CALL_AGENT_PORT },
    { provide: IMPORTER_ANALYZER, useExisting: AI_IMPORT_ANALYZER },
    { provide: PLAZA_PUBLISH_CHECK, useExisting: AI_PLAZA_PUBLISH_CHECK },
    // T-096：play 慢信送达时间用 P-06 学到的活跃小时（T-093 交接遗留）。
    { provide: PLAY_ACTIVE_HOURS, useExisting: AI_ACTIVE_HOURS },
  ],
  exports: [CALL_AGENT_PORT, IMPORTER_ANALYZER, PLAZA_PUBLISH_CHECK, PLAY_ACTIVE_HOURS],
})
class CallAgentCompositionModule {}

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
 * media（底层）需要的账号状态、同步更新、消息读取、真人姓名：不能直接 import 上层模块，
 * 由这里绑定。账号状态为必需端口，其余能力保持可选注入。
 */
@Global()
@Module({
  providers: [
    {
      provide: MEDIA_ACCOUNT_STATUS,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef): MediaAccountStatus => ({
        getAccountStatus: (userId, tx) =>
          ref
            .get<MediaAccountStatus>(IDENTITY_ACCOUNT_STATUS_PORT, { strict: false })
            .getAccountStatus(userId, tx),
      }),
    },
    {
      provide: MEDIA_SYNC,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef): Pick<SyncPort, 'appendUpdate'> => ({
        appendUpdate: (tx, userId, update) =>
          ref.get<SyncPort>(SYNC_PORT, { strict: false }).appendUpdate(tx, userId, update),
      }),
    },
    {
      provide: MEDIA_REAL_PERSON_NAMES,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef): MediaRealPersonNames => ({
        listRealPersonNames: () =>
          ref
            .get<MediaRealPersonNames>(CHARACTER_REAL_PERSON_NAMES, { strict: false })
            .listRealPersonNames(),
      }),
    },
    {
      provide: MEDIA_MESSAGE_LOOKUP,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef): MediaMessageLookup => ({
        findMessageMedia: async (userId, conversationId, messageId) => {
          const chat = ref.get<ChatReadPort>(CHAT_READ_PORT, { strict: false });
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
  exports: [MEDIA_SYNC, MEDIA_REAL_PERSON_NAMES, MEDIA_MESSAGE_LOOKUP, MEDIA_ACCOUNT_STATUS],
})
class MediaCompositionModule {}

/** T-076：growth 发节日卡要读节日清单；growth 不能 import proactive（上层白名单），由这里绑定。 */
@Global()
@Module({
  imports: [ProactiveModule],
  providers: [{ provide: GROWTH_HOLIDAY_SOURCE, useExisting: HOLIDAY_EVENT_PORT }],
  exports: [GROWTH_HOLIDAY_SOURCE],
})
class GrowthHolidayCompositionModule {}

/**
 * T-078：library 收藏朋友圈动态、卡片分享图要读 moments 与 growth；library 不能 import 它们（上层白名单），
 * 由这里绑定到 library 自己的令牌。
 */
@Global()
@Module({
  imports: [MomentsModule, GrowthModule],
  providers: [
    { provide: LIBRARY_MOMENTS_READ, useExisting: MOMENTS_READ_PORT },
    { provide: LIBRARY_CARD_LOOKUP, useExisting: GROWTH_CARD_LOOKUP },
  ],
  exports: [LIBRARY_MOMENTS_READ, LIBRARY_CARD_LOOKUP],
})
class LibraryCompositionModule {}

/**
 * T-092 / T-093：play 发瞬间卡（心愿完成、第一次收到回信）要用 growth 的 GrowthCardPort；play 不能 import growth
 * （上层白名单），由这里绑定到 play 自己的令牌。
 */
@Global()
@Module({
  imports: [GrowthModule],
  providers: [
    { provide: PLAY_CARD_ISSUER, useExisting: GROWTH_CARD_PORT },
    // 3.27（H1）：每日一问的恋爱题只给好感度到「恋人」阶段的角色。
    { provide: PLAY_FAMILIARITY, useExisting: GROWTH_READ_PORT },
  ],
  exports: [PLAY_CARD_ISSUER, PLAY_FAMILIARITY],
})
class PlayCompositionModule {}

/**
 * T-087：plaza 只经端口访问 characters / policy / ai-runtime，令牌定义在 plaza，由这里绑定。
 * T-088：PLAZA_CHARACTERS 绑定 characters 的 CharacterPlazaPort；PLAZA_CLASSIFICATION_POLICY 绑定 policy 的
 * compareClassification（「只能更严」的唯一判定处）。PLAZA_PUBLISH_CHECK（PlazaPublishCheckPort）已由 T-089
 * 在 CallAgentCompositionModule 绑定到 ai-runtime；检测失败时发布返回 plaza_check_unavailable，绝不跳过检查。
 */
@Global()
@Module({
  imports: [CharactersModule],
  providers: [
    { provide: PLAZA_PRESET_NAMES, useExisting: CHARACTER_NAME_READ_PORT },
    { provide: PLAZA_SUPPLEMENT_READ, useExisting: CHARACTER_SUPPLEMENT_PORT },
    { provide: PLAZA_CHARACTERS, useExisting: CHARACTER_PLAZA_PORT },
    {
      provide: PLAZA_CLASSIFICATION_POLICY,
      useValue: { compareClassification } satisfies PlazaClassificationPolicy,
    },
  ],
  exports: [
    PLAZA_PRESET_NAMES,
    PLAZA_SUPPLEMENT_READ,
    PLAZA_CHARACTERS,
    PLAZA_CLASSIFICATION_POLICY,
  ],
})
class PlazaCompositionModule {}

/**
 * T-088：characters 的来源标注要读广场状态；characters 不能 import plaza（上层），由这里绑定。
 * plaza 又依赖 characters 的 CharacterPlazaPort，为避免循环注入，这里用到时才从容器取 plaza 的实现。
 */
@Global()
@Module({
  providers: [
    {
      provide: CHARACTER_PLAZA_ORIGIN_STATUS,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef): CharacterPlazaOriginStatus => ({
        originStatus: (userId, characterId, workId) =>
          ref
            .get<CharacterPlazaOriginStatus>(PLAZA_ORIGIN_STATUS, { strict: false })
            .originStatus(userId, characterId, workId),
      }),
    },
  ],
  exports: [CHARACTER_PLAZA_ORIGIN_STATUS],
})
class PlazaOriginCompositionModule {}

/**
 * 契约 3.1（ADR-0028 方案 C）：底层模块的可选 AI 接入点。characters 的人设更新摘要、growth 的卡片文案由 ai-runtime 实现，
 * 绑定 ai-runtime 的真实实现；未生成文案时 characters / growth 按契约自行兜底。
 * 另：IDENTITY_SETTINGS_WRITE_PORT、MODEL_QUOTE_PORT、BILLING_DAILY_SPEND_READ_PORT 已分别由 IdentityModule、
 * ModelAccessModule、BillingModule 导出，ai-runtime 模块已 import 这三个模块，直接注入即可。
 */
@Global()
@Module({
  providers: [
    {
      provide: CHARACTER_PERSONA_SUMMARIZER,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef): PersonaUpdateSummarizerPort => ({
        summarize: (input) =>
          ref
            .get<PersonaUpdateSummarizerPort>(AI_PERSONA_UPDATE_SUMMARIZER, { strict: false })
            .summarize(input),
      }),
    },
    {
      provide: CHARACTER_TRIAL_CLEANUP_PORT,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef): CharacterTrialCleanupPort => ({
        purgeTrial: (tx, input) =>
          ref
            .get<CharacterTrialCleanupPort>(AI_TRIAL_CLEANUP_PORT, { strict: false })
            .purgeTrial(tx, input),
      }),
    },
    {
      provide: GROWTH_CARD_COPYWRITER,
      inject: [ModuleRef],
      useFactory: (ref: ModuleRef): CardCopywriterPort => ({
        writeCardCopy: (input) =>
          ref.get<CardCopywriterPort>(AI_CARD_LINE_WRITER, { strict: false }).writeCardCopy(input),
      }),
    },
  ],
  exports: [CHARACTER_PERSONA_SUMMARIZER, GROWTH_CARD_COPYWRITER, CHARACTER_TRIAL_CLEANUP_PORT],
})
class AiHookCompositionModule {}

@Module({})
export class AppModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(options),
        AiHookCompositionModule,
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
        GrowthHolidayCompositionModule,
        GrowthModule,
        MomentsModule,
        LibraryCompositionModule,
        LibraryModule,
        ImporterModule,
        ProactiveModule,
        CallsModule,
        CallAgentCompositionModule,
        PlazaCompositionModule,
        PlazaModule,
        PlayCompositionModule,
        PlayModule,
        PlazaOriginCompositionModule,
        SupportModule,
      ],
    };
  }
}
