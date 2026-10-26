/**
 * 3.29：朋友圈只同步微博素材、规划跟随用户 chat 场景（生态 Jev 判定见 ecology-jev.test.ts）。
 * 只覆盖本次窄改，不重复私密固定等前批测试。
 */
import { describe, expect, it, vi } from 'vitest';
import { MomentsAiService } from './moments-ai.js';
import { ModelResolver } from '../../model-access/application/resolver.js';
import type { CatalogService } from '../../model-access/application/catalog.js';
import type { ScenarioService } from '../../model-access/application/scenarios.js';
import type { ModelPolicy } from '../../model-access/tokens.js';

const USER = '00000000-0000-4000-8000-000000000001';
const CHAR = '00000000-0000-4000-8000-000000000002';

const policy = { isRealPerson: false, isMinor: false, romanceAllowed: true };

function moments(options: {
  material?: {
    updateId: string;
    content: string;
    images?: Array<{ mediaId: string }>;
  };
  publicUpdate?: { updateId: string; content: string; sourceUrl: string } | null;
  postOk?: boolean;
}) {
  const createPost = vi
    .fn()
    .mockResolvedValue(
      options.postOk === false
        ? { ok: false, error: 'duplicate' }
        : { ok: true, value: { postId: 'post-1' } },
    );
  const service = Object.create(MomentsAiService.prototype) as MomentsAiService;
  Object.assign(service, {
    policy: { getCharacterPolicy: vi.fn().mockResolvedValue(policy) },
    writer: { createPost },
    publicUpdates: {
      listEffective: vi.fn().mockResolvedValue(options.publicUpdate ? [options.publicUpdate] : []),
    },
    weiboMaterial:
      options.material === undefined
        ? undefined
        : { latest: vi.fn().mockResolvedValue(options.material) },
    clock: { nowMs: () => Date.parse('2026-10-25T00:00:00.000Z') },
  });
  return { service, createPost };
}

describe('私人朋友圈：只同步微博素材，不 AI 编、不补风景图', () => {
  it('没有素材时明确 no_material，不创建动态、不调生成模型', async () => {
    const { service, createPost } = moments({ publicUpdate: null });
    await expect(
      service.postForEcology({ userId: USER, characterId: CHAR, runId: 'r1' }),
    ).resolves.toEqual({
      ok: false,
      reason: 'no_material',
    });
    expect(createPost).not.toHaveBeenCalled();
  });

  it('代理明确返回 null 时不再回退旧文本，也不发', async () => {
    const { service, createPost } = moments({
      publicUpdate: {
        updateId: 'u1',
        content: '旧动态文本',
        sourceUrl: 'https://weibo.com/1/abc',
      },
    });
    Object.assign(service, {
      weiboMaterial: { latest: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.postForEcology({ userId: USER, characterId: CHAR, runId: 'r1' }),
    ).resolves.toEqual({ ok: false, reason: 'no_material' });
    expect(createPost).not.toHaveBeenCalled();
  });

  it('有已同步文本素材时原样发文字，图片为空（不用 picsum/AI）', async () => {
    const { service, createPost } = moments({
      publicUpdate: {
        updateId: 'u1',
        content: '今天拍完戏，收工回家。',
        sourceUrl: 'https://weibo.com/1/abc',
      },
    });
    await expect(
      service.postForEcology({ userId: USER, characterId: CHAR, runId: 'r1' }),
    ).resolves.toEqual({
      ok: true,
      chargedMicros: 0,
      postId: 'post-1',
    });
    expect(createPost).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        text: '今天拍完戏，收工回家。',
        imageMediaIds: [],
        idempotencyKey: 'eco-weibo:00000000-0000-4000-8000-000000000001:u1',
      }),
    );
  });

  it('素材带图时从该条微博图片里稳定选一张（不是风景图）', async () => {
    const { service, createPost } = moments({
      material: {
        updateId: 'u2',
        content: '公开活动照。',
        images: [{ mediaId: 'm1' }, { mediaId: 'm2' }],
      },
    });
    await service.postForEcology({ userId: USER, characterId: CHAR, runId: 'r1' });
    const args = createPost.mock.calls[0]![1] as { imageMediaIds: string[] };
    expect(args.imageMediaIds).toHaveLength(1);
    expect(['m1', 'm2']).toContain(args.imageMediaIds[0]);
    // 再跑一次（同一条）仍选同一张，重试不换图
    const before = args.imageMediaIds[0];
    await service.postForEcology({ userId: USER, characterId: CHAR, runId: 'r2' });
    const again = createPost.mock.calls[1]![1] as { imageMediaIds: string[] };
    expect(again.imageMediaIds[0]).toBe(before);
  });
});

describe('行为规划：跟随用户 chat 场景，不再读后台 internal.planner', () => {
  it('behavior_planning 走用户 chat pick，不调用 internalModel(planner)', async () => {
    const pick = vi.fn().mockResolvedValue({
      facts: {
        modelKey: 'openai/chat-model',
        entry: {
          modelKey: 'openai/chat-model',
          enabled: true,
          deletedAt: null,
          capabilities: [],
          scenarios: ['chat'],
          tags: [],
        },
        upstreamStatus: 'active',
      },
      source: 'user',
    });
    const internalModel = vi.fn();
    const resolver = new ModelResolver(
      { internalModel, recommendedModel: vi.fn() } as unknown as CatalogService,
      { pick } as unknown as ScenarioService,
      {} as ModelPolicy,
    );
    const out = await resolver.resolve({
      userId: USER,
      characterId: CHAR,
      modelRole: 'background',
      purpose: 'behavior_planning',
    });
    expect(out).toMatchObject({ ok: true, value: { modelKey: 'openai/chat-model' } });
    expect(pick).toHaveBeenCalledWith(USER, 'chat', CHAR);
    expect(internalModel).not.toHaveBeenCalled();
  });
});
