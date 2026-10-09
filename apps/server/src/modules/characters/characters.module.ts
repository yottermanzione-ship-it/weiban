import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { MediaModule } from '../media/index.js';
import { MODEL_GATEWAY_PORT } from '../model-access/index.js';
import { CharacterService } from './application/characters.js';
import { CharacterCheckWorker } from './application/check-worker.js';
import { CustomCharacterService } from './application/custom-character.js';
import { GatewayCharacterEvaluator, EVALUATOR_GATEWAY } from './application/evaluator.js';
import { ScenarioModeService } from './application/scenario-modes.js';
import { CharacterController, CharacterAdminController } from './http/characters.controller.js';
import { CustomCharacterController } from './http/custom-character.controller.js';
import { ScenarioModeAdminController } from './http/scenario-modes.controller.js';
import { PersonaVersionAdminController } from './http/persona-versions.controller.js';
import { CHARACTER_READ_PORT, CHARACTER_NAME_READ_PORT, CHARACTER_EVALUATOR } from './tokens.js';
@Module({
  imports: [MediaModule, ChatModule],
  controllers: [
    CharacterController,
    CharacterAdminController,
    CustomCharacterController,
    ScenarioModeAdminController,
    PersonaVersionAdminController,
  ],
  providers: [
    CharacterService,
    CharacterCheckWorker,
    CustomCharacterService,
    GatewayCharacterEvaluator,
    ScenarioModeService,
    { provide: CHARACTER_READ_PORT, useExisting: CharacterService },
    { provide: CHARACTER_NAME_READ_PORT, useExisting: CharacterService },
    { provide: CHARACTER_EVALUATOR, useExisting: GatewayCharacterEvaluator },
    { provide: EVALUATOR_GATEWAY, useExisting: MODEL_GATEWAY_PORT },
  ],
  exports: [CHARACTER_READ_PORT, CHARACTER_NAME_READ_PORT],
})
export class CharactersModule {}
