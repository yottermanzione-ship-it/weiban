import { Module } from '@nestjs/common';
import { MediaModule } from '../media/index.js';
import { MODEL_GATEWAY_PORT } from '../model-access/index.js';
import { CharacterService } from './application/characters.js';
import { CharacterCheckWorker } from './application/check-worker.js';
import { GatewayCharacterEvaluator, EVALUATOR_GATEWAY } from './application/evaluator.js';
import { CharacterController, CharacterAdminController } from './http/characters.controller.js';
import { CHARACTER_READ_PORT, CHARACTER_NAME_READ_PORT, CHARACTER_EVALUATOR } from './tokens.js';
@Module({
  imports: [MediaModule],
  controllers: [CharacterController, CharacterAdminController],
  providers: [
    CharacterService,
    CharacterCheckWorker,
    GatewayCharacterEvaluator,
    { provide: CHARACTER_READ_PORT, useExisting: CharacterService },
    { provide: CHARACTER_NAME_READ_PORT, useExisting: CharacterService },
    { provide: CHARACTER_EVALUATOR, useExisting: GatewayCharacterEvaluator },
    { provide: EVALUATOR_GATEWAY, useExisting: MODEL_GATEWAY_PORT },
  ],
  exports: [CHARACTER_READ_PORT, CHARACTER_NAME_READ_PORT],
})
export class CharactersModule {}
