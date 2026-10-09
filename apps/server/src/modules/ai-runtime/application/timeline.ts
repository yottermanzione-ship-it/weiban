/**
 * T-054 时间线摘要服务：生成「你不在时 TA 过了怎样的一天」摘要。
 *
 * 设计要点（对齐 SIM-11、runtime-overview.md 2.4 节）：
 * - 数据来自推演引擎（SimulationReadPort）的日常事件与心情。
 * - 缺席不足 P-18 的 12 小时时不调用模型，摘要最多列出 5 条窗口内事件。
 * - 摘要生成走后台网关（behavior_planning 用途，countAsBackground=true）。
 * - 后台预算耗尽时返回空摘要，不报错（SIM-11 第 3 条）。
 * - 幂等键按用户、会话及缺席起点区分，不同缺席窗口不复用旧摘要。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  type ModelGatewayPort,
  type ChatReadPort,
  Id,
  Timestamp,
  type TimelineSummaryResponse,
} from '@weiban/contracts';
import { CLOCK, AppError, type Clock } from '../../../platform/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import {
  SIMULATION_READ_PORT,
  type SimulationReadPort,
  type DailyEventEntry,
} from './simulation.js';

/** 离线时长不足此值（秒）时不生成摘要。 */
const MIN_OFFLINE_SECONDS = 12 * 3600;

/** 摘要生成最大输出 token（后台任务，回复较短）。 */
const SUMMARY_MAX_OUTPUT_TOKENS = 256;

@Injectable()
export class TimelineSummaryService {
  constructor(
    @Inject(SIMULATION_READ_PORT) private readonly simulation: SimulationReadPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CHAT_READ_PORT) private readonly chat: Pick<ChatReadPort, 'findDirectConversation'>,
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
    if (
      ![userId, characterId, conversationId].every((id) => Id.safeParse(id).success) ||
      !Timestamp.safeParse(lastActiveAt).success
    ) {
      throw new AppError('bad_request', '无效时间线请求');
    }
    const lastActiveMs = Date.parse(lastActiveAt);
    if (lastActiveMs > nowMs) throw new AppError('bad_request', '上次活跃时间不能晚于现在');
    const conversation = await this.chat.findDirectConversation(userId, characterId);
    if (conversation?.conversationId !== conversationId)
      throw new AppError('not_found', '找不到私聊会话');
    const offlineSeconds = Math.max(0, Math.floor((nowMs - lastActiveMs) / 1000));

    const currentMood = await this.simulation.getCurrentMood(userId, characterId);
    const entries: DailyEventEntry[] = [];
    // 时间线保留 90 天；只读取本次缺席窗口内的日报。
    const start = Math.max(lastActiveMs, nowMs - 90 * 86400_000);
    for (let date = Math.floor(start / 86400_000) * 86400_000; date <= nowMs; date += 86400_000) {
      entries.push(
        ...(await this.simulation.getDailyEvents(
          userId,
          characterId,
          new Date(date).toISOString().slice(0, 10),
        )),
      );
    }
    const events = entries
      .filter((e) => e.createdAt.getTime() > lastActiveMs && e.createdAt.getTime() <= nowMs)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq)
      .slice(0, 5);

    // 离线时长不足或缺席期间无事件时不生成摘要
    if (offlineSeconds < MIN_OFFLINE_SECONDS || events.length === 0) {
      return {
        summary: null,
        events: mapEvents(events),
        currentMood,
        offlineSeconds,
      };
    }

    // 调用模型生成摘要（behavior_planning 用途，计入后台预算）
    const idempotencyKey = `timeline:${userId}:${conversationId}:${lastActiveMs}`;
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
