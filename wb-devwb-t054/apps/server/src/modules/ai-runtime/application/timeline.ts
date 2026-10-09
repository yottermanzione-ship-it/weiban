/**
 * T-054 时间线摘要服务：生成「你不在时 TA 过了怎样的一天」摘要。
 *
 * 设计要点（对齐 SIM-11、runtime-overview.md 2.4 节）：
 * - 数据来自推演引擎（SimulationReadPort）的日常事件与心情。
 * - 离线时长 < 1 小时时返回空摘要，不调用模型（SIM-11 第 2 条）。
 * - 摘要生成走后台网关（behavior_planning 用途，countAsBackground=true）。
 * - 后台预算耗尽时返回空摘要，不报错（SIM-11 第 3 条）。
 * - 每次调用只生成一次：幂等键按 userId + characterId + 日期锁定，同日重复请求走缓存。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  type ModelGatewayPort,
  type GenerateError,
  type TimelineSummaryResponse,
} from '@weiban/contracts';
import {
  CLOCK,
  type Clock,
} from '../../../platform/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import {
  SIMULATION_READ_PORT,
  type SimulationReadPort,
  type DailyEventEntry,
} from './simulation.js';

/** 离线时长不足此值（秒）时不生成摘要。 */
const MIN_OFFLINE_SECONDS = 3600;

/** 摘要生成最大输出 token（后台任务，回复较短）。 */
const SUMMARY_MAX_OUTPUT_TOKENS = 256;

@Injectable()
export class TimelineSummaryService {
  constructor(
    @Inject(SIMULATION_READ_PORT) private readonly simulation: SimulationReadPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 获取「你不在时」摘要。
   *
   * @param userId      当前用户
   * @param characterId 角色
   * @param conversationId 会话（用于记账 meta 字段）
   * @param lastActiveAt  用户上次活跃时刻（ISO 8601）；用于计算离线时长
   */
  async getSummary(
    userId: string,
    characterId: string,
    conversationId: string,
    lastActiveAt: string,
  ): Promise<TimelineSummaryResponse> {
    const now = this.clock.now();
    const nowMs = now.getTime();
    const lastActiveMs = Date.parse(lastActiveAt);
    const offlineSeconds = Math.max(0, Math.floor((nowMs - lastActiveMs) / 1000));

    // 今天的推演事件
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const [events, currentMood] = await Promise.all([
      this.simulation.getDailyEvents(userId, characterId, today),
      this.simulation.getCurrentMood(userId, characterId),
    ]);

    // 离线时长不足或无事件时不生成摘要
    if (offlineSeconds < MIN_OFFLINE_SECONDS || events.length === 0) {
      return {
        summary: null,
        events: mapEvents(events),
        currentMood,
        offlineSeconds,
      };
    }

    // 调用模型生成摘要（behavior_planning 用途，计入后台预算）
    const idempotencyKey = `timeline:${userId}:${characterId}:${today}`;
    const prompt = buildSummaryPrompt(events, offlineSeconds);

    const result = await this.gateway.generateText({
      userId,
      characterId,
      conversationId,
      purpose: 'behavior_planning',
      billingOwner: 'user',
      modelRole: 'background',
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      responseFormat: 'text',
      idempotencyKey,
      countAsBackground: true,
    });

    // 后台预算耗尽或其他错误时静默返回空摘要
    if (!result.ok) {
      return {
        summary: null,
        events: mapEvents(events),
        currentMood,
        offlineSeconds,
      };
    }

    return {
      summary: result.value.text.trim() || null,
      events: mapEvents(events),
      currentMood,
      offlineSeconds,
    };
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function mapEvents(entries: DailyEventEntry[]): TimelineSummaryResponse['events'] {
  return entries.map((e) => ({
    id: e.id,
    seq: e.seq,
    kind: e.kind,
    summary: e.summary,
    detail: e.detail,
    moodAfter: e.moodAfter,
  }));
}

function buildSummaryPrompt(events: DailyEventEntry[], offlineSeconds: number): string {
  const hours = Math.floor(offlineSeconds / 3600);
  const minutes = Math.floor((offlineSeconds % 3600) / 60);
  const offlineDesc =
    hours > 0 ? `${hours} 小时 ${minutes > 0 ? `${minutes} 分钟` : ''}` : `${minutes} 分钟`;

  const eventLines = events
    .map((e, i) => `${i + 1}. [${e.kind}] ${e.summary}${e.detail ? `——${e.detail}` : ''}`)
    .join('\n');

  return `用户离开了 ${offlineDesc.trim()}。在这段时间里，角色经历了以下事情：

${eventLines}

请用温暖、自然的第一人称（角色视角）写一段简短的「你不在的时候」摘要，让用户感觉角色一直在认真生活。
要求：
- 不超过 80 字。
- 语气贴近角色人设，像在和好友分享，不要像日报。
- 只输出摘要文本，不要有标题或其他内容。`;
}
