/**
 * T-20261103e 私聊回复送达的几条硬规则（纯函数，回复引擎与计划存储共用）：
 * - 一次回复最终发出的条数封顶 P-02（表情包、照片、链接、撤回草稿、错字更正都算一条）；
 * - 确定性失败（违反数据库约束、存档数据格式不对）重试多少次都一样，直接结束计划；
 * - 模型临时不可用而进入等待的计划由定时巡检退避重试，最长等 6 小时，超时作废不再回复。
 */
import type { MessageContent } from '@weiban/contracts';
import { P02_SPLIT_BUBBLES } from '../../../platform/index.js';
import type { QuirkKind } from './quirks.js';

/** 单条文字消息的上限（契约 TextContent.text ≤ 4000）。 */
const TEXT_MAX = 4000;

/** 撤回草稿（第 1 条）、错字和更正（前 2 条）要原样保留，不参与合并。 */
export function fixedPrefix(quirk: QuirkKind): number {
  return quirk === 'recall' ? 1 : quirk === 'typo' ? 2 : 0;
}

/**
 * 把最终要发的内容压到 P-02 上限（4 条）以内。
 * 1. 从后往前把相邻两条文字合并成一条（换行连接，合并后仍 ≤ 4000 字），前 keep 条不动；
 * 2. 合并不下时，从后往前去掉表情包、照片（T-20261103g）、链接这类附加内容；
 * 3. 仍超出（几条超长文字挤在一起）返回 null，调用方退回只发文字气泡（文字气泡本身 ≤ 4 条）。
 * 没超出时原样返回（同一个数组）。
 */
export function fitReplyContents(
  contents: MessageContent[],
  keep = 0,
  max: number = P02_SPLIT_BUBBLES.maxBubbles,
): MessageContent[] | null {
  if (contents.length <= max) return contents;
  const out = [...contents];
  while (out.length > max) {
    let merged = false;
    for (let i = out.length - 1; i > keep; i--) {
      const a = out[i - 1]!;
      const b = out[i]!;
      if (a.type === 'text' && b.type === 'text' && a.text.length + 1 + b.text.length <= TEXT_MAX) {
        out.splice(i - 1, 2, { type: 'text', text: `${a.text}\n${b.text}` });
        merged = true;
        break;
      }
    }
    if (merged) continue;
    let extra = -1;
    for (let i = out.length - 1; i >= keep; i--)
      if (['sticker', 'image', 'link'].includes(out[i]!.type)) {
        extra = i;
        break;
      }
    if (extra < 0) return null;
    out.splice(extra, 1);
  }
  return out;
}

/**
 * 重试也不会好的失败，返回写进 failure 的原因；其余返回 null（照常交给任务队列重试）。
 * - PostgreSQL 22 类（数据异常，如超长、越界、格式不对）、23502（非空）、23514（检查约束）：
 *   同样的数据再写一次还是失败；
 * - 唯一约束 23505、外键 23503 可能是并发先后造成的，仍按普通错误重试；
 * - ZodError：密文里存的输入 / 结果格式不对，重读还是同一份。
 * Drizzle 会把驱动的错误包在 cause 里，所以顺着 cause 往下找。
 */
export function permanentFailure(error: unknown): string | null {
  for (
    let e: unknown = error, depth = 0;
    typeof e === 'object' && e !== null && depth < 8;
    e = (e as { cause?: unknown }).cause, depth++
  ) {
    if ((e as { name?: unknown }).name === 'ZodError') return 'invalid_payload';
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^(22[0-9A-Z]{3}|23502|23514)$/.test(code)) return `db_${code}`;
  }
  return null;
}

/**
 * 进入等待后由巡检自动重试的失败：都是平台这边的临时故障，用户自己处理不了，重试失败也不扣费。
 * 积分不足（insufficient_balance）、没选模型（not_configured）这类要用户自己处理的，仍只由原触发点恢复；
 * 被拒绝、能力不够、请求过大这类重试也不会变的，不在其中。
 */
export const RETRYABLE_WAIT_FAILURES = ['provider_unavailable', 'model_unavailable'] as const;
export function retryableWait(failure: string | null | undefined): boolean {
  return (RETRYABLE_WAIT_FAILURES as readonly string[]).includes(failure ?? '');
}
/** 最长等待：从用户发消息算起 6 小时，超时作废，免得几天后突然冒出一条回复。 */
export const REPLY_WAIT_MAX_MS = 6 * 3600_000;
/** 巡检间隔（cron）：每 5 分钟一次。 */
export const REPLY_WAIT_SWEEP_CRON = '*/5 * * * *';
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 60 * 60_000;
/** 第 attempt 次（从 0 起，用 retryEpoch）进入等待后，隔多久再试：5、10、20、40、60、60… 分钟。 */
export function waitRetryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, Math.min(10, attempt)));
}

/** 沿用「已读不回」小巧思的提示：本轮你有意稍等了一会儿。 */
export const DELIBERATE_WAIT_HINT =
  '本轮你有意稍等了一会儿再回复。按人设自然体现稍微晾了一下，不要假装没看到；不得冷落、责怪或操纵用户。';
/** 距用户发消息超过 3 分钟才算「晚回」（与时间感知「距上一条消息」的门槛一致）。 */
const LATE_AFTER_MS = 3 * 60_000;

/**
 * 从临时故障的等待里恢复、而且确实晚了的普通回复，沿用「有意稍等了一会儿」的提示。
 * 关怀、疑似风险、涉及健康、树洞和严肃场景不加（与小巧思同一条安全线，由调用方传入）。
 */
export function lateRecoveryHint(input: {
  kind: string;
  retryEpoch: number;
  failure: string | null;
  createdAt: Date;
  nowMs: number;
  sensitive: boolean;
}): boolean {
  return (
    input.kind === 'message' &&
    input.retryEpoch > 0 &&
    retryableWait(input.failure) &&
    !input.sensitive &&
    input.nowMs - input.createdAt.getTime() >= LATE_AFTER_MS
  );
}
