/**
 * 朋友圈点赞 / 评论分开排期（对照表 v3 §4，照抄旧版）：
 * 点赞任务与评论任务分开、各自延迟 1–15 分钟、各自去重键； caps 按旧版。
 * 只用桩，不发起真实模型调用、不碰数据库。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MomentsAiService } from './moments-ai.js';

const USER = '00000000-0000-4000-8000-000000000001';

function moments(options: {
  levels?: Record<string, number>;
  active?: Record<string, boolean>;
  related?: Array<{ characterId: string; closeness: string }>;
}) {
  const send = vi.fn(async () => undefined);
  const service = Object.create(MomentsAiService.prototype) as MomentsAiService;
  Object.assign(service, {
    jobs: { send },
    growth: {
      getFamiliarity: vi.fn(async (_u: string, id: string) => ({
        level: options.levels?.[id] ?? 1,
      })),
    },
    ecology: {
      isActive: vi.fn(async (_u: string, id: string) => options.active?.[id] ?? true),
    },
    social: {
      relatedContacts: vi.fn(async () => ({
        added: (options.related ?? []).map((r) => ({
          characterId: r.characterId,
          relation: { closeness: r.closeness },
        })),
      })),
    },
  });
  return { service, send };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function sentJobs(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map((c) => ({
    job: c[1] as { characterId: string; action: string },
    delayMs: (c[2] as { delayMs: number }).delayMs,
    key: (c[2] as { singletonKey: string }).singletonKey,
  }));
}

describe('用户发动态：点赞与评论分开排', () => {
  it('最多 4 个角色、评论最多 2 个；点赞与评论是两个任务、去重键分开、延迟 1–15 分钟', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    const { service, send } = moments({
      levels: { c1: 5, c2: 5, c3: 5, c4: 5, c5: 5, c6: 5 },
    });
    await service.onPostCreated({
      postId: 'post-1',
      ownerUserId: USER,
      authorKind: 'user',
      authorCharacterId: null,
      visibleCharacterIds: ids,
    });
    const jobs = sentJobs(send);
    expect(jobs.filter((j) => j.job.action === 'like')).toHaveLength(4);
    expect(jobs.filter((j) => j.job.action === 'comment')).toHaveLength(2);
    expect(jobs.map((j) => j.job.characterId)).toEqual(['c1', 'c1', 'c2', 'c2', 'c3', 'c4']);
    // 去重键分开：点赞任务跑了不影响评论任务。
    expect(new Set(jobs.map((j) => j.key)).size).toBe(jobs.length);
    expect(jobs.every((j) => j.key.startsWith(`moments-${j.job.action}:post-1:`))).toBe(true);
    expect(jobs.every((j) => j.delayMs >= 60_000 && j.delayMs <= 15 * 60_000)).toBe(true);
  });

  it('谁都不中时，熟悉度最高的 L2+ 角色兜底互动（点赞 + 评论分开排）', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { service, send } = moments({ levels: { c1: 3, c2: 1 } });
    await service.onPostCreated({
      postId: 'post-2',
      ownerUserId: USER,
      authorKind: 'user',
      authorCharacterId: null,
      visibleCharacterIds: ['c1', 'c2'],
    });
    const jobs = sentJobs(send);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.job.action).sort()).toEqual(['comment', 'like']);
    expect(jobs.every((j) => j.job.characterId === 'c1')).toBe(true);
  });

  it('生态关着的角色不排', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const { service, send } = moments({
      levels: { c1: 5, c2: 5 },
      active: { c1: false },
    });
    await service.onPostCreated({
      postId: 'post-3',
      ownerUserId: USER,
      authorKind: 'user',
      authorCharacterId: null,
      visibleCharacterIds: ['c1', 'c2'],
    });
    const jobs = sentJobs(send);
    expect(jobs.every((j) => j.job.characterId === 'c2')).toBe(true);
    expect(jobs).toHaveLength(2);
  });
});

describe('角色发动态：点赞与评论分开排', () => {
  it('最多 5 个、评论最多 1 个；按亲疏排序，前 2 个优先', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const related = [
      { characterId: 'a1', closeness: 'acquaintance' },
      { characterId: 'a2', closeness: 'close' },
      { characterId: 'a3', closeness: 'familiar' },
      { characterId: 'a4', closeness: 'close' },
      { characterId: 'a5', closeness: 'acquaintance' },
      { characterId: 'a6', closeness: 'familiar' },
      { characterId: 'a7', closeness: 'close' },
    ];
    const { service, send } = moments({ related });
    await service.onPostCreated({
      postId: 'post-4',
      ownerUserId: USER,
      authorKind: 'character',
      authorCharacterId: 'author',
      visibleCharacterIds: [],
    });
    const jobs = sentJobs(send);
    expect(jobs.filter((j) => j.job.action === 'like')).toHaveLength(5);
    expect(jobs.filter((j) => j.job.action === 'comment')).toHaveLength(1);
    // 评论给亲疏最高的第一个。
    expect(jobs.find((j) => j.job.action === 'comment')?.job.characterId).toBe('a2');
    expect(new Set(jobs.map((j) => j.key)).size).toBe(jobs.length);
  });
});
