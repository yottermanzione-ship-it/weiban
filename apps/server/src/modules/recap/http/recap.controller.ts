import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { RecapEndpoints as E } from '@weiban/contracts';
import { CurrentPrincipal, RequireAuth, type AuthPrincipal } from '../../../platform/index.js';
import { RecapService } from '../application/recap.service.js';

/**
 * 年度回忆只读入口（10-25）。刻意只有两个路由：
 * - GET  /me/recap/pending      服务器已经生成、我还没看过的那一份（只读，不触发生成）
 * - POST /me/recap/pending/seen 确认看过（幂等），之后不再自动弹出
 *
 * 没有「按年份查询 / 生成 / 列表」路由：年度回忆由服务端在 12-31 22:00 自己生成，
 * 客户端改日期也提前拿不到；不做常驻入口。
 */
@Controller('api/v1')
export class RecapController {
  constructor(@Inject(RecapService) private readonly service: RecapService) {}

  @Get('me/recap/pending') @RequireAuth(E.pending.auth) async pending(
    @CurrentPrincipal() me: AuthPrincipal,
  ) {
    const recap = await this.service.getPending(me.userId);
    return { recap };
  }

  @Post('me/recap/pending/seen') @HttpCode(204) @RequireAuth(E.markSeen.auth) async markSeen(
    @CurrentPrincipal() me: AuthPrincipal,
  ): Promise<void> {
    await this.service.markSeen(me.userId);
  }
}
