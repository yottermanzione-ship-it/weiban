/**
 * T-20261104a（总经理 11-04「用户之间的拦截互不影响」）：同一用户反复被私密模型服务商拦截时，只限制他自己。
 *
 * 为什么：私密模型的上游账号是所有用户共用的。某个用户反复发会被服务商安全策略拦下的内容，
 * 服务商可能因此限制整个账号、连累别的用户。所以这个用户被拦次数多了以后，先暂停替他请求服务商。
 *
 * 规则（三个数只在 platform/config/product-params.ts 的 PRIVATE_BLOCK_LIMIT 定义）：
 * - 计数：model_access.usage_records 里这个用户私密模型调用（model_role = adult）被服务商拦下
 *   （error_code = content_rejected）的记录。每次真正发给服务商、被拦下的调用一条，含密钥自检通过后改按内容被拒的
 *   401 / 403。不新建表。
 * - 某一次被拦时，往前 windowMs 内（含这一次）累计达到 threshold 次 → 从这一次起 limitMs 内受限。
 * - 受限期间：这个用户的私密回复（modelRole = adult、purpose = chat_reply）不请求服务商，网关直接返回 content_rejected：
 *   不冻结、不扣费、不写用量记录。所以受限期间的回复不会让限制自己延长。
 * - 只按用户 ID 判断，其他用户完全不受影响。不存内存状态：每次按用量记录推算，进程重启不丢。
 *
 * 为什么只限私密回复：私密回复是唯一把「还没被服务商检验过的新用户消息」发给共用私密账号的调用。
 * 回复被拦（含受限）时回复引擎会登记这一轮的用户消息（ai_runtime.model_blocked_messages），记忆整理、摘要、
 * 主动消息等后台调用都不再带上它们，所以那些调用只会带已经被服务商放行过的内容，不必一起限制。
 * 安全判断与关怀回合（safety_check / safety_followup）安全优先，永远照常调用。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { GenerateTextInput } from '@weiban/contracts';
import { and, desc, eq, gte } from 'drizzle-orm';
import {
  CLOCK,
  DATABASE,
  LOGGER,
  PRIVATE_BLOCK_LIMIT,
  type Clock,
  type Database,
  type Logger,
} from '../../../platform/index.js';
import { usageRecords } from '../infra/db/schema.js';

/** 推算时最多读最近多少条拦截记录（够判断最近的一次限制）。 */
const MAX_ROWS = 200;

export interface BlockLimitParams {
  threshold: number;
  windowMs: number;
  limitMs: number;
}

/**
 * 按拦截时间（毫秒，升序）推算限制到期时间：最后一次「往前 windowMs 内累计达到 threshold 次」的拦截时间 + limitMs。
 * 没有达到过阈值返回 null。count = 那一次往前 windowMs 内的拦截次数（只写日志用）。
 */
export function blockLimitUntil(
  times: readonly number[],
  params: BlockLimitParams = PRIVATE_BLOCK_LIMIT,
): { untilMs: number; count: number } | null {
  let hit: { untilMs: number; count: number } | null = null;
  let start = 0;
  for (let i = 0; i < times.length; i++) {
    while (times[i]! - times[start]! > params.windowMs) start++;
    const count = i - start + 1;
    if (count >= params.threshold) hit = { untilMs: times[i]! + params.limitMs, count };
  }
  return hit;
}

/** 受这条规则管的调用：用户付费的私密回复。 */
export function blockLimitApplies(
  input: Pick<GenerateTextInput, 'modelRole' | 'purpose' | 'billingOwner'>,
): boolean {
  return (
    input.modelRole === 'adult' && input.purpose === 'chat_reply' && input.billingOwner === 'user'
  );
}

@Injectable()
export class PrivateBlockLimiter {
  private readonly log: Logger;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'model_access' });
  }

  /** 这个用户现在是否受限；受限返回到期时间与触发时的拦截次数。读不到用量记录时按不受限处理。 */
  async limitedUntil(userId: string): Promise<{ until: Date; count: number } | null> {
    const now = this.clock.nowMs();
    const since = new Date(now - PRIVATE_BLOCK_LIMIT.windowMs - PRIVATE_BLOCK_LIMIT.limitMs);
    let times: number[];
    try {
      const rows = await this.database.db
        .select({ at: usageRecords.createdAt })
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.userId, userId),
            gte(usageRecords.createdAt, since),
            eq(usageRecords.modelRole, 'adult'),
            eq(usageRecords.errorCode, 'content_rejected'),
          ),
        )
        .orderBy(desc(usageRecords.createdAt))
        .limit(MAX_ROWS);
      times = rows.map((r) => r.at.getTime()).reverse();
    } catch {
      return null;
    }
    const hit = blockLimitUntil(times);
    if (!hit || hit.untilMs <= now) return null;
    return { until: new Date(hit.untilMs), count: hit.count };
  }

  /**
   * 网关调用前问一次：这次调用要不要跳过服务商（直接按 content_rejected 处理）。
   * 跳过时打一条结构化日志，只有用户 ID、次数和到期时间，不含任何内容。
   */
  async skips(
    input: Pick<GenerateTextInput, 'userId' | 'modelRole' | 'purpose' | 'billingOwner'>,
  ): Promise<boolean> {
    if (!blockLimitApplies(input)) return false;
    const limited = await this.limitedUntil(input.userId);
    if (!limited) return false;
    this.log.warn(
      {
        code: 'private_block_limited',
        userId: input.userId,
        blockedCount: limited.count,
        limitedUntil: limited.until.toISOString(),
      },
      '该用户私密回复近期多次被服务商拦截，限制期内不再请求服务商，直接回推托语',
    );
    return true;
  }
}
