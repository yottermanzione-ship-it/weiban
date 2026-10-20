import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { MediaModule } from '../media/index.js';
import { MODEL_GATEWAY_PORT, WEB_SEARCH_PROVIDER } from '../model-access/index.js';
import { IdentityModule } from '../identity/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { PublicUpdateService } from './application/public-updates.js';
import { PublicUpdateAdminController } from './http/public-updates.controller.js';
import { CharacterService } from './application/characters.js';
import { CharacterEligibilityService } from './application/eligibility.js';
import { CharacterCheckWorker } from './application/check-worker.js';
import { CustomCharacterService } from './application/custom-character.js';
import { CharacterTrialService } from './application/trials.js';
import { GatewayCharacterEvaluator, EVALUATOR_GATEWAY } from './application/evaluator.js';
import { ScenarioModeService } from './application/scenario-modes.js';
import { CharacterController, CharacterAdminController } from './http/characters.controller.js';
import { CustomCharacterController } from './http/custom-character.controller.js';
import { CustomCharacterOriginController } from './http/custom-origin.controller.js';
import { CharacterPlazaService } from './application/plaza-port.js';
import { ScenarioModeAdminController } from './http/scenario-modes.controller.js';
import { PersonaVersionAdminController } from './http/persona-versions.controller.js';
import { RelationAdminController, UserRelationController } from './http/relations.controller.js';
import { CharacterRelationService } from './application/relations.js';
import { CharacterWorkLinkService } from './application/work-links.js';
import { WorkLinkAdminController } from './http/work-links.controller.js';
import { CharacterSupplementService } from './application/supplements.js';
import { CharacterSupplementController } from './http/supplements.controller.js';
import {
  CHARACTER_READ_PORT,
  CHARACTER_TRIAL_READ_PORT,
  CHARACTER_NAME_READ_PORT,
  CHARACTER_EVALUATOR,
  PUBLIC_UPDATE_READ_PORT,
  PUBLIC_UPDATE_WEB_SEARCH,
  CHARACTER_RELATION_READ_PORT,
  CHARACTER_WORK_LINK_READ_PORT,
  CHARACTER_VOICE_READ_PORT,
  CHARACTER_REAL_PERSON_NAMES,
  CHARACTER_SUPPLEMENT_PORT,
  CHARACTER_SUPPLEMENT_CONFLICTS,
  CHARACTER_PLAZA_PORT,
  CHARACTER_CHILD_FEATURES_WRITER,
} from './tokens.js';
@Module({
  imports: [MediaModule, ChatModule, IdentityModule, RealtimeModule],
  controllers: [
    // CustomCharacterController 必须在 CharacterController 之前：GET /characters/custom 与 /characters/:characterId 同前缀。
    CustomCharacterController,
    CustomCharacterOriginController,
    CharacterSupplementController,
    CharacterController,
    CharacterAdminController,
    ScenarioModeAdminController,
    PersonaVersionAdminController,
    PublicUpdateAdminController,
    RelationAdminController,
    UserRelationController,
    WorkLinkAdminController,
  ],
  providers: [
    CharacterSupplementService,
    { provide: CHARACTER_SUPPLEMENT_PORT, useExisting: CharacterSupplementService },
    { provide: CHARACTER_SUPPLEMENT_CONFLICTS, useExisting: CharacterSupplementService },
    CharacterService,
    CharacterEligibilityService,
    CharacterCheckWorker,
    CustomCharacterService,
    CharacterTrialService,
    { provide: CHARACTER_TRIAL_READ_PORT, useExisting: CharacterTrialService },
    CharacterPlazaService,
    { provide: CHARACTER_PLAZA_PORT, useExisting: CharacterPlazaService },
    { provide: CHARACTER_CHILD_FEATURES_WRITER, useExisting: CharacterPlazaService },
    GatewayCharacterEvaluator,
    ScenarioModeService,
    PublicUpdateService,
    CharacterRelationService,
    CharacterWorkLinkService,
    { provide: CHARACTER_WORK_LINK_READ_PORT, useExisting: CharacterWorkLinkService },
    { provide: CHARACTER_VOICE_READ_PORT, useExisting: CharacterWorkLinkService },
    { provide: CHARACTER_REAL_PERSON_NAMES, useExisting: CharacterWorkLinkService },
    { provide: CHARACTER_RELATION_READ_PORT, useExisting: CharacterRelationService },
    { provide: PUBLIC_UPDATE_READ_PORT, useExisting: PublicUpdateService },
    { provide: PUBLIC_UPDATE_WEB_SEARCH, useExisting: WEB_SEARCH_PROVIDER },
    { provide: CHARACTER_READ_PORT, useExisting: CharacterService },
    { provide: CHARACTER_NAME_READ_PORT, useExisting: CharacterService },
    { provide: CHARACTER_EVALUATOR, useExisting: GatewayCharacterEvaluator },
    { provide: EVALUATOR_GATEWAY, useExisting: MODEL_GATEWAY_PORT },
  ],
  exports: [
    CHARACTER_TRIAL_READ_PORT,
    CHARACTER_READ_PORT,
    CHARACTER_NAME_READ_PORT,
    PUBLIC_UPDATE_READ_PORT,
    CHARACTER_RELATION_READ_PORT,
    CHARACTER_WORK_LINK_READ_PORT,
    CHARACTER_VOICE_READ_PORT,
    CHARACTER_REAL_PERSON_NAMES,
    CHARACTER_SUPPLEMENT_PORT,
    CHARACTER_SUPPLEMENT_CONFLICTS,
    CHARACTER_PLAZA_PORT,
    CHARACTER_CHILD_FEATURES_WRITER,
  ],
})
export class CharactersModule {}
