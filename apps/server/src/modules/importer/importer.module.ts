/**
 * importer 模块装配（上层，T-079）：导入聊天记录 / 截图 / 资料，生成角色草稿或补充设定。
 * 需要：IMPORTER_ANALYZER（ai-runtime 的 ImportAnalyzerPort，T-081 实现后在 app.module.ts 绑定，可选）。
 */
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/index.js';
import { MediaModule } from '../media/index.js';
import { PushModule } from '../push/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { ImporterService } from './application/importer.service.js';
import { ImporterController } from './http/importer.controller.js';

@Module({
  imports: [BillingModule, MediaModule, PushModule, RealtimeModule],
  controllers: [ImporterController],
  providers: [ImporterService],
})
export class ImporterModule {}
