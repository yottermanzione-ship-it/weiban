/**
 * plaza 模块装配（上层，T-087）：人设广场（PLZ-01～PLZ-08）与管理端（ADM-09）；
 * 3.5：角色广场「微伴角色」tab（官方预设角色点赞评论）与角色创建 › 申请制作。
 * 需要（由装配入口 app.module.ts 绑定，见 tokens.ts）：
 *   PLAZA_CHARACTERS / PLAZA_SUPPLEMENT_READ / PLAZA_PRESET_NAMES（characters，T-088）、
 *   PLAZA_PUBLISH_CHECK（ai-runtime，T-089）、PLAZA_CLASSIFICATION_POLICY（policy，T-088）。
 */
import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/index.js';
import { IdentityModule } from '../identity/index.js';
import { MediaModule } from '../media/index.js';
import { PushModule } from '../push/index.js';
import { RealtimeModule } from '../realtime/index.js';
import { PlazaAdminService } from './application/plaza-admin.service.js';
import { PlazaLifecycle } from './application/plaza-lifecycle.js';
import { PlazaStore } from './application/plaza-store.js';
import { PlazaOfficialService } from './application/plaza-official.service.js';
import { PlazaService } from './application/plaza.service.js';
import { RoleRequestService } from './application/role-requests.service.js';
import { PlazaAdminController } from './http/plaza-admin.controller.js';
import { PlazaController } from './http/plaza.controller.js';
import {
  PlazaOfficialAdminController,
  PlazaOfficialController,
} from './http/plaza-official.controller.js';
import {
  RoleRequestAdminController,
  RoleRequestController,
} from './http/role-requests.controller.js';
import { PLAZA_ORIGIN_STATUS } from './tokens.js';

@Module({
  imports: [ContactsModule, IdentityModule, MediaModule, PushModule, RealtimeModule],
  controllers: [
    PlazaOfficialController,
    PlazaOfficialAdminController,
    RoleRequestController,
    RoleRequestAdminController,
    PlazaController,
    PlazaAdminController,
  ],
  providers: [
    PlazaStore,
    PlazaService,
    PlazaOfficialService,
    RoleRequestService,
    PlazaAdminService,
    PlazaLifecycle,
    { provide: PLAZA_ORIGIN_STATUS, useExisting: PlazaService },
  ],
  exports: [PLAZA_ORIGIN_STATUS],
})
export class PlazaModule {}
