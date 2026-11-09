import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ContactOrganizationEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { ContactOrganizationService } from '../application/organization.js';
@Controller('api/v1/contacts/organization')
@RequireAuth('user')
export class ContactOrganizationController {
  constructor(
    @Inject(ContactOrganizationService) private readonly organization: ContactOrganizationService,
  ) {}
  @Get() get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.organization.get(principal.userId);
  }
  @Put() save(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ContractPipe(E.save.body!)) body: unknown,
  ) {
    return this.organization.save(principal.userId, body);
  }
}
