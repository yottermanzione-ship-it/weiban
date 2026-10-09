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
@Module({
  imports: [
    IdentityModule,
    ContactsModule,
    RealtimeModule,
    ChatModule,
    CharactersModule,
    ModelAccessModule,
  ],
  providers: [
    CompanionSettingsService,
    MemoryService,
    ReplyPlanStore,
    ReplyContext,
    ReplyEngine,
    SimulationService,
    { provide: SIMULATION_READ_PORT, useExisting: SimulationService },
    AiRuntimeLifecycle,
  ],
  exports: [SIMULATION_READ_PORT],
  controllers: [CompanionSettingsController, MemoryController],
})
export class AiRuntimeModule {}
