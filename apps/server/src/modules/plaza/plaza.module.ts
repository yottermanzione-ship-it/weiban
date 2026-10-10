/**
 * plaza 模块装配（上层，T-087）：人设广场（PLZ-01～PLZ-08）与管理端（ADM-09）。
 * 需要（由装配入口 app.module.ts 绑定，见 tokens.ts）：
 *   PLAZA_CHARACTERS / PLAZA_SUPPLEMENT_READ / PLAZA_PRESET_NAMES（characters，T-088）、
 *   PLAZA_PUBLISH_CHECK（ai-runtime，T-089）、PLAZA_CLASSIFICATION_POLICY（policy，T-088）。
 */
import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/index.js';
import { MediaModule } from '../media/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { PlazaAdminService } from './application/plaza-admin.service.js';
import { PlazaLifecycle } from './application/plaza-lifecycle.js';
import { PlazaStore } from './application/plaza-store.js';
import { PlazaService } from './application/plaza.service.js';
import { PlazaAdminController } from './http/plaza-admin.controller.js';
import { PlazaController } from './http/plaza.controller.js';

@Module({
  imports: [ContactsModule, MediaModule, RealtimeModule],
  controllers: [PlazaController, PlazaAdminController],
  providers: [PlazaStore, PlazaService, PlazaAdminService, PlazaLifecycle],
})
export class PlazaModule {}
