/**
 * growth 模块装配（上层）。L3：熟悉度、认识天数、纪念日（T-050）；L6：卡片与成就（T-076）。
 * 提供：GROWTH_SERVICE（ai-runtime 现用）、GROWTH_READ_PORT、GROWTH_CARD_PORT。
 * 需要：GROWTH_HOLIDAY_SOURCE（app.module.ts 绑定到 proactive 的节日查询，可选）。
 */
import { Module } from '@nestjs/common';
import type { GrowthReadPort } from '@weiban/contracts';
import { CharactersModule } from '../characters/index.js';
import { ChatModule } from '../chat/index.js';
import { ContactsModule } from '../contacts/index.js';
import { IdentityModule } from '../identity/index.js';
import { MediaModule } from '../media/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { AchievementService } from './application/achievements.service.js';
import { CardsService } from './application/cards.service.js';
import { GrowthContext } from './application/context.js';
import { GrowthEvents } from './application/growth-events.js';
import { GrowthService } from './application/growth.service.js';
import { PetsService } from './application/pets.service.js';
import { PetSpeciesAdminController, PetsController } from './http/pets.controller.js';
import { GrowthCardsController } from './http/growth-cards.controller.js';
import { GrowthController } from './http/growth.controller.js';
import {
  GROWTH_CARD_PORT,
  GROWTH_PET_ALBUM,
  GROWTH_PET_NAMING_PORT,
  GROWTH_PET_READ_PORT,
  GROWTH_READ_PORT,
  GROWTH_SERVICE,
} from './tokens.js';

@Module({
  imports: [
    ContactsModule,
    CharactersModule,
    ChatModule,
    IdentityModule,
    MediaModule,
    RealtimeModule,
  ],
  // 卡片控制器在前：/growth/cards、/growth/achievements 等固定路径先于 /growth/:characterId/... 匹配。
  controllers: [GrowthCardsController, GrowthController, PetsController, PetSpeciesAdminController],
  providers: [
    GrowthContext,
    AchievementService,
    CardsService,
    GrowthService,
    PetsService,
    GrowthEvents,
    { provide: GROWTH_PET_READ_PORT, useExisting: PetsService },
    { provide: GROWTH_PET_NAMING_PORT, useExisting: PetsService },
    { provide: GROWTH_PET_ALBUM, useExisting: PetsService },
    { provide: GROWTH_SERVICE, useExisting: GrowthService },
    { provide: GROWTH_CARD_PORT, useExisting: CardsService },
    {
      provide: GROWTH_READ_PORT,
      inject: [GrowthService],
      useFactory: (growth: GrowthService): GrowthReadPort => ({
        getFamiliarityLevel: (userId, characterId) =>
          growth.getFamiliarityLevel(userId, characterId),
        getDaysKnown: (userId, characterId) => growth.getDaysKnownCount(userId, characterId),
      }),
    },
  ],
  exports: [
    GROWTH_SERVICE,
    GROWTH_READ_PORT,
    GROWTH_CARD_PORT,
    GROWTH_PET_READ_PORT,
    GROWTH_PET_NAMING_PORT,
    GROWTH_PET_ALBUM,
  ],
})
export class GrowthModule {}
