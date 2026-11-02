import { describe, expect, it } from 'vitest';
import {
  momentsReactDelayMs,
  planPeerPostReactions,
  planUserPostReactions,
  userPostLikeProbability,
} from './moments-reactions.js';

describe('用户发动态：点赞与评论分开排、各自去重（旧版：最多 4 个、评论最多 2 个 45%）', () => {
  const candidates = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      characterId: `c${i}`,
      familiarityLevel: 5,
      likeDraw: 0.01,
      commentDraw: 0.01,
    }));
  it('最多 4 个角色；评论最多 2 个', () => {
    const planned = planUserPostReactions(candidates(6));
    expect(planned).toHaveLength(4);
    expect(planned.filter((p) => p.comment)).toHaveLength(2);
    expect(planned.filter((p) => p.like)).toHaveLength(4);
  });
  it('点赞任务与评论任务分开：可以只点赞不评论、只评论不点赞', () => {
    const planned = planUserPostReactions([
      { characterId: 'like-only', familiarityLevel: 5, likeDraw: 0.01, commentDraw: 0.99 },
      { characterId: 'comment-only', familiarityLevel: 5, likeDraw: 1, commentDraw: 0.01 },
      { characterId: 'both', familiarityLevel: 5, likeDraw: 0.01, commentDraw: 0.01 },
      { characterId: 'neither', familiarityLevel: 5, likeDraw: 1, commentDraw: 0.99 },
    ]);
    expect(planned).toEqual([
      { characterId: 'like-only', like: true, comment: false },
      { characterId: 'comment-only', like: false, comment: true },
      { characterId: 'both', like: true, comment: true },
    ]);
  });
  it('熟悉度低的点赞概率低', () => {
    expect(userPostLikeProbability(1)).toBeCloseTo(0.35);
    expect(userPostLikeProbability(5)).toBe(1);
    const planned = planUserPostReactions([
      { characterId: 'low', familiarityLevel: 1, likeDraw: 0.5, commentDraw: 0.99 },
    ]);
    expect(planned).toEqual([]);
  });
});

describe('角色发动态：点赞前 2 个几乎总是、其余 45%，评论最多 1 个 35%（旧版）', () => {
  const candidates = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      characterId: `c${i}`,
      likeDraw: 0.01,
      commentDraw: 0.01,
    }));
  it('最多 5 个；评论最多 1 个', () => {
    const planned = planPeerPostReactions(candidates(7));
    expect(planned).toHaveLength(5);
    expect(planned.filter((p) => p.comment)).toHaveLength(1);
  });
  it('第 3 个起 45%：抽签 0.5 不点赞', () => {
    const planned = planPeerPostReactions([
      { characterId: 'a', likeDraw: 0.9, commentDraw: 0.99 },
      { characterId: 'b', likeDraw: 0.9, commentDraw: 0.99 },
      { characterId: 'c', likeDraw: 0.5, commentDraw: 0.99 },
      { characterId: 'd', likeDraw: 0.4, commentDraw: 0.99 },
    ]);
    expect(planned.map((p) => p.characterId)).toEqual(['a', 'b', 'd']);
  });
});

describe('延迟：1–15 分钟', () => {
  it('两端与中间值', () => {
    expect(momentsReactDelayMs(0)).toBe(60_000);
    expect(momentsReactDelayMs(1)).toBe(15 * 60_000);
    expect(momentsReactDelayMs(0.5)).toBe(8 * 60_000);
    expect(momentsReactDelayMs(-1)).toBe(60_000);
    expect(momentsReactDelayMs(2)).toBe(15 * 60_000);
  });
});
