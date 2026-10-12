import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { TimelineEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { TimelineListService, TimelineSummaryService } from '../application/timeline.js';

@Controller('api/v1')
@RequireAuth('user')
export class TimelineController {
  constructor(
    @Inject(TimelineSummaryService) private readonly timeline: TimelineSummaryService,
    @Inject(TimelineListService) private readonly list: TimelineListService,
  ) {}

  /** GET /api/v1/characters/:characterId/timeline（契约 3.0 listTimeline，T-066）。 */
  @Get('characters/:characterId/timeline')
  listTimeline(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.listTimeline.params!)) params: { characterId: string },
    @Query(new ContractPipe(E.listTimeline.query!)) query: { cursor?: string; limit: number },
  ) {
    return this.list.list(p.userId, params.characterId, query);
  }

  /**
   * GET /api/v1/conversations/:conversationId/timeline-summary
   *
   * 查询参数 `characterId` 和 `lastActiveAt` 由客户端传入：
   * - characterId：会话对应的角色 ID（客户端已知）
   * - lastActiveAt：用户上次离开时刻（ISO 8601），用于计算离线时长
   *
   * 接口按 D-L3-05 / SIM-11 定义。
   */
  @Get('conversations/:conversationId/timeline-summary')
  getSummary(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(E.getSummary.params!)) params: { conversationId: string },
    @Query(new ContractPipe(E.getSummary.query!))
    query: { characterId: string; lastActiveAt: string },
  ) {
    return this.timeline.getSummary(
      p.userId,
      query.characterId,
      params.conversationId,
      query.lastActiveAt,
    );
  }
}
