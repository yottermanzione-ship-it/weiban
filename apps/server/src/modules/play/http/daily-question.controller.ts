/** 每日一问（契约 DailyQuestionEndpoints）与题库管理端（DailyQuestionAdminEndpoints），T-091。 */
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { DailyQuestionAdminEndpoints as A, DailyQuestionEndpoints as E } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { DailyQuestionService } from '../application/daily-question.service.js';

type Tag = 'romance' | 'child_safe' | 'work' | 'family' | 'childhood' | 'light';

@Controller('api/v1/play/daily-question')
@RequireAuth('user')
export class DailyQuestionController {
  constructor(@Inject(DailyQuestionService) private readonly daily: DailyQuestionService) {}

  @Get()
  getToday(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.getToday.query!)) query: { characterId?: string },
  ) {
    return this.daily.getToday(p.userId, query.characterId);
  }

  @Post('answers')
  @HttpCode(200)
  answer(@CurrentPrincipal() p: AuthPrincipal, @Body() body: unknown) {
    return this.daily.answer(p.userId, body);
  }

  @Get('history')
  history(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(new ContractPipe(E.listHistory.query!)) query: { cursor?: string },
  ) {
    return this.daily.listHistory(p.userId, query.cursor);
  }
}

@Controller('api/v1/admin/play/questions')
@RequireAuth('admin')
export class DailyQuestionAdminController {
  constructor(@Inject(DailyQuestionService) private readonly daily: DailyQuestionService) {}

  @Get()
  list(@Query(new ContractPipe(A.list.query!)) query: { cursor?: string; tag?: Tag }) {
    return this.daily.adminList(query);
  }

  @Post()
  @HttpCode(200)
  create(@CurrentPrincipal() p: AuthPrincipal, @Body() body: unknown) {
    return this.daily.adminCreate(p.userId, body);
  }

  @Patch(':questionId')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(A.update.params!)) params: { questionId: string },
    @Body() body: unknown,
  ) {
    return this.daily.adminUpdate(p.userId, params.questionId, body);
  }
}
