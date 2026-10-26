/**
 * 3.28：私密模型由平台固定。
 *
 * 覆盖：平台固定优先（用户/角色旧选择绕不过）、三个用户写入入口拒绝、缺配置不拿推荐/聊天模型兜底、
 * 固定模型删除保护、初始化只复制一次（fixed:null 不复活）、只读接口按真实目录/折扣算倍率。
 */
import { describe, expect, it, vi } from 'vitest';
import { CatalogService, type ModelFacts } from './catalog.js';
import { ModelDeletionService } from './model-deletion.js';
import { ModelResolver } from './resolver.js';
import { ScenarioService } from './scenarios.js';
import { SelectionService } from './selection.js';
import type { ModelPolicy } from '../tokens.js';

const USER = '00000000-0000-4000-8000-000000000001';
const CHAR = '00000000-0000-4000-8000-000000000002';
const FIXED = 'openai/fixed-private';
const LEGACY = 'openai/legacy-private';

function scenarioService(options: {
  fixedKey?: string | null;
  userRows?: Map<string, string>;
  overrideRows?: Map<string, string>;
}) {
  const raw = vi.fn().mockResolvedValue(options.userRows ?? new Map());
  const rawOverrides = vi.fn().mockResolvedValue(options.overrideRows ?? new Map());
  const fixedPrivateFacts = vi.fn().mockResolvedValue(
    options.fixedKey
      ? {
          modelKey: options.fixedKey,
          entry: {
            enabled: true,
            deletedAt: null,
            scenarios: ['private'],
            tags: [],
            capabilities: [],
          },
          upstreamStatus: 'active',
        }
      : null,
  );
  const catalog = {
    fixedPrivateFacts,
    modelUses: vi
      .fn()
      .mockResolvedValue({ recommended: {}, internal: {}, fixed: { private: options.fixedKey } }),
    facts: vi.fn(async (keys: readonly string[]) => {
      const map = new Map<string, ModelFacts>();
      for (const key of keys)
        map.set(key, {
          modelKey: key,
          entry: {
            enabled: true,
            deletedAt: null,
            scenarios: ['chat', 'private'],
            tags: [],
            capabilities: [],
          } as never,
          upstreamStatus: 'active',
        });
      return map;
    }),
  };
  const service = Object.create(ScenarioService.prototype) as ScenarioService;
  Object.assign(service, { catalog, raw, rawOverrides });
  return { service, raw, rawOverrides, fixedPrivateFacts, catalog };
}

describe('私密固定：解析', () => {
  it('private 只返回平台固定模型，旧用户选择 / 角色覆盖都不读', async () => {
    const { service, raw, rawOverrides } = scenarioService({
      fixedKey: FIXED,
      userRows: new Map([['private', LEGACY]]),
      overrideRows: new Map([['private', LEGACY]]),
    });
    const picked = await service.pick(USER, 'private', CHAR);
    expect(picked?.facts.modelKey).toBe(FIXED);
    expect(picked?.source).toBe('fixed');
    expect(raw).not.toHaveBeenCalled();
    expect(rawOverrides).not.toHaveBeenCalled();
  });

  it('缺固定配置时返回 null，不拿旧选择/推荐兜底', async () => {
    const { service, raw } = scenarioService({
      fixedKey: null,
      userRows: new Map([['private', LEGACY]]),
    });
    await expect(service.pick(USER, 'private', CHAR)).resolves.toBeNull();
    expect(raw).not.toHaveBeenCalled();
  });

  it('管理员 admin_* 调用也不能拿 recommended.private 兜底', async () => {
    const recommendedModel = vi.fn().mockResolvedValue({
      modelKey: 'openai/recommended-private',
      entry: {
        enabled: true,
        deletedAt: null,
        scenarios: ['private'],
        tags: [],
        capabilities: [],
      },
      upstreamStatus: 'active',
    });
    const resolver = new ModelResolver(
      { recommendedModel } as unknown as CatalogService,
      { pick: vi.fn().mockResolvedValue(null) } as unknown as ScenarioService,
      {} as ModelPolicy,
    );
    await expect(resolver.pick(USER, 'adult', CHAR, { purpose: 'admin_eval' })).resolves.toBeNull();
    expect(recommendedModel).not.toHaveBeenCalled();
  });

  it('读取场景配置时 private 显示固定模型并标记 fixedByAdmin（推荐字段不参与）', async () => {
    const { service } = scenarioService({ fixedKey: FIXED });
    const config = await service.getConfig(USER);
    const row = config.scenarios.find((s) => s.scenario === 'private');
    expect(row?.selection?.modelKey).toBe(FIXED);
    expect(row?.recommendedModelKey).toBeNull();
    expect(row?.fixedByAdmin).toBe(true);
  });
});

