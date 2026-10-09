import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { MediaModule } from '../media/index.js';
import { MODEL_GATEWAY_PORT, WEB_SEARCH_PROVIDER } from '../model-access/index.js';
import { IdentityModule } from '../identity/index.js';
import { PublicUpdateService } from './application/public-updates.js';
import { PublicUpdateAdminController } from './http/public-updates.controller.js';
import { CharacterService } from './application/characters.js';
import { CharacterCheckWorker } from './application/check-worker.js';
import { CustomCharacterService } from './application/custom-character.js';
import { GatewayCharacterEvaluator, EVALUATOR_GATEWAY } from './application/evaluator.js';
import { ScenarioModeService } from './application/scenario-modes.js';
import { CharacterController, CharacterAdminController } from './http/characters.controller.js';
import { CustomCharacterController } from './http/custom-character.controller.js';
import { ScenarioModeAdminController } from './http/scenario-modes.controller.js';
import { PersonaVersionAdminController } from './http/persona-versions.controller.js';
import { RelationAdminController, UserRelationController } from './http/relations.controller.js';
import { CharacterRelationService } from './application/relations.js';
import {
  CHARACTER_READ_PORT,
  CHARACTER_NAME_READ_PORT,
  CHARACTER_EVALUATOR,
  PUBLIC_UPDATE_READ_PORT,
  PUBLIC_UPDATE_WEB_SEARCH,
  CHARACTER_RELATION_READ_PORT,
} from './tokens.js';
@Module({
  imports: [MediaModule, ChatModule, IdentityModule],
  controllers: [
    // CustomCharacterController 必须在 CharacterController 之前：GET /characters/custom 与 /characters/:characterId 同前缀。
    CustomCharacterController,
    CharacterController,
    CharacterAdminController,
    ScenarioModeAdminController,
    PersonaVersionAdminController,
    PublicUpdateAdminController,
    RelationAdminController,
    UserRelationController,
  ],
  providers: [
    CharacterService,
    CharacterCheckWorker,
    CustomCharacterService,
    GatewayCharacterEvaluator,
    ScenarioModeService,
    PublicUpdateService,
    CharacterRelationService,
    { provide: CHARACTER_RELATION_READ_PORT, useExisting: CharacterRelationService },
    { provide: PUBLIC_UPDATE_READ_PORT, useExisting: PublicUpdateService },
    { provide: PUBLIC_UPDATE_WEB_SEARCH, useExisting: WEB_SEARCH_PROVIDER },
    { provide: CHARACTER_READ_PORT, useExisting: CharacterService },
    { provide: CHARACTER_NAME_READ_PORT, useExisting: CharacterService },
    { provide: CHARACTER_EVALUATOR, useExisting: GatewayCharacterEvaluator },
    { provide: EVALUATOR_GATEWAY, useExisting: MODEL_GATEWAY_PORT },
  ],
  exports: [
    CHARACTER_READ_PORT,
    CHARACTER_NAME_READ_PORT,
    PUBLIC_UPDATE_READ_PORT,
    CHARACTER_RELATION_READ_PORT,
  ],
})
export class CharactersModule {}
