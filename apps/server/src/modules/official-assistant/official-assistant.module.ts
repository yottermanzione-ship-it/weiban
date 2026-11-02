/**
 * 小V同学官方身份模块（方向 B，上层模块，无自有 schema：会话数据经 chat 端口写 chat schema）。
 * 依赖（端口注入，不直接读别模块的表）：chat、contacts、billing、identity、model-access。
 */
import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { ContactsModule } from '../contacts/index.js';
import { BillingModule } from '../billing/index.js';
import { IdentityModule } from '../identity/index.js';
import { ModelAccessModule } from '../model-access/index.js';
import { BriefService } from './application/brief.js';
import { OfficialBroadcastService } from './application/broadcast.js';
import { OfficialAssistantEngine } from './application/engine.js';
import { OfficialAssistantLifecycle } from './application/lifecycle.js';
import {
  OfficialAssistantAdminController,
  OfficialAssistantController,
} from './http/official-assistant.controller.js';
import { loadKnowledgeBase } from './domain/knowledge-base.js';
import { OFFICIAL_KNOWLEDGE_BASE } from './tokens.js';

@Module({
  imports: [ChatModule, ContactsModule, BillingModule, IdentityModule, ModelAccessModule],
  controllers: [OfficialAssistantController, OfficialAssistantAdminController],
  providers: [
    BriefService,
    OfficialAssistantEngine,
    OfficialBroadcastService,
    OfficialAssistantLifecycle,
    { provide: OFFICIAL_KNOWLEDGE_BASE, useFactory: () => loadKnowledgeBase() },
  ],
})
export class OfficialAssistantModule {}
