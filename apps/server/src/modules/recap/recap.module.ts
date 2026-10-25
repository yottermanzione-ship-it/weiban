import { Module } from '@nestjs/common';
import { CharactersModule } from '../characters/index.js';
import { ChatModule } from '../chat/index.js';
import { IdentityModule } from '../identity/index.js';
import { PushModule } from '../push/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { RecapService } from './application/recap.service.js';
import { RecapController } from './http/recap.controller.js';

/** 年度回忆（10-25，会员 v6）：只读一个待展示端点 + 已读确认，没有生成 / 列表入口。 */
@Module({
  imports: [ChatModule, IdentityModule, CharactersModule, PushModule, RealtimeModule],
  controllers: [RecapController],
  providers: [RecapService],
})
export class RecapModule {}
