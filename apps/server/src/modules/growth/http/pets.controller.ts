/**
 * 宠物（契约 PetEndpoints）与宠物图鉴管理端（PetSpeciesAdminEndpoints），T-077。
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
import { PetEndpoints as E, PetSpeciesAdminEndpoints as A } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { PetsService } from '../application/pets.service.js';

@Controller('api/v1/pets')
@RequireAuth('user')
export class PetsController {
  constructor(@Inject(PetsService) private readonly pets: PetsService) {}

  @Get('species')
  listSpecies(@CurrentPrincipal() p: AuthPrincipal) {
    return this.pets.listSpecies(p.userId);
  }

  @Post('naming-requests')
  requestNames(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.requestNames.body!)) body: unknown,
  ) {
    return this.pets.requestNames(p.userId, body);
  }

  @Get('naming-requests/:requestId')
  getNamingRequest(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getNamingRequest.params!)) params: { requestId: string },
  ) {
    return this.pets.getNamingRequest(p.userId, params.requestId);
  }

  @Get()
  listPets(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.listPets.query!)) query: { characterId?: string },
  ) {
    return this.pets.listPets(p.userId, query.characterId);
  }

  @Post()
  @HttpCode(201)
  adopt(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(E.adopt.body!)) body: unknown,
  ) {
    return this.pets.adopt(p.userId, body);
  }

  @Get(':petId')
  getPet(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getPet.params!)) params: { petId: string },
  ) {
    return this.pets.getPet(p.userId, params.petId);
  }

  @Patch(':petId')
  updatePet(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.updatePet.params!)) params: { petId: string },
    @Body(new ContractPipe(E.updatePet.body!)) body: unknown,
  ) {
    return this.pets.updatePet(p.userId, params.petId, body);
  }

  @Post(':petId/interactions')
  @HttpCode(200)
  interact(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.interact.params!)) params: { petId: string },
    @Body(new ContractPipe(E.interact.body!)) body: unknown,
  ) {
    return this.pets.interact(p.userId, params.petId, body);
  }

  @Post(':petId/send-away')
  @HttpCode(200)
  sendAway(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.sendAway.params!)) params: { petId: string },
  ) {
    return this.pets.sendAway(p.userId, params.petId);
  }

  @Get(':petId/album')
  listAlbum(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.listAlbum.params!)) params: { petId: string },
  ) {
    return this.pets.listAlbum(p.userId, params.petId);
  }

  @Post(':petId/album')
  @HttpCode(201)
  addAlbumPhoto(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.addAlbumPhoto.params!)) params: { petId: string },
    @Body(new ContractPipe(E.addAlbumPhoto.body!)) body: unknown,
  ) {
    return this.pets.addAlbumPhoto(p.userId, params.petId, body);
  }

  @Delete(':petId/album/:photoId')
  @HttpCode(204)
  async deleteAlbumPhoto(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.deleteAlbumPhoto.params!)) params: { petId: string; photoId: string },
  ) {
    await this.pets.deleteAlbumPhoto(p.userId, params.petId, params.photoId);
  }
}

@Controller('api/v1/admin/pet-species')
@RequireAuth('admin')
export class PetSpeciesAdminController {
  constructor(@Inject(PetsService) private readonly pets: PetsService) {}

  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.pets.adminListSpecies(p.userId);
  }

  @Post()
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ContractPipe(A.createSpecies.body!)) body: unknown,
  ) {
    return this.pets.adminCreateSpecies(p.userId, body);
  }

  @Patch(':speciesId')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(A.updateSpecies.params!)) params: { speciesId: string },
    @Body(new ContractPipe(A.updateSpecies.body!)) body: unknown,
  ) {
    return this.pets.adminUpdateSpecies(p.userId, params.speciesId, body);
  }
}
