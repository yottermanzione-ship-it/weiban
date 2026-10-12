/** TA 的提醒（契约 ReminderEndpoints），T-095。 */
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
} from '@nestjs/common';
import { ReminderEndpoints as R } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { RemindersService } from '../application/reminders.service.js';

@Controller('api/v1/play/reminders')
@RequireAuth('user')
export class RemindersController {
  constructor(@Inject(RemindersService) private readonly reminders: RemindersService) {}

  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.reminders.list(p.userId);
  }

  @Post()
  @HttpCode(200)
  create(@CurrentPrincipal() p: AuthPrincipal, @Body() body: unknown) {
    return this.reminders.create(p.userId, body);
  }

  @Patch(':reminderId')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(R.updateReminder.params!)) params: { reminderId: string },
    @Body() body: unknown,
  ) {
    return this.reminders.update(p.userId, params.reminderId, body);
  }

  @Delete(':reminderId')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(R.deleteReminder.params!)) params: { reminderId: string },
  ) {
    await this.reminders.remove(p.userId, params.reminderId);
  }
}
