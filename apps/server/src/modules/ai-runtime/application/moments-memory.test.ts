/**
 * 私人朋友圈读记忆与写回（2026-10-31 04:42 / 04:53 决定）的单元测试。
 * 只用替身，不连数据库：数据库集成部分（迁移、真实写库）须等 PR 的 CI。
 * 不碰 private-digest-quarantine 测试。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildMomentsExtractionInput,
  isSharedPublicDraft,
  isSharedPublicDraftText,
  MOMENTS_MEMORY_JOB,
  momentsMemoryBatchId,
  momentsMemoryJobData,
  MomentsMemoryService,
  sendMomentsMemoryJob,
  shouldUseBrainPrefix,
  validateMomentsExtraction,
} from './moments-memory.js';
import type { MomentsPost } from '@weiban/contracts';

const USER = '00000000-0000-4000-8000-000000000001';
const CHAR = '00000000-0000-4000-8000-000000000002';
const POST = '00000000-0000-4000-8000-000000000003';
const COMMENT = '00000000-0000-4000-8000-000000000004';
const COMMENT2 = '00000000-0000-4000-8000-000000000005';
const CONV = '00000000-0000-4000-8000-000000000006';
const EPOCH = 'epoch-1';

function makePost(overrides: Partial<MomentsPost> = {}): MomentsPost {
  return {
    postId: POST,
    author: { kind: 'character', refId: CHAR },
    text: '今天天气很好，去公园走了走。',
    images: [],
    link: null,
    visibility: null,
    likes: [],
    likedByMe: false,
    comments: [],
    createdAt: '2026-10-31T02:00:00.000Z',
    ...overrides,
  };
}

function makeComment(commentId: string, authorKind: 'user' | 'character', text: string) {
  return {
    commentId,
    author: { kind: authorKind, refId: authorKind === 'user' ? USER : CHAR },
    replyTo: null,
    replyToCommentId: null,
    text,
    mentionsUser: false,
    createdAt: '2026-10-31T02:05:00.000Z',
  };
}

describe('批次 id', () => {
  it('三种批次 id 命名空间正确', () => {
    expect(momentsMemoryBatchId('post', POST)).toBe(`moments:post:${POST}`);
    expect(momentsMemoryBatchId('thread', POST, COMMENT)).toBe(`moments:thread:${POST}:${COMMENT}`);
    expect(momentsMemoryBatchId('reply', POST, COMMENT)).toBe(`moments:reply:${COMMENT}`);
  });

  it('thread/reply 缺 commentId 时建任务数据抛错', () => {
    expect(() =>
      momentsMemoryJobData('thread', {
        userId: USER,
        characterId: CHAR,
        postId: POST,
        epoch: EPOCH,
      }),
    ).toThrow('commentId');
  });

  it('任务数据带上 epoch 与批次 id', () => {
    const data = momentsMemoryJobData('post', {
      userId: USER,
      characterId: CHAR,
      postId: POST,
      epoch: EPOCH,
    });
    expect(data.batchId).toBe(`moments:post:${POST}`);
    expect(data.epoch).toBe(EPOCH);
  });
});

describe('公开草稿文本比对', () => {
  it('文本相等即公开', () => {
    expect(isSharedPublicDraftText('今天天气很好', '今天天气很好')).toBe(true);
  });

  it('文本不同不是公开', () => {
    expect(isSharedPublicDraftText('今天天气很好', '今天下雨了')).toBe(false);
  });

  it('草稿为空或空白不是公开', () => {
    expect(isSharedPublicDraftText(null, '今天天气很好')).toBe(false);
    expect(isSharedPublicDraftText('', '今天天气很好')).toBe(false);
    expect(isSharedPublicDraftText('   ', '今天天气很好')).toBe(false);
  });

  it('首尾空白不影响比对', () => {
    expect(isSharedPublicDraftText(' 今天天气很好 ', '今天天气很好')).toBe(true);
  });
});

describe('读脑分流', () => {
  it('私人角色动态走脑前缀', () => {
    expect(
      shouldUseBrainPrefix({
        privateConversation: false,
        authorKind: 'character',
        sharedPublicDraft: false,
      }),
    ).toBe(true);
  });

  it('私密模型路不走脑前缀', () => {
    expect(
      shouldUseBrainPrefix({
        privateConversation: true,
        authorKind: 'character',
        sharedPublicDraft: false,
      }),
    ).toBe(false);
  });

  it('用户动态不走脑前缀', () => {
    expect(
      shouldUseBrainPrefix({
        privateConversation: false,
        authorKind: 'user',
        sharedPublicDraft: false,
      }),
    ).toBe(false);
  });

  it('公开草稿不走脑前缀', () => {
    expect(
      shouldUseBrainPrefix({
        privateConversation: false,
        authorKind: 'character',
        sharedPublicDraft: true,
      }),
    ).toBe(false);
  });

  it('原文转发（forwardedPublic=true）不走脑前缀', () => {
    expect(
      shouldUseBrainPrefix({
        privateConversation: false,
        authorKind: 'character',
        sharedPublicDraft: false,
        forwardedPublic: true,
      }),
    ).toBe(false);
  });

  it('maybePost 私人动态（素材 public_update、无转发标记）走脑前缀', () => {
    expect(
      shouldUseBrainPrefix({
        privateConversation: false,
        authorKind: 'character',
        sharedPublicDraft: false,
        forwardedPublic: false,
      }),
    ).toBe(true);
  });

  it('旧数据（无转发标记）按旧行为走脑前缀', () => {
    expect(
      shouldUseBrainPrefix({
        privateConversation: false,
        authorKind: 'character',
        sharedPublicDraft: false,
        forwardedPublic: undefined,
      }),
    ).toBe(true);
  });
});

describe('提取输入', () => {
  it('动态与评论带来源 id，说话人分用户/角色/其他角色', () => {
    const post = makePost({
      comments: [
        makeComment(COMMENT, 'user', '好天气！'),
        makeComment(COMMENT2, 'character', '是啊，一起去走走。'),
      ],
    });
    const { sourceIds, text } = buildMomentsExtractionInput(post, CHAR);
    expect(sourceIds).toEqual([POST, COMMENT, COMMENT2]);
    expect(text).toContain(`[${POST}] 角色：`);
    expect(text).toContain(`[${COMMENT}] 用户：好天气！`);
    expect(text).toContain(`[${COMMENT2}] 角色：是啊，一起去走走。`);
  });

  it('只取最近 12 条评论，正文截断', () => {
    const comments = Array.from({ length: 15 }, (_, i) =>
      makeComment(
        `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
        'user',
        `第${i}条`,
      ),
    );
    const post = makePost({ text: 'x'.repeat(700), comments });
    const { sourceIds, text } = buildMomentsExtractionInput(post, CHAR);
    expect(sourceIds).toHaveLength(13);
    expect(text).not.toContain('第0条');
    expect(text).toContain('第14条');
    expect(text.length).toBeLessThanOrEqual(4000);
  });
});

describe('提取结果校验', () => {
  const allowed = new Set([POST, COMMENT]);

  function validOp(overrides: Record<string, unknown> = {}) {
    return {
      action: 'ADD',
      content: '用户喜欢周末去公园散步。',
      category: 'preference',
      importance: 5,
      sourceMessageIds: [POST],
      ...overrides,
    };
  }

  it('合法结果原样通过', () => {
    expect(validateMomentsExtraction({ operations: [validOp()] }, allowed)).toEqual([validOp()]);
  });

  it('超过 3 条只留前 3 条', () => {
    const ops = [1, 2, 3, 4, 5].map((n) => validOp({ content: `事实${n}` }));
    const result = validateMomentsExtraction({ operations: ops }, allowed);
    expect(result).toHaveLength(3);
    expect(result?.[0]?.content).toBe('事实1');
    expect(result?.[2]?.content).toBe('事实3');
  });

  it('引用了未给出的来源 id 整批丢弃', () => {
    expect(
      validateMomentsExtraction(
        { operations: [validOp({ sourceMessageIds: ['00000000-0000-4000-8000-000000000099'] })] },
        allowed,
      ),
    ).toBeNull();
  });

  it('命中健康隐私整批丢弃', () => {
    expect(
      validateMomentsExtraction(
        { operations: [validOp({ content: '她说最近月经不太规律。' })] },
        allowed,
      ),
    ).toBeNull();
  });

  it('结构不对整批丢弃', () => {
    expect(validateMomentsExtraction({ operations: 'not-an-array' }, allowed)).toBeNull();
    expect(validateMomentsExtraction({ nope: [] }, allowed)).toBeNull();
    expect(validateMomentsExtraction(null, allowed)).toBeNull();
  });

  it('空操作列表通过（写库侧不写任何东西）', () => {
    expect(validateMomentsExtraction({ operations: [] }, allowed)).toEqual([]);
  });
});

describe('公开草稿行查询', () => {
  function makeDb(rows: Array<{ status: string; text: string | null }>) {
    return {
      db: {
        select: () => ({ from: () => ({ where: async () => rows }) }),
      },
    };
  }

  it('ready 草稿文本相等即公开', async () => {
    const db = makeDb([{ status: 'ready', text: '今天天气很好，去公园走了走。' }]);
    await expect(
      isSharedPublicDraft(
        db as never,
        CHAR,
        '2026-10-31T02:00:00.000Z',
        '今天天气很好，去公园走了走。',
      ),
    ).resolves.toBe(true);
  });

  it('非 ready 草稿不算公开', async () => {
    const db = makeDb([{ status: 'generating', text: '今天天气很好，去公园走了走。' }]);
    await expect(
      isSharedPublicDraft(
        db as never,
        CHAR,
        '2026-10-31T02:00:00.000Z',
        '今天天气很好，去公园走了走。',
      ),
    ).resolves.toBe(false);
  });

  it('无草稿行不算公开', async () => {
    const db = makeDb([]);
    await expect(
      isSharedPublicDraft(
        db as never,
        CHAR,
        '2026-10-31T02:00:00.000Z',
        '今天天气很好，去公园走了走。',
      ),
    ).resolves.toBe(false);
  });
});

describe('任务投递', () => {
  it('投递带 singletonKey 与有界重试，投递失败吞掉', async () => {
    const jobs = { send: vi.fn().mockResolvedValue('job-1') };
    const data = momentsMemoryJobData('post', {
      userId: USER,
      characterId: CHAR,
      postId: POST,
      epoch: EPOCH,
    });
    await sendMomentsMemoryJob(jobs as never, data);
    expect(jobs.send).toHaveBeenCalledWith(
      MOMENTS_MEMORY_JOB,
      data,
      expect.objectContaining({
        singletonKey: `moments-memory:${data.batchId}`,
        retryLimit: 3,
        retryBackoff: true,
      }),
    );
    const failing = { send: vi.fn().mockRejectedValue(new Error('queue down')) };
    await expect(sendMomentsMemoryJob(failing as never, data)).resolves.toBeUndefined();
  });
});

describe('MomentsMemoryService.run', () => {
  function buildService(overrides: Record<string, unknown> = {}) {
    const db = {
      db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    };
    const jobs = { work: vi.fn().mockResolvedValue(undefined) };
    const moments = { getPost: vi.fn().mockResolvedValue(makePost()) };
    const contacts = {
      getActiveContact: vi.fn().mockResolvedValue({ conversationId: CONV }),
      getActiveContactEpoch: vi.fn().mockResolvedValue({ version: EPOCH, acceptAfter: '' }),
    };
    const accounts = { isBanned: vi.fn().mockResolvedValue(false) };
    const gateway = { generateText: vi.fn() };
    const memory = {
      revision: vi.fn().mockResolvedValue(7),
      applyExternal: vi.fn().mockResolvedValue(true),
    };
    const service = Object.create(MomentsMemoryService.prototype) as MomentsMemoryService;
    Object.assign(service, {
      db,
      jobs,
      moments,
      contacts,
      accounts,
      gateway,
      memory,
      ...overrides,
    });
    return { service, db, jobs, moments, contacts, accounts, gateway, memory };
  }

  function jobData() {
    return momentsMemoryJobData('post', {
      userId: USER,
      characterId: CHAR,
      postId: POST,
      epoch: EPOCH,
    });
  }

  function gatewayOk(operations: unknown[]) {
    return {
      ok: true,
      value: { text: JSON.stringify({ operations }), modelKey: 'm', usage: {}, chargedMicros: 0 },
    };
  }

  it('成功路径：网关提取后经 applyExternal 写 normal/moments', async () => {
    const { service, gateway, memory } = buildService();
    const op = {
      action: 'ADD',
      content: '用户喜欢周末去公园散步。',
      category: 'preference',
      importance: 5,
      sourceMessageIds: [POST],
    };
    gateway.generateText.mockResolvedValue(gatewayOk([op]));
    await service.run(jobData());
    expect(gateway.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'memory',
        modelRole: 'background',
        conversationId: CONV,
        responseFormat: 'json',
        meta: expect.objectContaining({ promptTemplateVersion: 'moments-memory-v1' }),
      }),
    );
    expect(memory.applyExternal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: 'normal',
        origin: 'moments',
        batchId: `moments:post:${POST}`,
        revision: 7,
        operations: [op],
        sourceIds: [POST],
      }),
    );
  });

  it('onModuleInit 登记任务名', async () => {
    const { service, jobs } = buildService();
    await service.onModuleInit();
    expect(jobs.work).toHaveBeenCalledWith(MOMENTS_MEMORY_JOB, expect.any(Function));
  });

  it('封禁账号直接丢弃，不调网关', async () => {
    const { service, accounts, gateway } = buildService();
    accounts.isBanned.mockResolvedValue(true);
    await service.run(jobData());
    expect(gateway.generateText).not.toHaveBeenCalled();
  });

  it('好友不存在或 epoch 对不上直接丢弃', async () => {
    const noContact = buildService();
    noContact.contacts.getActiveContact.mockResolvedValue(null);
    await noContact.service.run(jobData());
    expect(noContact.gateway.generateText).not.toHaveBeenCalled();

    const epochMismatch = buildService();
    epochMismatch.contacts.getActiveContactEpoch.mockResolvedValue({
      version: 'epoch-2',
      acceptAfter: '',
    });
    await epochMismatch.service.run(jobData());
    expect(epochMismatch.gateway.generateText).not.toHaveBeenCalled();
  });

  it('帖子不存在、非角色动态、公开草稿一律丢弃', async () => {
    const gone = buildService();
    gone.moments.getPost.mockResolvedValue(null);
    await gone.service.run(jobData());
    expect(gone.gateway.generateText).not.toHaveBeenCalled();

    const userPost = buildService();
    userPost.moments.getPost.mockResolvedValue(makePost({ author: { kind: 'user', refId: USER } }));
    await userPost.service.run(jobData());
    expect(userPost.gateway.generateText).not.toHaveBeenCalled();

    const shared = buildService({
      db: {
        db: {
          select: () => ({
            from: () => ({
              where: async () => [{ status: 'ready', text: '今天天气很好，去公园走了走。' }],
            }),
          }),
        },
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
      },
    });
    await shared.service.run(jobData());
    expect(shared.gateway.generateText).not.toHaveBeenCalled();
  });

  it('原文转发（forwardedPublic=true）的帖子直接丢弃', async () => {
    const forwarded = buildService();
    forwarded.moments.getPost.mockResolvedValue(
      makePost({ sourceKind: 'public_update', forwardedPublic: true, text: '微博原文转发。' }),
    );
    await forwarded.service.run(jobData());
    expect(forwarded.gateway.generateText).not.toHaveBeenCalled();
    expect(forwarded.memory.applyExternal).not.toHaveBeenCalled();
  });

  it('maybePost 私人动态（素材 public_update、无转发标记）照常写回', async () => {
    const { service, moments, gateway, memory } = buildService();
    const op = {
      action: 'ADD',
      content: '角色今天分享了一件公开动态里提到的事。',
      category: 'episode',
      importance: 4,
      sourceMessageIds: [POST],
    };
    moments.getPost.mockResolvedValue(
      makePost({ sourceKind: 'public_update', forwardedPublic: false }),
    );
    gateway.generateText.mockResolvedValue(gatewayOk([op]));
    await service.run(jobData());
    expect(gateway.generateText).toHaveBeenCalled();
    expect(memory.applyExternal).toHaveBeenCalled();
  });

  it('网关失败、坏 JSON、校验失败一律丢弃不写库', async () => {
    const failed = buildService();
    failed.gateway.generateText.mockResolvedValue({ ok: false, error: 'insufficient_balance' });
    await failed.service.run(jobData());
    expect(failed.memory.applyExternal).not.toHaveBeenCalled();

    const badJson = buildService();
    badJson.gateway.generateText.mockResolvedValue({
      ok: true,
      value: { text: '{oops', modelKey: 'm', usage: {}, chargedMicros: 0 },
    });
    await badJson.service.run(jobData());
    expect(badJson.memory.applyExternal).not.toHaveBeenCalled();

    const badSource = buildService();
    badSource.gateway.generateText.mockResolvedValue(
      gatewayOk([
        {
          action: 'ADD',
          content: '编出来的事。',
          category: 'basic',
          importance: 5,
          sourceMessageIds: ['00000000-0000-4000-8000-000000000099'],
        },
      ]),
    );
    await badSource.service.run(jobData());
    expect(badSource.memory.applyExternal).not.toHaveBeenCalled();
  });

  it('revision 对不上（applyExternal 返回 false）不抛错', async () => {
    const { service, gateway, memory } = buildService();
    memory.applyExternal.mockResolvedValue(false);
    gateway.generateText.mockResolvedValue(gatewayOk([]));
    await expect(service.run(jobData())).resolves.toBeUndefined();
  });

  it('applyExternal 抛账号/好友状态错时丢弃不重试', async () => {
    const { service, gateway, memory } = buildService();
    const { AppError } = await import('../../../platform/index.js');
    memory.applyExternal.mockRejectedValue(new AppError('not_found', '好友已变化'));
    gateway.generateText.mockResolvedValue(gatewayOk([]));
    await expect(service.run(jobData())).resolves.toBeUndefined();
  });

  it('基础设施异常抛错走重试', async () => {
    const { service, gateway } = buildService({
      db: {
        db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
        transaction: async () => {
          throw new Error('db down');
        },
      },
    });
    gateway.generateText.mockResolvedValue(gatewayOk([]));
    await expect(service.run(jobData())).rejects.toThrow('db down');
  });

  it('非法任务数据直接丢弃', async () => {
    const { service, gateway } = buildService();
    await service.run({
      batchId: '',
      kind: 'post',
      userId: USER,
      characterId: CHAR,
      postId: POST,
      epoch: EPOCH,
    } as never);
    expect(gateway.generateText).not.toHaveBeenCalled();
  });
});
