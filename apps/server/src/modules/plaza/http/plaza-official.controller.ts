/** 3.5：角色广场「微伴角色」tab（契约 PlazaOfficialEndpoints / PlazaOfficialAdminEndpoints）。 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PlazaOfficialAdminEndpoints as A, PlazaOfficialEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { PlazaOfficialService } from '../application/plaza-official.service.js';

const charParams = new ContractPipe(E.get.params!);
const cursorQuery = new ContractPipe(E.listComments.query!);

@Controller('api/v1/plaza/official')
@RequireAuth('user')
export class PlazaOfficialController {
  constructor(@Inject(PlazaOfficialService) private readonly official: PlazaOfficialService) {}

  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal, @Query() query: unknown) {
    return this.official.list(p.userId, query);
  }

  @Get(':characterId')
  get(@CurrentPrincipal() p: AuthPrincipal, @Param(charParams) params: { characterId: string }) {
    return this.official.get(p.userId, params.characterId);
  }

  @Post(':characterId/like')
  @HttpCode(200)
  like(@CurrentPrincipal() p: AuthPrincipal, @Param(charParams) params: { characterId: string }) {
    return this.official.like(p.userId, params.characterId);
  }

  @Delete(':characterId/like')
  unlike(@CurrentPrincipal() p: AuthPrincipal, @Param(charParams) params: { characterId: string }) {
    return this.official.unlike(p.userId, params.characterId);
  }

  @Get(':characterId/comments')
  listComments(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(charParams) params: { characterId: string },
    @Query(cursorQuery) query: { cursor?: string },
  ) {
    return this.official.listComments(p.userId, params.characterId, query.cursor);
  }

  @Post(':characterId/comments')
  @HttpCode(201)
  addComment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(charParams) params: { characterId: string },
    @Body(new ContractPipe(E.addComment.body!)) body: unknown,
  ) {
    return this.official.addComment(p.userId, params.characterId, body);
  }
}

@Controller('api/v1/admin/plaza/official')
@RequireAuth('admin')
export class PlazaOfficialAdminController {
  constructor(@Inject(PlazaOfficialService) private readonly official: PlazaOfficialService) {}

  @Get('comments')
  listComments(
    @Query(new ContractPipe(A.listComments.query!))
    query: {
      characterId?: string;
      cursor?: string;
    },
  ) {
    return this.official.adminListComments(query);
  }
}
