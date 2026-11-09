import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppError, RequireAuth } from '../../../platform/index.js';
import { LegacyRelayService } from '../application/legacy-relay.service.js';

@Controller('api/v1/internal/channels/legacy')
export class LegacyRelayController {
  constructor(@Inject(LegacyRelayService) private readonly relay: LegacyRelayService) {}

  /** Session auth is deliberately replaced by the per-approved-binding HMAC, never by caller IDs. */
  @Post(':bindingId')
  @HttpCode(200)
  @RequireAuth('none')
  handle(@Param('bindingId') id: string, @Body() body: unknown) {
    if (!z.uuid().safeParse(id).success) throw new AppError('bad_request', '中继绑定无效');
    return this.relay.handle(id, body);
  }
}
