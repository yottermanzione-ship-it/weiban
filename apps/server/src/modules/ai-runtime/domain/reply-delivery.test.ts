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

describe('fitReplyContents：一次回复文字最多 6 条、总共最多 8 条（P-02，T-20261103h）', () => {
  const photo: MessageContent = {
    type: 'image',
    mediaId: '00000000-0000-4000-8000-000000000003',
    width: null,
    height: null,
  };
  const six = () => ['一', '二', '三', '四', '五', '六'].map(text);
  it('6 条文字 + 表情包 = 7 条：不超过 8 条，原样返回', () => {
    const contents = [...six(), sticker];
    expect(fitReplyContents(contents)).toBe(contents);
  });
  it('6 条文字 + 照片、6 条文字 + 链接都是 7 条：照片和链接也只算一条，原样发', () => {
    for (const extra of [photo, link]) {
      const contents = [...six(), extra];
      expect(fitReplyContents(contents)).toBe(contents);
    }
  });
  it('撤回草稿 + 6 条、错字 + 更正 + 5 条都是 7 条：原样返回', () => {
    const recall = [text('唔，一'), ...six()];
    expect(fitReplyContents(recall, fixedPrefix('recall'))).toBe(recall);
    const typo = [text('我以经到了'), text('*已经'), ...six().slice(1)];
    expect(fitReplyContents(typo, fixedPrefix('typo'))).toBe(typo);
  });
  it('正好 8 条时原样返回', () => {
    const contents = [...six(), text('七'), sticker];
    expect(fitReplyContents(contents)).toBe(contents);
  });
  it('超过 8 条：先从后往前合并相邻文字，附加内容都保留', () => {
    expect(fitReplyContents([...six(), link, photo, sticker])).toEqual([
      text('一'),
      text('二'),
      text('三'),
      text('四'),
      text('五\n六'),
      link,
      photo,
      sticker,
    ]);
    // 10 条：多出的文字都并进靠后的文字里。
    expect(fitReplyContents([...six(), text('七'), text('八'), text('九'), sticker])).toEqual([
      ...six().slice(0, 5),
      text('六'),
      text('七\n八\n九'),
      sticker,
    ]);
  });
  it('撤回草稿、错字和更正原样留在前面，不和正文合并', () => {
    const eight = [...six(), text('七'), text('八')];
    expect(fitReplyContents([text('唔，一'), ...eight], fixedPrefix('recall'))).toEqual([
      text('唔，一'),
      ...six().slice(0, 5),
      text('六'),
      text('七\n八'),
    ]);
    expect(
      fitReplyContents([text('我以经到了'), text('*已经'), ...eight.slice(1)], fixedPrefix('typo')),
    ).toEqual([text('我以经到了'), text('*已经'), ...eight.slice(1, 6), text('七\n八')]);
  });
  it('文字太长合并不下：从后往前先去掉表情包，再去掉链接', () => {
    const long = text('a'.repeat(2500));
    const sevenLong = Array<MessageContent>(7).fill(long);
    expect(fitReplyContents([...sevenLong, link, long, sticker])).toEqual(
      Array<MessageContent>(8).fill(long),
    );
    // 照片和表情包一样可以去掉；只多一条时只去最后那一个。
    const sixLong = Array<MessageContent>(6).fill(long);
    expect(fitReplyContents([...sixLong, long, photo, sticker])).toEqual([...sixLong, long, photo]);
  });
  it('怎么都压不到 8 条时返回 null（调用方退回只发文字气泡，文字本身不超过 6 条）', () => {
    const long = text('a'.repeat(2500));
    expect(
      fitReplyContents([text('唔'), ...Array<MessageContent>(8).fill(long)], fixedPrefix('recall')),
    ).toBeNull();
  });
  it('合并后每条仍不超过 4000 字', () => {
    const fitted = fitReplyContents([
      text('a'.repeat(3000)),
      text('b'.repeat(900)),
      ...['c', 'd', 'e', 'f', 'g', 'h', 'i'].map((c) => text(c.repeat(3000))),
    ])!;
    expect(fitted).toHaveLength(8);
    // 从后往前找：第一对合得下的是 b（900 字）和 c（3000 字），a 不动。
    expect(fitted[0]).toEqual(text('a'.repeat(3000)));
    expect(fitted[1]).toEqual(text(`${'b'.repeat(900)}\n${'c'.repeat(3000)}`));
    for (const c of fitted) expect(c.type === 'text' && c.text.length <= 4000).toBe(true);
  });
  it('显式传入更小的上限时按传入的封顶', () => {
    expect(fitReplyContents([text('一'), text('二'), text('三'), sticker], 0, 3)).toEqual([
      text('一'),
      text('二\n三'),
      sticker,
    ]);
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