describe('私密固定：用户写入入口一律拒绝', () => {
  it('全局场景配置不能改 private', async () => {
    const service = Object.create(ScenarioService.prototype) as ScenarioService;
    await expect(
      service.updateConfig(USER, { private: { modelKey: LEGACY } }),
    ).rejects.toMatchObject({ code: 'model_not_allowed', status: 422 });
  });

  it('角色逐场景覆盖不能改 private', async () => {
    const service = Object.create(ScenarioService.prototype) as ScenarioService;
    await expect(
      service.updateCharacter(USER, CHAR, { private: { modelKey: LEGACY } }),
    ).rejects.toMatchObject({ code: 'model_not_allowed', status: 422 });
  });

  it('旧 /model/selection 的 adult 写入被拒绝', async () => {
    const service = new SelectionService(
      undefined as never,
      undefined as never,
      undefined as never,
    );
    await expect(
      service.updateSelection(USER, { adult: { modelKey: LEGACY } }),
    ).rejects.toMatchObject({ code: 'model_not_allowed', status: 422 });
  });
});

describe('私密固定：删除保护与初始化', () => {
  it('固定私密模型不能删除（预览与执行都 conflict）', async () => {
    const service = Object.create(ModelDeletionService.prototype) as ModelDeletionService;
    Object.assign(service, {
      modelUses: vi.fn().mockResolvedValue({ fixed: { private: FIXED } }),
      database: { db: {} },
    });
    await expect(service.preview([FIXED])).rejects.toMatchObject({ code: 'conflict', status: 409 });
    await expect(service.delete('admin', [FIXED])).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    });
  });

  it('fixed 字段已存在（含 fixed:null 主动清空）时初始化不复活', async () => {
    const service = Object.create(CatalogService.prototype) as CatalogService;
    Object.assign(service, {
      database: {
        db: {
          select: () => ({
            from: () => ({ where: async () => [{ value: { fixed: { private: null } } }] }),
          }),
        },
      },
    });
    await expect(service.initializeFixedPrivateModel('admin')).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    });
  });

  it('从未初始化且推荐私密模型有效时，显式复制一次（fixed.private）', async () => {
    const setModelUses = vi.fn().mockResolvedValue({ recommended: {}, internal: {} });
    const audit = { record: vi.fn().mockResolvedValue('audit-1') };
    const service = Object.create(CatalogService.prototype) as CatalogService;
    Object.assign(service, {
      database: {
        db: {
          select: () => ({
            from: () => ({
              where: async () => [{ value: { recommended: { private: FIXED } } }],
            }),
          }),
        },
      },
      modelUses: vi.fn().mockResolvedValue({ recommended: { private: FIXED }, internal: {} }),
      fact: vi.fn().mockResolvedValue({
        modelKey: FIXED,
        entry: {
          enabled: true,
          deletedAt: null,
          scenarios: ['private'],
          tags: [],
          capabilities: [],
        },
        upstreamStatus: 'active',
      }),
      setModelUses,
      audit,
    });
    await service.initializeFixedPrivateModel('admin');
    expect(setModelUses).toHaveBeenCalledWith('admin', {
      recommended: {},
      internal: {},
      fixed: { private: FIXED },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'private_model.initialized' }),
    );
  });
});

describe('私密固定：只读接口的真实倍率', () => {
  it('倍率已含折扣、available 来自目录可用性；未配置返回 null', async () => {
    const entry = {
      modelKey: FIXED,
      displayName: '固定私密模型',
      enabled: true,
      deletedAt: null,
      displayMultiplier: null,
    };
    const service = Object.create(CatalogService.prototype) as CatalogService;
    Object.assign(service, {
      modelUses: vi
        .fn()
        .mockResolvedValue({ recommended: {}, internal: {}, fixed: { private: FIXED } }),
      facts: vi.fn().mockResolvedValue(
        new Map<string, ModelFacts>([
          [
            FIXED,
            {
              modelKey: FIXED,
              entry: entry as never,
              upstreamStatus: 'active',
              detail: null,
            },
          ],
        ]),
      ),
      display: {
        forModels: vi.fn().mockResolvedValue(
          new Map([
            [
              FIXED,
              {
                displayMultiplier: 1.5,
                displayMultiplierManual: null,
                discount: { rate: 0.5, endsAt: '2026-11-01T00:00:00.000Z' },
              },
            ],
          ]),
        ),
      },
    });
    await expect(service.privateModel()).resolves.toEqual({
      modelKey: FIXED,
      displayName: '固定私密模型',
      displayMultiplier: 0.75,
      discountRate: 0.5,
      available: true,
    });
    const empty = Object.create(CatalogService.prototype) as CatalogService;
    Object.assign(empty, {
      modelUses: vi.fn().mockResolvedValue({ recommended: {}, internal: {} }),
    });
    await expect(empty.privateModel()).resolves.toBeNull();
  });
});
