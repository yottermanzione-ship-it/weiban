import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { MessageContent } from '@weiban/contracts';
import {
  fitReplyContents,
  fixedPrefix,
  lateRecoveryHint,
  permanentFailure,
  REPLY_WAIT_MAX_MS,
  retryableWait,
  waitRetryDelayMs,
} from './reply-delivery.js';

const text = (t: string): MessageContent => ({ type: 'text', text: t });
const sticker: MessageContent = {
  type: 'sticker',
  source: 'library',
  stickerId: '00000000-0000-4000-8000-000000000001',
  mediaId: '00000000-0000-4000-8000-000000000002',
  description: null,
};
const link = {
  type: 'link',
  url: 'https://example.com',
  title: '作品',
} as unknown as MessageContent;

describe('fitReplyContents：一次回复最多发 4 条（P-02）', () => {
  it('不超过 4 条时原样返回', () => {
    const contents = [text('一'), text('二'), sticker];
    expect(fitReplyContents(contents)).toBe(contents);
  });
  it('4 条文字 + 表情包：最后两条文字合并，表情包保留', () => {
    expect(fitReplyContents([text('一'), text('二'), text('三'), text('四'), sticker])).toEqual([
      text('一'),
      text('二'),
      text('三\n四'),
      sticker,
    ]);
  });
  it('4 条文字 + 链接 + 表情包：多出的文字都并进最后一条文字', () => {
    expect(
      fitReplyContents([text('一'), text('二'), text('三'), text('四'), link, sticker]),
    ).toEqual([text('一'), text('二\n三\n四'), link, sticker]);
  });
  it('撤回草稿 + 4 条：草稿原样留在第 1 条，不和正文合并', () => {
    const fitted = fitReplyContents(
      [text('唔，草'), text('一'), text('二'), text('三'), text('四')],
      fixedPrefix('recall'),
    );
    expect(fitted).toEqual([text('唔，草'), text('一'), text('二'), text('三\n四')]);
  });
  it('错字 + 更正 + 3 条：前两条不动', () => {
    const fitted = fitReplyContents(
      [text('我以经到了'), text('*已经'), text('二'), text('三'), text('四')],
      fixedPrefix('typo'),
    );
    expect(fitted).toEqual([text('我以经到了'), text('*已经'), text('二'), text('三\n四')]);
  });
  it('文字太长合并不下：先去掉表情包，再去掉链接', () => {
    const long = 'a'.repeat(2500);
    expect(fitReplyContents([text(long), text(long), text(long), text(long), sticker])).toEqual([
      text(long),
      text(long),
      text(long),
      text(long),
    ]);
    expect(
      fitReplyContents([text(long), text(long), text(long), link, text(long), sticker]),
    ).toEqual([text(long), text(long), text(long), text(long)]);
  });
  it('怎么都压不到 4 条时返回 null（调用方退回只发文字气泡）', () => {
    const long = 'a'.repeat(2500);
    expect(
      fitReplyContents(
        [text('唔'), text(long), text(long), text(long), text(long)],
        fixedPrefix('recall'),
      ),
    ).toBeNull();
  });
  it('合并后每条仍不超过 4000 字', () => {
    const fitted = fitReplyContents([
      text('a'.repeat(3000)),
      text('b'.repeat(900)),
      text('c'.repeat(3000)),
      text('d'.repeat(3000)),
      text('e'.repeat(99)),
    ])!;
    expect(fitted).toHaveLength(4);
    for (const c of fitted) expect(c.type === 'text' && c.text.length <= 4000).toBe(true);
  });
});

describe('permanentFailure：重试也不会好的失败', () => {
  const pg = (code: string) =>
    Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('pg'), { code }) });
  it('检查约束、非空、数据异常：直接结束', () => {
    expect(permanentFailure(pg('23514'))).toBe('db_23514');
    expect(permanentFailure(pg('23502'))).toBe('db_23502');
    expect(permanentFailure(pg('22001'))).toBe('db_22001');
    expect(permanentFailure(pg('22P02'))).toBe('db_22P02');
    expect(permanentFailure(Object.assign(new Error('x'), { code: '23514' }))).toBe('db_23514');
  });
  it('存档数据格式不对（ZodError）：直接结束', () => {
    const parsed = z.object({ a: z.string() }).safeParse({ a: 1 });
    expect(permanentFailure(parsed.error)).toBe('invalid_payload');
  });
  it('唯一约束、外键、并发冲突、连接错误：仍交给队列重试', () => {
    expect(permanentFailure(pg('23505'))).toBeNull();
    expect(permanentFailure(pg('23503'))).toBeNull();
    expect(permanentFailure(pg('40001'))).toBeNull();
    expect(permanentFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBeNull();
    expect(permanentFailure(new Error('timeout'))).toBeNull();
    expect(permanentFailure(null)).toBeNull();
  });
});

describe('等待中回复的巡检规则', () => {
  it('只有平台临时故障可由巡检重试；积分不足、没选模型等不碰', () => {
    expect(retryableWait('provider_unavailable')).toBe(true);
    expect(retryableWait('model_unavailable')).toBe(true);
    for (const f of [
      'insufficient_balance',
      'not_configured',
      'budget_exceeded',
      'policy_denied',
      'capability_missing',
      'output_guard',
      null,
    ])
      expect(retryableWait(f)).toBe(false);
  });
  it('退避：5、10、20、40、60 分钟封顶；最长等 6 小时', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map((n) => waitRetryDelayMs(n) / 60_000)).toEqual([
      5, 10, 20, 40, 60, 60, 60,
    ]);
    expect(REPLY_WAIT_MAX_MS).toBe(6 * 3600_000);
  });
  it('晚恢复的普通回复沿用「稍等」提示；刚失败就恢复、敏感场景、问候、积分不足的不加', () => {
    const base = {
      kind: 'message',
      retryEpoch: 1,
      failure: 'provider_unavailable',
      createdAt: new Date(0),
      nowMs: 10 * 60_000,
      sensitive: false,
    };
    expect(lateRecoveryHint(base)).toBe(true);
    expect(lateRecoveryHint({ ...base, nowMs: 60_000 })).toBe(false);
    expect(lateRecoveryHint({ ...base, sensitive: true })).toBe(false);
    expect(lateRecoveryHint({ ...base, kind: 'greeting' })).toBe(false);
    expect(lateRecoveryHint({ ...base, retryEpoch: 0 })).toBe(false);
    expect(lateRecoveryHint({ ...base, failure: 'insufficient_balance' })).toBe(false);
  });
});
