import { MemoryService } from './application/memory.js';
import { ChatSummaryService } from './application/chat-summary.js';
import { PrivateDigestService } from './application/private-digest.js';
import { ImageCaptionStore } from './application/image-captions.js';
import { ImagePublicSearch } from './application/image-public-search.js';
import {
  MomentSceneryService,
  fetchScenery,
  MOMENT_SCENERY_FETCHER,
} from './application/moment-scenery.js';
import { PetAiService } from './application/pet-ai.js';
import { CardLineService, MomentCardService } from './application/moment-cards.js';
import { MOMENTS_PET_READ_PORT } from './application/moments-ai.js';
import { MemoryController } from './http/memory.controller.js';
import {
  MemoryTierAdminController,
  MemoryTierController,
  MemoryTierPlansController,
} from './http/memory-tier.controller.js';
import { MemoryTierService } from './application/memory-tier.js';
import { BrainContextService } from './application/brain.js';
import { SharedEpisodesService } from './application/shared-episodes.js';
import { ConversationMemoryService } from './application/conversation-memory.js';
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { CharactersModule } from '../characters/index.js';
import { ModelAccessModule } from '../model-access/index.js';
import { ReplyPlanStore } from './application/plan-store.js';
import { ReplyContext } from './application/reply-context.js';
import { ReplyEngine } from './application/reply-engine.js';
import { AdultBoundaryService } from './application/adult-boundary.js';
import { AiRuntimeLifecycle } from './application/lifecycle.js';
import { IdentityModule } from '../identity/index.js';
import { ContactsModule } from '../contacts/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { CompanionSettingsService } from './application/settings.js';
import { CompanionSettingsController } from './http/settings.controller.js';
import { SimulationService, SIMULATION_READ_PORT } from './application/simulation.js';
import { HealthCareService, HEALTH_CARE_FAMILIARITY } from './application/health-care.js';
import {
  GrowthModule,
  GROWTH_PET_READ_PORT,
  GROWTH_SERVICE,
  type GrowthService,
} from '../growth/index.js';
import { ProactiveModule } from '../proactive/index.js';
import { HealthModule } from '../health/index.js';
import { BillingModule } from '../billing/index.js';
import { ProactiveSchedulerService } from './application/proactive-scheduler.js';
import { GroupChatService } from './application/group-chat.js';
import { GroupReplyStore } from './application/group-reply-store.js';
import { GroupCompanionController } from './http/group-companion.controller.js';
import { TimelineListService, TimelineSummaryService } from './application/timeline.js';
import { SocialService } from './application/social.js';
import { MomentsAiService } from './application/moments-ai.js';
import { MemorySharingController } from './http/memory-sharing.controller.js';
import { MomentsModule } from '../moments/index.js';
import { TimelineController } from './http/timeline.controller.js';
import { MediaModule } from '../media/index.js';
import { MediaAiService, AI_USER_QUIET_STATE } from './application/media-ai.js';
import { CallsModule } from '../calls/index.js';
import { QuietStateService } from './application/quiet-state.js';
import { PlayModule } from '../play/index.js';
import { QuietStateController } from './http/quiet-state.controller.js';
import { CharacterImageService } from './application/character-image.js';
import { CallSchedulerService } from './application/call-scheduler.js';
import { CallAgentService } from './application/call-agent.js';
import {
  AI_CALL_AGENT_PORT,
  AI_TRIAL_CLEANUP_PORT,
  AI_USER_QUIET_STATE_PORT,
  AI_IMPORT_ANALYZER,
  AI_PERSONA_UPDATE_SUMMARIZER,
  AI_CARD_LINE_WRITER,
  AI_PLAZA_PUBLISH_CHECK,
  AI_ACTIVE_HOURS,
} from './tokens.js';
import { ActiveHoursService } from './application/active-hours.js';
import { PlayAiService } from './application/play-ai.js';
import { PlayContinuityStore } from './application/play-continuity.js';
import { QuirkService } from './application/quirk-service.js';
import { PlazaPublishCheckService } from './application/plaza-check.js';
import {
  SupplementedCharacterRead,
  AI_CHARACTER_READ,
} from './application/supplemented-character-read.js';
import { ImportAiService } from './application/import-ai.js';
import { PlannerService } from './application/planner.js';
import { PlannerAdminController } from './http/planner-admin.controller.js';
import { EcologySettingsService } from './application/ecology-settings.js';
import { EcologyService } from './application/ecology.js';
import { WeiboSyncService } from './application/weibo.js';
import { WeiboMaterialService, WeiboMediaStore } from './application/weibo-material-service.js';
import { WEIBO_MOMENT_MATERIAL_PORT } from './application/weibo-material.js';
import { EcologyAdminController, EcologyController } from './http/ecology.controller.js';
import {
  SupplementConflictService,
  PersonaUpdateSummaryService,
} from './application/supplement-ai.js';
@Module({
  imports: [
    IdentityModule,
    ContactsModule,
    RealtimeModule,
    ChatModule,
    CharactersModule,
    ModelAccessModule,
    GrowthModule,
    ProactiveModule,
    HealthModule,
    BillingModule,
    MomentsModule,
    MediaModule,
    CallsModule,
    // T-094：读「用户正在专注」（PlayReadPort.getActiveFocus）。
    PlayModule,
  ],
  providers: [
    WeiboSyncService,
    // 微博公开素材的图片链路：采集（只认该帖自己的公开页面）→ 媒体服务转存为平台公共图 → 按用户稳定选图。
    WeiboMediaStore,
    WeiboMaterialService,
    { provide: WEIBO_MOMENT_MATERIAL_PORT, useExisting: WeiboMaterialService },
    { provide: AI_TRIAL_CLEANUP_PORT, useExisting: ReplyPlanStore },
    // T-090：行为规划决策层。
    PlannerService,
    // v5 角色生态 v1（批 C）：设置与闸门、统一循环。
    EcologySettingsService,
    EcologyService,
    // T-081：角色读取补上「我的补充设定」；导入分析；补充设定冲突项；人设更新摘要。
    SupplementedCharacterRead,
    { provide: AI_CHARACTER_READ, useExisting: SupplementedCharacterRead },
    ImportAiService,
    { provide: AI_IMPORT_ANALYZER, useExisting: ImportAiService },
    SupplementConflictService,
    PersonaUpdateSummaryService,
    { provide: AI_PERSONA_UPDATE_SUMMARIZER, useExisting: PersonaUpdateSummaryService },
    // T-089：广场发布前检测（隐私片段 + 儿童特征重检）。
    PlazaPublishCheckService,
    { provide: AI_PLAZA_PUBLISH_CHECK, useExisting: PlazaPublishCheckService },
    // T-082：朋友圈晒宠物读宠物（T-066 预留令牌）；宠物 AI；名场面卡与卡片一句话。
    { provide: MOMENTS_PET_READ_PORT, useExisting: GROWTH_PET_READ_PORT },
    PetAiService,
    CardLineService,
    { provide: AI_CARD_LINE_WRITER, useExisting: CardLineService },
    MomentCardService,
    CompanionSettingsService,
    MemoryService,
    ChatSummaryService,
    // H2：切出私密模式时的干净整理。
    PrivateDigestService,
    // H3：图片描述存档。
    ImageCaptionStore,
    ImagePublicSearch,
    // 朋友圈随机风景图（沿用旧版参数：约 22% 带图，同内容同图）。
    MomentSceneryService,
    { provide: MOMENT_SCENERY_FETCHER, useValue: fetchScenery },
    // v5 批 B：记忆分档。
    BrainContextService,
    SharedEpisodesService,
    ConversationMemoryService,
    MemoryTierService,
    ReplyPlanStore,
    ReplyContext,
    ReplyEngine,
    AdultBoundaryService,
    SimulationService,
    TimelineSummaryService,
    TimelineListService,
    SocialService,
    MomentsAiService,
    MediaAiService,
    // T-072：P-45「不方便」静默的真实提供方。
    QuietStateService,
    { provide: AI_USER_QUIET_STATE, useExisting: QuietStateService },
    { provide: AI_USER_QUIET_STATE_PORT, useExisting: QuietStateService },
    CharacterImageService,
    CallSchedulerService,
    CallAgentService,
    { provide: AI_CALL_AGENT_PORT, useExisting: CallAgentService },
    { provide: SIMULATION_READ_PORT, useExisting: SimulationService },
    HealthCareService,
    ProactiveSchedulerService,
    GroupChatService,
    GroupReplyStore,
    {
      provide: HEALTH_CARE_FAMILIARITY,
      useFactory: (growth: GrowthService) => ({
        getFamiliarityPoints: async (userId: string, characterId: string) =>
          (await growth.getFamiliarity(userId, characterId)).totalPoints,
      }),
      inject: [GROWTH_SERVICE],
    },
    // T-096：玩法里角色怎么说话；给 play 的活跃时段。
    PlayAiService,
    PlayContinuityStore,
    QuirkService,
    ActiveHoursService,
    { provide: AI_ACTIVE_HOURS, useExisting: ActiveHoursService },
    AiRuntimeLifecycle,
  ],
  exports: [
    AI_TRIAL_CLEANUP_PORT,
    SIMULATION_READ_PORT,
    AI_CALL_AGENT_PORT,
    AI_USER_QUIET_STATE_PORT,
    AI_IMPORT_ANALYZER,
    AI_PERSONA_UPDATE_SUMMARIZER,
    AI_CARD_LINE_WRITER,
    AI_PLAZA_PUBLISH_CHECK,
    AI_ACTIVE_HOURS,
  ],
  controllers: [
    GroupCompanionController,
    CompanionSettingsController,
    MemoryController,
    TimelineController,
    MemorySharingController,
    QuietStateController,
    PlannerAdminController,
    EcologyController,
    EcologyAdminController,
    MemoryTierController,
    MemoryTierAdminController,
    MemoryTierPlansController,
  ],
})
export class AiRuntimeModule {}
