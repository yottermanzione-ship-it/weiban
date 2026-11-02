/**
 * 朋友圈点赞 / 评论分开排期（对照表 v3 §4，照抄旧版）：
 * 点赞任务与评论任务分开、各自延迟 1–15 分钟、各自去重键； caps 按旧版。
 * 2026-11-03（T-20261103b）：三种互动是基础层，不看生态闸门；只看账号正常、角色在通讯录里。
 * 只用桩，不发起真实模型调用、不碰数据库。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MomentsAiService } from './moments-ai.js';

const USER = '00000000-0000-4000-8000-000000000001';

function moments(options: {
  levels?: Record<string, number>;
  /** 不在通讯录里的角色。 */
  notFriends?: string[];
  accountStatus?: 'active' | 'deleted';
  banned?: boolean;
  related?: Array<{ characterId: string; closeness: string }>;
}) {
  const send = vi.fn(async () => undefined);
  // 生态闸门一律回答「关着」：基础层不该问它，问了也不能影响排期。
  const isActive = vi.fn(async () => false);
  const service = Object.create(MomentsAiService.prototype) as MomentsAiService;
  Object.assign(service, {
    jobs: { send },
    growth: {
      getFamiliarity: vi.fn(async (_u: string, id: string) => ({
        level: options.levels?.[id] ?? 1,
      })),
    },
    ecology: { isActive },
    accounts: {
      getAccountStatus: vi.fn(async () => options.accountStatus ?? 'active'),
      isBanned: vi.fn(async () => options.banned ?? false),
    },
    contacts: {
      getActiveContact: vi.fn(async (_u: string, id: string) =>
        options.notFriends?.includes(id) ? null : { characterId: id },
      ),
    },
    relations: {
      getRelation: vi.fn(async () => ({ closeness: 'close' })),
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
  return { service, send, isActive };
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

  it('基础层：生态没开也照样排，且不去问生态闸门', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const { service, send, isActive } = moments({ levels: { c1: 5, c2: 5 } });
    await service.onPostCreated({
      postId: 'post-0',
      ownerUserId: USER,
      authorKind: 'user',
      authorCharacterId: null,
      visibleCharacterIds: ['c1', 'c2'],
    });
    expect(sentJobs(send)).toHaveLength(4);
    expect(isActive).not.toHaveBeenCalled();
  });

  it('账号不正常或被封禁时一个都不排', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    for (const opts of [{ accountStatus: 'deleted' as const }, { banned: true }]) {
      const { service, send } = moments({ levels: { c1: 5 }, ...opts });
      await service.onPostCreated({
        postId: 'post-x',
        ownerUserId: USER,
        authorKind: 'user',
        authorCharacterId: null,
        visibleCharacterIds: ['c1'],
      });
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('不在通讯录里的角色不排', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const { service, send } = moments({
      levels: { c1: 5, c2: 5 },
      notFriends: ['c1'],
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

describe('角色之间接梗回复：基础层', () => {
  const payload = {
    postId: 'post-5',
    commentId: 'comment-1',
    ownerUserId: USER,
    postAuthorKind: 'character' as const,
    postAuthorCharacterId: 'author',
    authorKind: 'character' as const,
    authorCharacterId: 'friend',
    replyToKind: null,
    replyToCharacterId: null,
  };

  it('生态没开也会排回复任务，不问生态闸门', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const { service, send, isActive } = moments({});
    await service.onCommentCreated(payload);
    expect(sentJobs(send).map((j) => j.job)).toEqual([
      expect.objectContaining({ characterId: 'author', action: 'reply' }),
    ]);
    expect(isActive).not.toHaveBeenCalled();
  });

  it('被回复的角色不在通讯录里就不排', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const { service, send } = moments({ notFriends: ['author'] });
    await service.onCommentCreated(payload);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('执行互动：费用由用户承担，积分不足跳过', () => {
  const post = {
    postId: 'post-6',
    text: '今天去看海了',
    images: [],
    likes: [],
    comments: [],
    author: { kind: 'user' as const, refId: USER },
    createdAt: '2026-11-03T08:00:00.000Z',
    forwardedPublic: false,
  };

  function reactService(generate: () => Promise<unknown>) {
    const generateText = vi.fn((_request: unknown) => generate());
    const comment = vi.fn(async () => ({ ok: true, value: { commentId: 'cm-1' } }));
    const like = vi.fn(async () => undefined);
    const service = Object.create(MomentsAiService.prototype) as MomentsAiService;
    Object.assign(service, {
      accounts: { getAccountStatus: vi.fn(async () => 'active') },
      contacts: { getActiveContact: vi.fn(async () => ({ characterId: 'c1' })) },
      billing: { getSpendStatus: vi.fn(async () => ({ insufficient: false })) },
      moments: { getPostVisibleToCharacter: vi.fn(async () => post) },
      writer: { like, comment },
      characters: {
        getForRuntime: vi.fn(async () => ({ profile: { name: '小林' }, card: null, legacy: null })),
        getProfiles: vi.fn(async () => []),
      },
      policy: {
        getCharacterPolicy: vi.fn(async () => ({
          isRealPerson: false,
          isMinor: false,
          romanceAllowed: true,
        })),
      },
      identity: { getProfile: vi.fn(async () => ({ nickname: '晓晓' })) },
      growth: { getFamiliarity: vi.fn(async () => ({ level: 2 })) },
      relations: { getRelation: vi.fn(async () => null) },
      gateway: { generateText },
      db: {},
    });
    return { service, generateText, comment };
  }

  it('评论按后台消耗扣用户积分（countAsBackground），不再标成生态任务', async () => {
    const { service, generateText, comment } = reactService(async () => ({
      ok: true,
      value: { text: '好想去！', chargedMicros: 12, modelKey: 'm' },
    }));
    await service.runReact({
      userId: USER,
      postId: 'post-6',
      characterId: 'c1',
      action: 'comment',
    });
    const request = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect(request).toMatchObject({ billingOwner: 'user', countAsBackground: true });
    expect(request).not.toHaveProperty('ecologyTask');
    expect(comment).toHaveBeenCalledTimes(1);
  });

  it('积分不足 / 后台额度用完：跳过，不写评论、不抛错（必回也不重试）', async () => {
    for (const error of ['insufficient_balance', 'budget_exceeded']) {
      const { service, comment } = reactService(async () => ({ ok: false, error }));
      await expect(
        service.runReact({
          userId: USER,
          postId: 'post-6',
          characterId: 'c1',
          action: 'comment',
          mustReply: true,
        }),
      ).resolves.toBeUndefined();
      expect(comment).not.toHaveBeenCalled();
    }
  });

  it('真正的生成失败仍让必回任务重试', async () => {
    const { service } = reactService(async () => ({ ok: false, error: 'provider_unavailable' }));
    await expect(
      service.runReact({
        userId: USER,
        postId: 'post-6',
        characterId: 'c1',
        action: 'comment',
        mustReply: true,
      }),
    ).rejects.toThrow(/generation failed/);
  });
});
