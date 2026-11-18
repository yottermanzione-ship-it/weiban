/**
 * 主动消息调度端口（T-052，D-L3-02）。
 * 提供方：proactive 模块。
 * 消费方：
 *   - ai-runtime / T-053 调度器：发主动消息前查 canSendProactive / getDailyCount，发完调 recordSent。
 *   - billing 不依赖这里，计费仍走 BillingReservationPort。
 *
 * 设计见 docs/product/prd-v1/06-simulation-proactive.md SIM-05（每角色 P-03 次，全部角色 P-04 次）。
 * P-03 / P-04 的具体数值由 ai-runtime 调度时从参数配置读取；这里只提供计数查询和写入。
 */

/** 节日/纪念日事件（已展开为当年具体日期，由 HolidayEventPort 计算得出）。 */
export interface UpcomingHoliday {
  holidayId: string;
  name: string;
  /** 当年该节日的具体日期，YYYY-MM-DD。 */
  date: string;
  /** 相对今天的天数（0 = 今天，1 = 明天……）。 */
  daysAhead: number;
  /** 是否带恋爱含义（七夕、情人节等）。 */
  romantic: boolean;
}

/**
 * 主动消息计数端口。
 * 所有计数均以用户本地日期（IANA 时区）为边界，时区由调度方传入。
 */
export interface ProactiveMessagePort {
  /**
   * 判断今天是否还可以向用户发主动消息（单角色维度）。
   * 返回 false 说明该角色今天已达 perCharacterLimit，调度方应跳过。
   * @param userId       用户 ID
   * @param characterId  角色 ID
   * @param localDate    用户本地日期，YYYY-MM-DD
   * @param perCharacterLimit  每角色每天上限（P-03，调度方传入）
   */
  canSendProactive(
    userId: string,
    characterId: string,
    localDate: string,
    perCharacterLimit: number,
  ): Promise<boolean>;

  /**
   * 记录已向用户发出了一条主动消息。
   * 幂等：同一 idempotencyKey 重复调用只计一次。
   * @returns 写入后该角色今天已发条数
   */
  recordSent(
    userId: string,
    characterId: string,
    localDate: string,
    idempotencyKey: string,
    /** 主动消息理由（SIM-05 第 1 条），供验收抽查。 */
    reason: string,
  ): Promise<number>;

  /**
   * 查询用户某天所有角色合计已发主动消息条数（用于判断全局上限 P-04）。
   */
  getDailyTotalCount(userId: string, localDate: string): Promise<number>;

  /**
   * 查询某角色某天已发条数（用于精确判断单角色上限）。
   */
  getDailyCount(userId: string, characterId: string, localDate: string): Promise<number>;

  /**
   * 用户是否有未回复的主动消息（同一角色）。
   * true 时调度方应跳过（SIM-05 第 6 条；节日纪念日不受此限，调度方判断）。
   */
  hasPendingProactive(userId: string, characterId: string): Promise<boolean>;

  /**
   * 将某角色的待回复状态标记为已回复（用户发消息时由聊天模块调用）。
   * 幂等：已清除再调用无副作用。
   */
  markReplied(userId: string, characterId: string): Promise<void>;
}

/**
 * 节日/纪念日查询端口。
 * 提供方：proactive 模块。
 * 消费方：ai-runtime 调度器（T-053）在决定「今天有什么理由可以发主动消息」时查询。
 */
export interface HolidayEventPort {
  /**
   * 查询未来 daysAhead 天内（含今天）的启用节日/纪念日，按日期升序。
   * 负责把 annual（MM-DD）节日展开为当年具体日期，处理跨年（12-31 到 1-1）。
   * @param fromDate  查询起始日期，YYYY-MM-DD（通常为用户本地今天）
   * @param daysAhead 向未来看几天（含 fromDate 当天）
   */
  getUpcoming(fromDate: string, daysAhead: number): Promise<UpcomingHoliday[]>;
}
