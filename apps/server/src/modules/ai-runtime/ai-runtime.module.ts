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
import { TimelineSummaryService } from './application/timeline.js';
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
  ],
  providers: [
    CompanionSettingsService,
    MemoryService,
    ReplyPlanStore,
    ReplyContext,
    ReplyEngine,
    SimulationService,
    TimelineSummaryService,
    { provide: SIMULATION_READ_PORT, useExisting: SimulationService },
    HealthCareService,
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
  controllers: [CompanionSettingsController, MemoryController, TimelineController],
})
export class AiRuntimeModule {}
