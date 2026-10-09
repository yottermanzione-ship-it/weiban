/**
 * proactive 模块 HTTP 控制器（D-L3-02）。
 * 节日管理（管理端）+ 角色日常事件（客户端时间线 + 内部写入）。
 * 对应契约 HolidayAdminEndpoints / DailyEventEndpoints（packages/contracts/src/http/proactive.ts）。
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
import { DailyEventEndpoints, HolidayAdminEndpoints } from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { DailyEventService } from '../application/daily-event.service.js';
import { HolidayService } from '../application/holiday.service.js';

const H = HolidayAdminEndpoints;
const D = DailyEventEndpoints;

type Out<S extends z.ZodType | undefined> = z.output<NonNullable<S>>;

function schema<S extends z.ZodType>(value: S | undefined): S {
  if (!value) throw new Error('契约接口缺少 schema');
  return value;
}

// ---------- 节日管理（管理端） ----------

@Controller('api/v1/admin/proactive/holidays')
export class HolidayAdminController {
  constructor(@Inject(HolidayService) private readonly holiday: HolidayService) {}

  @Get()
  @RequireAuth(H.list.auth)
  list(
    @Query(new ContractPipe(schema(H.list.query)))
    query: Out<typeof H.list.query>,
  ) {
    return this.holiday.list({
      enabled: query.enabled,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post()
  @HttpCode(201)
  @RequireAuth(H.create.auth)
  create(
    @Body(new ContractPipe(schema(H.create.body)))
    body: Out<typeof H.create.body>,
  ) {
    return this.holiday.create(body);
  }

  @Patch(':holidayId')
  @RequireAuth(H.update.auth)
  update(
    @Param(new ContractPipe(schema(H.update.params))) params: Out<typeof H.update.params>,
    @Body(new ContractPipe(schema(H.update.body)))
    body: Out<typeof H.update.body>,
  ) {
    return this.holiday.update(params.holidayId, body);
  }

  @Delete(':holidayId')
  @HttpCode(204)
  @RequireAuth(H.remove.auth)
  async remove(
    @Param(new ContractPipe(schema(H.remove.params))) params: Out<typeof H.remove.params>,
  ) {
    await this.holiday.remove(params.holidayId);
    return null;
  }
}

// ---------- 日常事件（内部写入 + 客户端时间线） ----------

@Controller()
export class DailyEventController {
  constructor(@Inject(DailyEventService) private readonly events: DailyEventService) {}

  /** ai-runtime 批量写入（内部接口，admin auth）。 */
  @Post('api/v1/internal/proactive/daily-events/batch')
  @HttpCode(201)
  @RequireAuth(D.createBatch.auth)
  async createBatch(
    @Body(new ContractPipe(schema(D.createBatch.body)))
    body: Out<typeof D.createBatch.body>,
  ) {
    return { created: await this.events.createBatch(body.events) };
  }

  /** 客户端查询时间线（SIM-11）。 */
  @Get('api/v1/characters/:characterId/daily-events')
  @RequireAuth(D.listByCharacter.auth)
  listByCharacter(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(D.listByCharacter.params)))
    params: Out<typeof D.listByCharacter.params>,
    @Query(new ContractPipe(schema(D.listByCharacter.query)))
    query: Out<typeof D.listByCharacter.query>,
  ) {
    return this.events.listByCharacter(me.userId, params.characterId, {
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  /** 管理后台纠错：删除一件日常事件。 */
  @Delete('api/v1/internal/proactive/daily-events/:eventId')
  @HttpCode(204)
  @RequireAuth(D.remove.auth)
  async remove(
    @Param(new ContractPipe(schema(D.remove.params))) params: Out<typeof D.remove.params>,
  ) {
    await this.events.remove(params.eventId);
    return null;
  }
}
