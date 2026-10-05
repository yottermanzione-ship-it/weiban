import { Module } from '@nestjs/common';
import { MediaModule } from '../media/index.js';
import { MODEL_GATEWAY_PORT } from '../model-access/index.js';
import { CharacterService } from './application/characters.js';
import { CharacterCheckWorker } from './application/check-worker.js';
import { GatewayCharacterEvaluator, EVALUATOR_GATEWAY } from './application/evaluator.js';
import { CharacterController, CharacterAdminController } from './http/characters.controller.js';
import { CHARACTER_READ_PORT, CHARACTER_EVALUATOR, CHARACTER_CONTACT_ACCESS } from './tokens.js';
@Module({
  imports: [MediaModule],
  controllers: [CharacterController, CharacterAdminController],
  providers: [
    CharacterService,
    CharacterCheckWorker,
    GatewayCharacterEvaluator,
    { provide: CHARACTER_READ_PORT, useExisting: CharacterService },
    { provide: CHARACTER_EVALUATOR, useExisting: GatewayCharacterEvaluator },
    { provide: EVALUATOR_GATEWAY, useExisting: MODEL_GATEWAY_PORT },
    // contacts 在L1接入；L0没有添加关系，不放行下架角色。
    { provide: CHARACTER_CONTACT_ACCESS, useValue: { hasContact: async () => false } },
  ],
  exports: [CHARACTER_READ_PORT],
})
export class CharactersModule {}
