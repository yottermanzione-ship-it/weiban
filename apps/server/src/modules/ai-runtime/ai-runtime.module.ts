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
  ],
  providers: [
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
  exports: [SIMULATION_READ_PORT],
  controllers: [
    GroupCompanionController,
    CompanionSettingsController,
    MemoryController,
    TimelineController,
    MemorySharingController,
  ],
})
export class AiRuntimeModule {}
