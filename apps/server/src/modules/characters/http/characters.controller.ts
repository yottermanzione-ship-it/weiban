import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Query,
  Param,
  Inject,
  HttpCode,
} from '@nestjs/common';
import {
  CharacterEndpoints as E,
  CharacterAdminEndpoints as A,
  type AdminCharacterWrite,
  type AdminCharacterUpdate,
  type AdminLegacyCharacterPatch,
  type AdminLegacyRestoreRequest,
  type UpdateCharacterEligibilityRequest,
} from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CharacterService } from '../application/characters.js';
import { CharacterEligibilityService } from '../application/eligibility.js';
import { CharacterLegacyAdminService } from '../application/legacy-admin.js';
import { CharacterPurgeService } from '../application/purge.js';
@Controller('api/v1/characters')
export class CharacterController {
  constructor(@Inject(CharacterService) private readonly service: CharacterService) {}
  @Get('categories')
  @RequireAuth(E.listCategories.auth)
  async categories() {
    return { items: await this.service.listCategories() };
  }
  @Get()
  @RequireAuth(E.searchPlaza.auth)
  search(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(E.searchPlaza.query!))
    q: { q?: string; categoryId?: string; cursor?: string; limit: number },
  ) {
    return this.service.search(me.userId, q);
  }
  @Get(':characterId')
  @RequireAuth(E.getProfile.auth)
  profile(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(E.getProfile.params!)) p: { characterId: string },
  ) {
    return this.service.getProfile(me.userId, p.characterId);
  }
}
@Controller('api/v1/admin/characters')
export class CharacterAdminController {
  constructor(
    @Inject(CharacterService) private readonly service: CharacterService,
    @Inject(CharacterEligibilityService) private readonly eligibility: CharacterEligibilityService,
    @Inject(CharacterLegacyAdminService) private readonly legacy: CharacterLegacyAdminService,
    @Inject(CharacterPurgeService) private readonly purger: CharacterPurgeService,
  ) {}
  /** 3.25（G1-2）：角色资格人工标注（预设与用户自建角色都可用）。 */
  @Get(':characterId/eligibility')
  @RequireAuth(A.getEligibility.auth)
  getEligibility(@Param(new ContractPipe(A.getEligibility.params!)) p: { characterId: string }) {
    return this.eligibility.get(p.characterId);
  }
  @Put(':characterId/eligibility')
  @RequireAuth(A.setEligibility.auth)
  setEligibility(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.setEligibility.params!)) p: { characterId: string },
    @Body(new ContractPipe(A.setEligibility.body!)) body: UpdateCharacterEligibilityRequest,
  ) {
    return this.eligibility.set(me.userId, p.characterId, body);
  }
  @Get()
  @RequireAuth(A.list.auth)
  async list(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(A.list.query!)) q: { status?: string; q?: string },
  ) {
    return { items: await this.service.adminList(me.userId, q) };
  }
  @Post()
  @HttpCode(201)
  @RequireAuth(A.create.auth)
  create(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(A.create.body!)) body: AdminCharacterWrite,
  ) {
    return this.service.create(me.userId, body);
  }
  @Patch(':characterId')
  @RequireAuth(A.update.auth)
  update(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.update.params!)) p: { characterId: string },
    @Body(new ContractPipe(A.update.body!)) body: AdminCharacterUpdate,
  ) {
    return this.service.update(me.userId, p.characterId, body);
  }
  /** 旧卡详情：旧字段 + 世界书 + 示例 + 未识别字段 + 修改记录（详情按需读，列表不传正文）。 */
  @Get(':characterId/legacy')
  @RequireAuth(A.legacyDetail.auth)
  legacyDetail(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.legacyDetail.params!)) p: { characterId: string },
  ) {
    return this.legacy.detail(me.userId, p.characterId);
  }
  /** 旧卡局部保存：白名单字段合并 / 清空、世界书与示例按 id 更新删除、头像替换；保存前写完整快照。 */
  @Patch(':characterId/legacy')
  @RequireAuth(A.legacyUpdate.auth)
  legacyUpdate(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.legacyUpdate.params!)) p: { characterId: string },
    @Body(new ContractPipe(A.legacyUpdate.body!)) body: AdminLegacyCharacterPatch,
  ) {
    return this.legacy.patch(me.userId, p.characterId, body);
  }
  /** 某个旧卡版本快照的完整内容（查看 / 恢复确认）；只查本角色，不含签名 URL。 */
  @Get(':characterId/legacy/revisions/:revision')
  @RequireAuth(A.legacyRevision.auth)
  legacyRevision(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.legacyRevision.params!))
    p: { characterId: string; revision: number },
  ) {
    return this.legacy.revision(me.userId, p.characterId, p.revision);
  }
  /** 恢复旧卡到某个快照版本：需 expectedRevision + confirm=true；写新 revision 并另存恢复前快照。 */
  @Post(':characterId/legacy/restore')
  @HttpCode(200)
  @RequireAuth(A.legacyRestore.auth)
  legacyRestore(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.legacyRestore.params!)) p: { characterId: string },
    @Body(new ContractPipe(A.legacyRestore.body!)) body: AdminLegacyRestoreRequest,
  ) {
    return this.legacy.restore(me.userId, p.characterId, body);
  }
  @Post(':characterId/publish')
  @HttpCode(200)
  @RequireAuth(A.publish.auth)
  publish(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.publish.params!)) p: { characterId: string },
  ) {
    return this.service.publish(me.userId, p.characterId);
  }
  @Post(':characterId/unpublish')
  @HttpCode(200)
  @RequireAuth(A.unpublish.auth)
  unpublish(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.unpublish.params!)) p: { characterId: string },
  ) {
    return this.service.unpublish(me.userId, p.characterId);
  }
  /** 彻底删除前的影响面；与下架（软删）分开，供后台二次确认展示。 */
  @Get(':characterId/purge-impact')
  @RequireAuth(A.purgeImpact.auth)
  purgeImpact(@Param(new ContractPipe(A.purgeImpact.params!)) p: { characterId: string }) {
    return this.purger.impact(p.characterId);
  }
  /** 管理员硬删预设角色：purge=true 必填，避免误把普通 DELETE 当成软删。 */
  @Delete(':characterId')
  @HttpCode(200)
  @RequireAuth(A.purge.auth)
  purge(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.purge.params!)) p: { characterId: string },
    @Query(new ContractPipe(A.purge.query!)) _q: { purge: 'true' },
  ) {
    return this.purger.purge(me.userId, p.characterId);
  }
}
