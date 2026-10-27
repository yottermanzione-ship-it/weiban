/** 批 EJ：记忆整理截断后先救已完整条目、拆小批只重试一次；输出上限按条数给；已有记忆精简。 */
import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from '@weiban/contracts';
import { compactMemories, memoryOutputTokens, memoryShrink } from './memory.js';
import { salvageOperations } from '../domain/memory.js';

const A = '018f0000-0000-7000-8000-000000000001';
const B = '018f0000-0000-7000-8000-000000000002';

describe('记忆整理批次', () => {
  it('输出上限按条数给、最多 3200；拆小批只有一级', () => {
    expect(memoryOutputTokens(0)).toBe(1000);
    expect(memoryOutputTokens(25)).toBe(1600);
    expect(memoryOutputTokens(100)).toBe(3200);
    expect(memoryShrink(undefined)).toBe(0);
    expect(memoryShrink(1)).toBe(1);
    expect(memoryShrink(9)).toBe(1);
    expect(memoryShrink(-1)).toBe(0);
  });
});

describe('从没写完的 JSON 里救条目', () => {
  const op = (id: string, content: string) =>
    JSON.stringify({
      action: 'ADD',
      content,
      category: 'preference',
      importance: 5,
      sourceMessageIds: [id],
    });

  it('只收已闭合且合格的条目，写到一半的最后一条不要', () => {
    const text = `{"operations":[${op(A, '喜欢{猫}和"雨"天')},${op(B, '在学吉他')},{"action":"ADD","content":"没写`;
    const ops = salvageOperations(text);
    expect(ops.map((o) => o.content)).toEqual(['喜欢{猫}和"雨"天', '在学吉他']);
  });

  it('不合格的条目跳过；没有 operations 或一条都没写完返回空', () => {
    const bad = JSON.stringify({ action: 'ADD', content: '', category: 'x', sourceMessageIds: [] });
    expect(salvageOperations(`{"operations":[${bad},${op(A, '有效')}`).length).toBe(1);
    expect(salvageOperations('{"summary":"x"')).toEqual([]);
    expect(salvageOperations('{"operations":[{"action":"AD')).toEqual([]);
  });
});

describe('给整理看的已有记忆', () => {
  it('只留去重需要的字段，不带来源消息 ID、knownBy、时间戳', () => {
    const entry = {
      memoryId: A,
      characterId: B,
      category: 'basic',
      content: '住在杭州',
      status: 'current',
      importance: 6,
      dueAt: null,
      visibility: 'default',
      sharingClass: 'never',
      scope: 'normal',
      sourceMessageIds: Array.from({ length: 100 }, () => A),
      createdBy: 'user_manual',
      knownBy: [B],
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    } as MemoryEntry;
    const [compact] = compactMemories([entry]);
    expect(compact).toEqual({
      memoryId: A,
      content: '住在杭州',
      category: 'basic',
      status: 'current',
      importance: 6,
      manual: true,
    });
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(entry).length / 10);
  });
});
