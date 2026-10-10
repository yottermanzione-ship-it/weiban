import { MemoryService } from './application/memory.js';
import { MemoryController } from './http/memory.controller.js';
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { CharactersModule } from '../characters/index.js';
import { ModelAccessModule } from '../model-access/index.js';
import { ReplyPlanStore } from './application/plan-store.js';
import { ReplyContext } from './application/reply-context.js';
import { ReplyEngine } from './application/reply-engine.js';
import { AiRuntimeLifecycle } from './application/lifecycle.js';
import { IdentityModule } from '../identity/index.js';
import { ContactsModule } from '../contacts/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { CompanionSettingsService } from './application/settings.js';
import { CompanionSettingsController } from './http/settings.controller.js';
import { SimulationService, SIMULATION_READ_PORT } from './application/simulation.js';
import { HealthCareService, HEALTH_CARE_FAMILIARITY } from './application/health-care.js';
import { GrowthModule, GROWTH_SERVICE, type GrowthService } from '../growth/index.js';
import { ProactiveModule } from '../proactive/index.js';
import { HealthModule } from '../health/index.js';
import { BillingModule } from '../billing/index.js';
import { ProactiveSchedulerService } from './application/proactive-scheduler.js';
import { GroupChatService } from './application/group-chat.js';
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
import { QuietStateController } from './http/quiet-state.controller.js';
import { CharacterImageService } from './application/character-image.js';
import { CallSchedulerService } from './application/call-scheduler.js';
import { CallAgentService } from './application/call-agent.js';
import {
  AI_CALL_AGENT_PORT,
  AI_USER_QUIET_STATE_PORT,
  AI_IMPORT_ANALYZER,
  AI_PERSONA_UPDATE_SUMMARIZER,
} from './tokens.js';
import {
  SupplementedCharacterRead,
  AI_CHARACTER_READ,
} from './application/supplemented-character-read.js';
import { ImportAiService } from './application/import-ai.js';
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
  ],
  providers: [
    // T-081：角色读取补上「我的补充设定」；导入分析；补充设定冲突项；人设更新摘要。
    SupplementedCharacterRead,
    { provide: AI_CHARACTER_READ, useExisting: SupplementedCharacterRead },
    ImportAiService,
    { provide: AI_IMPORT_ANALYZER, useExisting: ImportAiService },
    SupplementConflictService,
    PersonaUpdateSummaryService,
    { provide: AI_PERSONA_UPDATE_SUMMARIZER, useExisting: PersonaUpdateSummaryService },
    CompanionSettingsService,
    MemoryService,
    ReplyPlanStore,
    ReplyContext,
    ReplyEngine,
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
    {
      provide: HEALTH_CARE_FAMILIARITY,
      useFactory: (growth: GrowthService) => ({
        getFamiliarityPoints: async (userId: string, characterId: string) =>
          (await growth.getFamiliarity(userId, characterId)).totalPoints,
      }),
      inject: [GROWTH_SERVICE],
    },
    AiRuntimeLifecycle,
  ],
  exports: [
    SIMULATION_READ_PORT,
    AI_CALL_AGENT_PORT,
    AI_USER_QUIET_STATE_PORT,
    AI_IMPORT_ANALYZER,
    AI_PERSONA_UPDATE_SUMMARIZER,
  ],
  controllers: [
    GroupCompanionController,
    CompanionSettingsController,
    MemoryController,
    TimelineController,
    MemorySharingController,
    QuietStateController,
  ],
})
export class AiRuntimeModule {}
