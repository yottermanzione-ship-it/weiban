import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { MuseWeiboAdminEndpoints as E, type MuseWeiboSubmission } from '@weiban/contracts';
import {
  ContractPipe,
  RequireAuth,
  RequireScope,
  SCOPE_MUSE_WEIBO_PUBLISH,
} from '../../../platform/index.js';
import { MuseWeiboService } from '../application/muse-weibo.js';

@Controller('api/v1/admin/ecology/muse-weibo')
@RequireAuth('admin')
@RequireScope(SCOPE_MUSE_WEIBO_PUBLISH)
export class MuseWeiboController {
  constructor(@Inject(MuseWeiboService) private readonly service: MuseWeiboService) {}

  @Post()
  @HttpCode(202)
  submit(@Body(new ContractPipe(E.submit.body!)) body: MuseWeiboSubmission) {
    return this.service.submit(body);
  }

  @Get(':receiptId')
  get(@Param(new ContractPipe(E.get.params!)) params: { receiptId: string }) {
    return this.service.get(params.receiptId);
  }
}
