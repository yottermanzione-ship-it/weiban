/**
 * library 模块装配（上层，T-078）：收藏、分享图数据。
 * 需要：LIBRARY_MOMENTS_READ（moments 的 MomentsReadPort）、LIBRARY_CARD_LOOKUP（growth 卡片查询），
 * 均由 app.module.ts 绑定（library 不能 import moments / growth，T-101 上层白名单）。
 */
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { CharactersModule } from '../characters/index.js';
import { MediaModule } from '../media/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { IdentityModule } from '../identity/index.js';
import { LibraryService } from './application/library.service.js';
import { LibraryController } from './http/library.controller.js';
import { LegacyFavoritesService } from './application/legacy-favorites.service.js';
import { LegacyFavoritesController } from './http/legacy-favorites.controller.js';

@Module({
  imports: [ChatModule, RealtimeModule, CharactersModule, MediaModule, IdentityModule],
  controllers: [LibraryController, LegacyFavoritesController],
  providers: [LibraryService, LegacyFavoritesService],
})
export class LibraryModule {}
