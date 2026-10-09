/**
 * moments 模块装配（上层，T-064）。提供 MOMENTS_READ_PORT、MOMENTS_CHARACTER_PORT（调用方 ai-runtime）。
 * library 不能 import 本模块（T-101 上层白名单），由 app.module.ts 把 MOMENTS_READ_PORT 绑定到 library 自己的令牌。
 */
import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/index.js';
import { MediaModule } from '../media/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { MomentsService } from './application/moments.js';
import { MomentsController } from './http/moments.controller.js';
import { MOMENTS_CHARACTER_PORT, MOMENTS_READ_PORT } from './tokens.js';

@Module({
  imports: [ContactsModule, MediaModule, RealtimeModule],
  controllers: [MomentsController],
  providers: [
    MomentsService,
    { provide: MOMENTS_READ_PORT, useExisting: MomentsService },
    { provide: MOMENTS_CHARACTER_PORT, useExisting: MomentsService },
  ],
  exports: [MOMENTS_READ_PORT, MOMENTS_CHARACTER_PORT],
})
export class MomentsModule {}
