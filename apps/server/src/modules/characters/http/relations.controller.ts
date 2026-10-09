/**
 * 关系网 HTTP（T-063）：管理端 RelationAdminEndpoints（ADM-02）、用户端 UserRelationEndpoints（SOC-01 第 3 条）。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RelationAdminEndpoints as A, UserRelationEndpoints as U } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { CharacterRelationService } from '../application/relations.js';

@Controller('api/v1/admin/relations')
@RequireAuth('admin')
export class RelationAdminController {
  constructor(
    @Inject(CharacterRelationService) private readonly relations: CharacterRelationService,
  ) {}
  @Get()
  list(@Query(new ContractPipe(A.listRelations.query!)) q: { characterId?: string }) {
    return this.relations.adminList(q.characterId);
  }
  @Post()
  @HttpCode(201)
  create(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(A.createRelation.body!)) body: unknown,
  ) {
    return this.relations.adminCreate(me.userId, body);
  }
  @Patch(':relationId')
  update(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.updateRelation.params!)) p: { relationId: string },
    @Body(new ContractPipe(A.updateRelation.body!)) body: unknown,
  ) {
    return this.relations.adminUpdate(me.userId, p.relationId, body);
  }
  @Delete(':relationId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(A.deleteRelation.params!)) p: { relationId: string },
  ) {
    await this.relations.adminDelete(me.userId, p.relationId);
  }
}

@Controller('api/v1/me/character-relations')
@RequireAuth('user')
export class UserRelationController {
  constructor(
    @Inject(CharacterRelationService) private readonly relations: CharacterRelationService,
  ) {}
  @Get()
  list(@CurrentPrincipal() me: AuthPrincipal) {
    return this.relations.listMine(me.userId);
  }
  @Post()
  @HttpCode(201)
  create(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(U.createMyRelation.body!)) body: unknown,
  ) {
    return this.relations.createMine(me.userId, body);
  }
  @Patch(':relationId')
  update(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(U.updateMyRelation.params!)) p: { relationId: string },
    @Body(new ContractPipe(U.updateMyRelation.body!)) body: unknown,
  ) {
    return this.relations.updateMine(me.userId, p.relationId, body);
  }
  @Delete(':relationId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(U.deleteMyRelation.params!)) p: { relationId: string },
  ) {
    await this.relations.deleteMine(me.userId, p.relationId);
  }
}
