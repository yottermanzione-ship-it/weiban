import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
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
}
