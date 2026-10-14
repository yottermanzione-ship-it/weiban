/**
 * support 模块装配（中层，3.8）：帮助与反馈、投诉（总对照表 Q9）；设置 › 插件入口（Q10，第二批）。
 * 只依赖底层模块：identity（用户名）、media（截图）、push（回复通知）、realtime（红点同步）。
 */
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { MediaModule } from '../media/index.js';
import { PushModule } from '../push/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { SupportLifecycle } from './application/support-lifecycle.js';
import { SupportService } from './application/support.service.js';
import { SupportAdminController, SupportController } from './http/support.controller.js';

@Module({
  imports: [IdentityModule, MediaModule, PushModule, RealtimeModule],
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService, SupportLifecycle],
})
export class SupportModule {}
