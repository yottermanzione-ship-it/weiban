/**
 * HealthReadPort：health 模块对外暴露的唯一端口。
 *
 * 调用方限制：**只有 ai-runtime 可以 import 此端口**。
 * 其他模块（chat、growth、contacts 等）禁止引用。
 * 架构 lint 规则由运维在 T-059 中登记到 architecture.js（与 R9 同样按名字管 import）。
 *
 * 需求来源：docs/architecture/health-data.md 第 4 节（D-L3-10）。
 * PRD：PLAY-01 第 4、5 条。
 */

// ---------- 场景枚举 ----------

/**
 * 调用方必须声明读取经期上下文的目的（scene）。
 * 没有群聊、朋友圈、推演、时间线等取值——调用方无法为这些场景要到数据。
 * 见 docs/architecture/health-data.md 第 4 节。
 */
export type HealthReadScene =
  /** 私聊回复：角色正在为用户的私聊消息生成回复。 */
  | 'direct_reply'
  /** 主动私信：角色即将向用户发送主动消息（仅私聊）。 */
  | 'proactive_direct'
  /** 行为规划：行为规划决策层决定是否发起主动关心（PLAN-01）。 */
  | 'planning';

// ---------- 返回类型 ----------

/**
 * 经期状态摘要（最少够用原则，PLAY-01 第 5 条）。
 *
 * **不含**：流量、备注、历史记录明细、预测算法细节。
 * **不得写入**：角色记忆、推演事件、时间线、用量记录、日志、发往境外的行为规划实现（PLAN-03 第 5 条）。
 *
 * ai-runtime 使用注意：
 * 1. 不缓存此对象——每次生成前现取，确保撤销授权立即生效。
 * 2. 用了此摘要生成的消息，发送时必须在 PostMessageInput.labels 中加 'health' 标记。
 * 3. cycleKey 用于主动关心配额账本（每周期最多 P-36 次），不含任何日期信息。
 */
export interface PeriodContext {
  /** 当前是否在经期。 */
  inPeriod: boolean;
  /** 当前经期第几天（仅 inPeriod = true 时有意义；否则为 null）。 */
  dayOfPeriod: number | null;
  /** 预测的下次开始日期（YYYY-MM-DD）；数据不足时为 null。 */
  predictedNextStart: string | null;
  /** 今天记录的痛感（用户未记录时为 null）。 */
  todayPain: 'none' | 'mild' | 'moderate' | 'severe' | null;
  /** 今天记录的症状标签（用户未记录时为空数组）。 */
  todaySymptoms: string[];
  /**
   * 本次经期是否持续超过 P-37 规定的天数。
   * true 时角色可温和建议就医（PLAY-01 第 6 条）。
   */
  longPeriodHint: boolean;
  /** 预测可信度。 */
  prediction: 'normal' | 'irregular' | 'insufficient_data';
  /**
   * 不透明的周期随机 ID，不含任何日期信息。
   * 供 ai-runtime 的主动关心配额账本按周期计数（每周期最多 P-36 次）。
   */
  cycleKey: string;
}

// ---------- 端口接口 ----------

/**
 * HealthReadPort：health 模块的只读端口。
 * 提供方：health 模块；调用方：**仅 ai-runtime**。
 *
 * 返回 null 的情况：
 * - 该角色未被用户授权；
 * - 用户没有任何经期记录；
 * - scene 不在允许范围内（即非私聊、非规划场景）。
 */
export interface HealthReadPort {
  /**
   * 获取当前经期状态摘要，供角色生成回复或行为规划使用。
   *
   * @param userId - 用户 ID
   * @param characterId - 角色 ID（用于检查授权）
   * @param scene - 读取目的，只允许私聊或规划场景
   * @returns PeriodContext 或 null（未授权 / 无记录 / 场景不允许）
   */
  getPeriodContext(input: {
    userId: string;
    characterId: string;
    scene: HealthReadScene;
  }): Promise<PeriodContext | null>;

  /**
   * 查询用户已授权的角色 ID 列表（用于主动消息调度，由调度器判断「由一个角色发出」）。
   * 不做 scene 限制，供 ai-runtime 主动消息调度器按授权列表决定哪个角色发提醒。
   *
   * @param userId - 用户 ID
   * @returns 已授权的角色 ID 数组（无授权时返回空数组）
   */
  getAuthorizedCharacters(userId: string): Promise<string[]>;
}
