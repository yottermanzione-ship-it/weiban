/**
 * play 模块装配（上层，schema `play`，ADR-0024）：五个玩法的数据与接口。
 * T-091 每日一问；T-092～T-095 在同一模块追加（实现 PlayFeature 并加入 PlayLifecycle）。
 * 提供：PLAY_READ_PORT、PLAY_AGENT_PORT（契约）、PLAY_DAILY_ANSWER_STATUS（内部，给 T-096）。
 * 不 import ai-runtime / growth（上层白名单）；成就、首次互动由 growth 订阅 play.* 事件完成。
 */
import { Module } from '@nestjs/common';
import { CharactersModule } from '../characters/index.js';
import { ChatModule } from '../chat/index.js';
import { ContactsModule } from '../contacts/index.js';
import { IdentityModule } from '../identity/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { PlayContext } from './application/context.js';
import { DailyQuestionService } from './application/daily-question.service.js';
import { PlayJobs } from './application/play-jobs.js';
import { PlayLifecycle } from './application/play-lifecycle.js';
import { PlayPortsService } from './application/play-ports.js';
import { WishlistService } from './application/wishlist.service.js';
import {
  DailyQuestionAdminController,
  DailyQuestionController,
} from './http/daily-question.controller.js';
import { WishlistController } from './http/wishlist.controller.js';
import {
  PLAY_AGENT_PORT,
  PLAY_DAILY_ANSWER_STATUS,
  PLAY_READ_PORT,
  PLAY_WISHLIST_FOLLOW_UP,
} from './tokens.js';

@Module({
  imports: [CharactersModule, ChatModule, ContactsModule, IdentityModule, RealtimeModule],
  controllers: [DailyQuestionController, DailyQuestionAdminController, WishlistController],
  providers: [
    PlayContext,
    PlayJobs,
    DailyQuestionService,
    WishlistService,
    PlayPortsService,
    PlayLifecycle,
    { provide: PLAY_READ_PORT, useExisting: PlayPortsService },
    { provide: PLAY_AGENT_PORT, useExisting: PlayPortsService },
    { provide: PLAY_DAILY_ANSWER_STATUS, useExisting: DailyQuestionService },
    { provide: PLAY_WISHLIST_FOLLOW_UP, useExisting: WishlistService },
  ],
  exports: [PLAY_READ_PORT, PLAY_AGENT_PORT, PLAY_DAILY_ANSWER_STATUS, PLAY_WISHLIST_FOLLOW_UP],
})
export class PlayModule {}
