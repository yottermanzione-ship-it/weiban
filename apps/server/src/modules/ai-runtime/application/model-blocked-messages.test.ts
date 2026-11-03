/**
 * T-20261103j：被上游安全策略拦过的消息不再发给模型——登记范围与排除规则（不连数据库，假的 SQL 执行器）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BLOCKED_PER_REPLY,
  blockedSeqs,
  recordBlocked,
  turnUserSeqs,
  withoutBlocked,
} from './model-blocked-messages.js';

const msg = (seq: number, senderKind: string, status = 'normal') => ({ seq, senderKind, status });
type Runner = Parameters<typeof blockedSeqs>[0];
/** 假的 SQL 执行器：返回给定的已登记序号（或给定的行）。 */
function fake(rows: () => Promise<{ rows: unknown[] }>) {
  const query = vi.fn(rows);
  return Object.assign({ query } as unknown as Runner, { mock: query });
}
const runner = (seqs: number[]) =>
  fake(async () => ({ rows: seqs.map((seq) => ({ seq: String(seq) })) }));

describe('turnUserSeqs：这次回复针对的用户消息', () => {
  it('只取上一条角色消息之后、状态正常的用户消息', () => {
    const history = [
      msg(1, 'user'),
      msg(2, 'character'),
      msg(3, 'user'),
      msg(4, 'system'),
      msg(5, 'user', 'recalled'),
      msg(6, 'user'),
    ];
    expect(turnUserSeqs(history)).toEqual([3, 6]);
    expect(turnUserSeqs([msg(1, 'user'), msg(2, 'user')])).toEqual([1, 2]);
    expect(turnUserSeqs([msg(1, 'user'), msg(2, 'character')])).toEqual([]);
  });

  it('连发很多条时只取最近的上限条数', () => {
    const many = Array.from({ length: MAX_BLOCKED_PER_REPLY + 10 }, (_, i) => msg(i + 1, 'user'));
    const seqs = turnUserSeqs(many);
    expect(seqs).toHaveLength(MAX_BLOCKED_PER_REPLY);
    expect(seqs.at(-1)).toBe(MAX_BLOCKED_PER_REPLY + 10);
  });
});

describe('withoutBlocked：按序号排除，其余照常', () => {
  it('去掉登记过的序号，顺序不变', async () => {
    const history = [msg(1, 'user'), msg(2, 'character'), msg(3, 'user'), msg(4, 'character')];
    const db = runner([3]);
    expect((await withoutBlocked(db, 'c', history)).map((m) => m.seq)).toEqual([1, 2, 4]);
    expect(db.mock).toHaveBeenCalledWith(expect.stringContaining('model_blocked_messages'), ['c']);
  });

  it('没有登记、空列表、读登记表失败：原样返回（不排除，不让回复失败）', async () => {
    const history = [msg(1, 'user')];
    expect(await withoutBlocked(runner([]), 'c', history)).toBe(history);
    const unused = runner([1]);
    expect(await withoutBlocked(unused, 'c', [])).toEqual([]);
    expect(unused.mock).not.toHaveBeenCalled();
    const broken = fake(async () => {
      throw Error('relation does not exist');
    });
    expect(await withoutBlocked(broken, 'c', history)).toBe(history);
    expect((await blockedSeqs(broken, 'c')).size).toBe(0);
  });
});

describe('recordBlocked：登记', () => {
  it('去重、丢掉非法序号；没有可登记的不发 SQL', async () => {
    const db = fake(async () => ({ rows: [{ seq: '7' }, { seq: '9' }] }));
    const base = {
      userId: 'u',
      characterId: 'ch',
      conversationId: 'c',
      planId: 'p',
      source: 'auto' as const,
      at: new Date('2026-11-03T10:19:00Z'),
    };
    expect(await recordBlocked(db, { ...base, seqs: [7, 9, 9, 0, -1, 1.5] })).toBe(2);
    expect(db.mock).toHaveBeenCalledTimes(1);
    const [sql, params] = db.mock.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (conversation_id, seq) DO NOTHING');
    expect(params).toEqual(['c', 'u', 'ch', 'auto', 'p', base.at, [7, 9]]);
    db.mock.mockClear();
    expect(await recordBlocked(db, { ...base, seqs: [0] })).toBe(0);
    expect(db.mock).not.toHaveBeenCalled();
  });
});
