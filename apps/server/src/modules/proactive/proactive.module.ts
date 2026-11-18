/**
 * proactive 模块装配（D-L3-02，SIM-05～09）。
 * 提供：
 *   - PROACTIVE_MESSAGE_PORT → ProactiveMessageService（主动消息计数、待回复状态）
 *   - HOLIDAY_EVENT_PORT → HolidayService（节日/纪念日查询）
 */
import { Module } from '@nestjs/common';
import { DailyEventService } from './application/daily-event.service.js';
import { HolidayService } from './application/holiday.service.js';
import { ProactiveMessageService } from './application/proactive-message.service.js';
import { DailyEventController, HolidayAdminController } from './http/proactive.controller.js';
import { HOLIDAY_EVENT_PORT, PROACTIVE_MESSAGE_PORT } from './tokens.js';

@Module({
  controllers: [HolidayAdminController, DailyEventController],
  providers: [
    HolidayService,
    DailyEventService,
    ProactiveMessageService,
    { provide: PROACTIVE_MESSAGE_PORT, useExisting: ProactiveMessageService },
    { provide: HOLIDAY_EVENT_PORT, useExisting: HolidayService },
  ],
  exports: [PROACTIVE_MESSAGE_PORT, HOLIDAY_EVENT_PORT, DailyEventService],
})
export class ProactiveModule {}
