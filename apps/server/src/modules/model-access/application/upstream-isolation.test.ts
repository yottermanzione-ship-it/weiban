/**
 * T-20261104a：用户触发的服务商拦截不影响上游账号判断；用户之间的拦截互不影响（不连数据库的单元测试）。
 * - 密钥自检：401 / 403 普通正文先用同一把密钥连通测试，结论按上游缓存 60 秒；
 * - 上游状态入口（reportStatus / recordFailure）在自检通过时不改状态；
 * - 媒体网关经 withTarget 把自检通过的 invalid_key 改成 content_rejected；
 * - 同一用户反复被拦的限制规则（推算到期时间、只管私密回复）；
 * - T-20261104f 权限类拒绝提醒的参数、文案与计数入口。
 * 真库与真实网关的用例见 apps/server/test/upstream-isolation.test.ts。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  PRIVATE_BLOCK_LIMIT,
  TestClock,
  UPSTREAM_AUTH_REJECTED_ALERT,
} from '../../../platform/index.js';
import type { UpstreamProbe, UpstreamProbeResult } from '../tokens.js';
import { ModelGatewayMedia } from './media-gateway.js';
import { blockLimitApplies, blockLimitUntil, PrivateBlockLimiter } from './private-block-limit.js';
import { UpstreamScheduler } from './scheduler.js';
import {
  KEY_SELF_CHECK_TTL_MS,
  UpstreamService,
  upstreamAuthRejectedSummary,
} from './upstreams.js';
import { DEFAULT_GATEWAY_LIMITS } from './limits.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function silentLogger() {
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { ...logger, child: () => logger, calls: logger };
}

/** UpstreamService，只有自检需要的部分是真的：探测是假的，读上游 / 解密密钥用桩代替。 */
function upstreamService(results: UpstreamProbeResult[]) {
  const clock = new TestClock('2026-11-04T10:00:00Z');
  const queue = [...results];
  const probe: UpstreamProbe = {
    test: vi.fn(async (): Promise<UpstreamProbeResult> => queue.shift() ?? { ok: true }),
  };
  const transaction = vi.fn(async () => true);
  const logger = silentLogger();
  const service = new UpstreamService(
    { transaction } as never,
    clock,
    {} as never,
    {} as never,
    {} as never,
    probe,
    {} as never,
    logger as never,
  );
  vi.spyOn(service, 'get').mockResolvedValue({
    kind: 'openai_compatible',
    baseUrl: 'https://provider.example/v1',
  } as never);
  vi.spyOn(service, 'withApiKey').mockImplementation(async (_id, fn) => fn('sk-self-check-test'));
  return { service, probe, clock, transaction, logger };
}

describe('密钥自检：401 / 403 普通正文先确认密钥是否真的坏了', () => {
  it('自检通过 → 密钥没坏；探测与后台「测试」相同，传上游自己的协议、地址和密钥', async () => {
    const { service, probe } = upstreamService([{ ok: true }]);
    expect(await service.keyStillWorks('up-1')).toBe(true);
    expect(probe.test).toHaveBeenCalledWith({
      kind: 'openai_compatible',
      baseUrl: 'https://provider.example/v1',
      apiKey: 'sk-self-check-test',
    });
  });

  it('自检失败（任何失败类别）或读不到密钥 → 按密钥失效处理', async () => {
    const failed = upstreamService([{ ok: false, reason: 'invalid_key' }]);
    expect(await failed.service.keyStillWorks('up-1')).toBe(false);
    const broken = upstreamService([]);
    vi.spyOn(broken.service, 'withApiKey').mockRejectedValue(new Error('请先配置上游密钥'));
    expect(await broken.service.keyStillWorks('up-1')).toBe(false);
  });

  it('同一上游 60 秒内只自检一次（同时到达的请求共用一次），过期后重新自检；不同上游各自自检', async () => {
    const { service, probe, clock } = upstreamService([{ ok: true }, { ok: true }, { ok: true }]);
    expect(await Promise.all([1, 2, 3].map(() => service.keyStillWorks('up-1')))).toEqual([
      true,
      true,
      true,
    ]);
    expect(probe.test).toHaveBeenCalledTimes(1);
    clock.advance(KEY_SELF_CHECK_TTL_MS - 1);
    expect(await service.keyStillWorks('up-1')).toBe(true);
    expect(probe.test).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(await service.keyStillWorks('up-1')).toBe(true);
    expect(probe.test).toHaveBeenCalledTimes(2);
    expect(await service.keyStillWorks('up-2')).toBe(true);
    expect(probe.test).toHaveBeenCalledTimes(3);
  });

  it('结论在缓存期内一致：失败结论也缓存；forgetKeyCheck 后重新自检', async () => {
    const { service, probe } = upstreamService([
      { ok: false, reason: 'invalid_key' },
      { ok: true },
    ]);
    expect(await service.keyStillWorks('up-1')).toBe(false);
    expect(await service.keyStillWorks('up-1')).toBe(false);
    expect(probe.test).toHaveBeenCalledTimes(1);
    service.forgetKeyCheck('up-1');
    expect(await service.keyStillWorks('up-1')).toBe(true);
    expect(probe.test).toHaveBeenCalledTimes(2);
  });

  it('日志只有上游 ID 和结果类别，不含密钥', async () => {
    const { service, logger } = upstreamService([{ ok: true }]);
    await service.keyStillWorks('up-1');
    expect(logger.calls.warn).toHaveBeenCalledWith(
      { code: 'upstream_key_self_check', upstreamId: 'up-1', result: 'ok' },
      expect.any(String),
    );
    expect(JSON.stringify(logger.calls.warn.mock.calls)).not.toContain('sk-self-check-test');
  });
});

describe('上游状态入口：自检通过时不改状态', () => {
  it('reportStatus：网关报 invalid 而自检通过 → 不改（不开事务）；自检失败 → 照常改', async () => {
    const ok = upstreamService([{ ok: true }]);
    expect(await ok.service.reportStatus('up-1', 'invalid', 'gateway', 'invalid_key')).toBe(false);
    expect(ok.transaction).not.toHaveBeenCalled();
    const bad = upstreamService([{ ok: false, reason: 'invalid_key' }]);
    expect(await bad.service.reportStatus('up-1', 'invalid', 'gateway', 'invalid_key')).toBe(true);
    expect(bad.transaction).toHaveBeenCalledTimes(1);
  });

  it('reportStatus：额度、不可用、恢复、探测来源都不自检', async () => {
    const { service, probe, transaction } = upstreamService([{ ok: true }]);
    await service.reportStatus('up-1', 'quota_exhausted', 'gateway', 'quota_exhausted');
    await service.reportStatus('up-1', 'unavailable', 'gateway', 'provider_error');
    await service.reportStatus('up-1', 'active', 'gateway');
    await service.reportStatus('up-1', 'invalid', 'probe', 'invalid_key');
    expect(probe.test).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(4);
  });

  function scheduler(keyOk: boolean) {
    const returning = vi.fn(async () => [{ failures: 1 }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const upstreams = {
      keyStillWorks: vi.fn(async () => keyOk),
      reportStatus: vi.fn(async () => true),
    };
    const s = new UpstreamScheduler(
      { db: { update } } as never,
      new TestClock('2026-11-04T10:00:00Z'),
      { get: async () => DEFAULT_GATEWAY_LIMITS } as never,
      upstreams as never,
    );
    return { s, update, upstreams };
  }

  it('recordFailure：invalid_key 自检通过 → 不累计失败、不暂停、不标状态', async () => {
    const { s, update, upstreams } = scheduler(true);
    await s.recordFailure('up-1', 'invalid_key', 'private/model');
    expect(upstreams.keyStillWorks).toHaveBeenCalledWith('up-1');
    expect(update).not.toHaveBeenCalled();
    expect(upstreams.reportStatus).not.toHaveBeenCalled();
    expect(s.isRouteCooling('private/model', 'up-1')).toBe(false);
  });

  it('recordFailure：invalid_key 自检失败 → 原逻辑标 invalid；额度类不自检', async () => {
    const bad = scheduler(false);
    await bad.s.recordFailure('up-1', 'invalid_key', 'private/model');
    expect(bad.update).toHaveBeenCalled();
    expect(bad.upstreams.reportStatus).toHaveBeenCalledWith(
      'up-1',
      'invalid',
      'gateway',
      'invalid_key',
    );
    const quota = scheduler(true);
    await quota.s.recordFailure('up-1', 'quota_exhausted', 'private/model');
    expect(quota.upstreams.keyStillWorks).not.toHaveBeenCalled();
    expect(quota.upstreams.reportStatus).toHaveBeenCalledWith(
      'up-1',
      'quota_exhausted',
      'gateway',
      'quota_exhausted',
    );
  });
});

describe('媒体网关：自检通过的 invalid_key 改成 content_rejected', () => {
  const input = {
    userId: '00000000-0000-4000-8000-000000000001',
    voiceId: '00000000-0000-4000-8000-000000000002',
    text: '你好，微伴。',
    purpose: 'voice' as const,
    billingOwner: 'user' as const,
    idempotencyKey: 'self-check-media',
    format: 'pcm16_24k' as const,
  };
  function media(keyOk: boolean) {
    const gateway = Object.create(ModelGatewayMedia.prototype) as ModelGatewayMedia;
    const model = {
      modelKey: 'qwen',
      upstreamId: 'up-media',
      upstreamModelId: 'qwen-audio-3.0-tts-plus',
      fake: false,
      billingBounds: { tts: { maxTextBytes: 8000, counting: 'codepoints' } },
    };
    const charge = { holdId: 'hold', usageRecordId: 'usage' };
    const fail = vi.fn().mockResolvedValue(undefined);
    const keyStillWorks = vi.fn(async () => keyOk);
    Object.assign(gateway, {
      precheck: async () => true,
      resolve: async () => ({ ok: true, value: model }),
      assets: {
        getVoice: async () => ({ enabled: true, modelKey: 'qwen', providerVoiceKey: 'system' }),
      },
      reserve: vi.fn().mockResolvedValue({ ok: true, value: charge }),
      beginCharge: async () => true,
      fail,
      upstreams: {
        get: async () => ({ kind: 'dashscope', baseUrl: 'https://media.example' }),
        withApiKey: async (_id: string, fn: (key: string) => Promise<unknown>) => fn('sk-media'),
        // T-20261104f：媒体网关改问 confirmAuthRejection（自检 + 权限类拒绝计数），返回值同 keyStillWorks。
        confirmAuthRejection: keyStillWorks,
      },
      adapter: {
        synthesizeStream: vi.fn().mockResolvedValue({ ok: false, category: 'invalid_key' }),
      },
    });
    return { gateway, fail, charge, keyStillWorks };
  }

  it('自检通过：按内容被拒记账（不改上游），调用方拿到 content_rejected', async () => {
    const { gateway, fail, charge, keyStillWorks } = media(true);
    expect(await gateway.streamSpeech(input)).toEqual({ ok: false, error: 'content_rejected' });
    expect(keyStillWorks).toHaveBeenCalledWith('up-media');
    expect(fail).toHaveBeenCalledWith(charge, 'content_rejected', undefined);
  });

  it('自检失败：仍是 invalid_key（fail 里照旧标上游 invalid），调用方拿到 provider_unavailable', async () => {
    const { gateway, fail, charge } = media(false);
    expect(await gateway.streamSpeech(input)).toEqual({ ok: false, error: 'provider_unavailable' });
    expect(fail).toHaveBeenCalledWith(charge, 'invalid_key', undefined);
  });
});

describe('同一用户反复被拦：只限制他自己的私密回复', () => {
  const at = (minutes: number) => Date.parse('2026-11-04T10:00:00Z') + minutes * MINUTE;

  it('数字只在 product-params 定义：1 小时内 5 次 → 限制 1 小时', () => {
    expect(PRIVATE_BLOCK_LIMIT).toEqual({ threshold: 5, windowMs: HOUR, limitMs: HOUR });
  });

  it('1 小时内第 5 次被拦起限制 1 小时；4 次不限制；5 次分散超过 1 小时不限制', () => {
    expect(blockLimitUntil([0, 10, 20, 30, 40].map(at))).toEqual({
      untilMs: at(40) + HOUR,
      count: 5,
    });
    expect(blockLimitUntil([0, 10, 20, 30].map(at))).toBeNull();
    expect(blockLimitUntil([0, 20, 40, 60.5, 61].map(at))).toBeNull();
    expect(blockLimitUntil([0, 0, 0, 0, 0].map(at))).toEqual({ untilMs: at(0) + HOUR, count: 5 });
  });

  it('到期按最后一次达到阈值的拦截算；限制到期后再被拦一次不会立刻重新限制', () => {
    expect(blockLimitUntil([0, 1, 2, 3, 4, 5, 6].map(at))?.untilMs).toBe(at(6) + HOUR);
    expect(blockLimitUntil([0, 10, 20, 30, 40, 100].map(at))?.untilMs).toBe(at(40) + HOUR);
  });

  it('只管用户付费的私密回复：安全判断、关怀回合、后台整理、日常聊天都不限制', () => {
    const base = { modelRole: 'adult', purpose: 'chat_reply', billingOwner: 'user' } as const;
    expect(blockLimitApplies(base)).toBe(true);
    for (const other of [
      { purpose: 'safety_check' },
      { purpose: 'safety_followup' },
      { purpose: 'memory' },
      { purpose: 'proactive' },
      { modelRole: 'chat' },
      { billingOwner: 'platform' },
    ] as const)
      expect(blockLimitApplies({ ...base, ...other })).toBe(false);
  });

  function limiter(times: number[], nowMs: number) {
    const limit = vi.fn(async () => times.map((t) => ({ at: new Date(t) })).reverse());
    const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit };
    const logger = silentLogger();
    const service = new PrivateBlockLimiter(
      { db: { select: () => chain } } as never,
      new TestClock(nowMs),
      logger as never,
    );
    return { service, logger };
  }

  it('受限时跳过并记结构化日志（只有用户 ID、次数、到期时间）；到期后、非私密回复不跳过', async () => {
    const blocks = [0, 10, 20, 30, 40].map(at);
    const reply = {
      userId: 'user-a',
      modelRole: 'adult',
      purpose: 'chat_reply',
      billingOwner: 'user',
    } as const;
    const during = limiter(blocks, at(40) + HOUR - 1);
    expect(await during.service.skips(reply)).toBe(true);
    expect(during.logger.calls.warn).toHaveBeenCalledWith(
      {
        code: 'private_block_limited',
        userId: 'user-a',
        blockedCount: 5,
        limitedUntil: new Date(at(40) + HOUR).toISOString(),
      },
      expect.any(String),
    );
    expect(await during.service.skips({ ...reply, purpose: 'safety_followup' })).toBe(false);
    const after = limiter(blocks, at(40) + HOUR);
    expect(await after.service.skips(reply)).toBe(false);
  });
});

describe('T-20261104f 权限类拒绝提醒：参数与文案', () => {
  it('数字只在 product-params 定义：10 分钟内 20 次 → 提醒，冷却 1 小时', () => {
    expect(UPSTREAM_AUTH_REJECTED_ALERT).toEqual({
      threshold: 20,
      windowMs: 10 * MINUTE,
      cooldownMs: HOUR,
    });
  });

  it('提醒文案只有上游名称、次数和时间窗，不超过契约上限 200 字；超长名称截断', () => {
    const text = upstreamAuthRejectedSummary('共享私密上游', 20, 10);
    expect(text).toContain('「共享私密上游」');
    expect(text).toContain('10 分钟内有 20 次');
    expect(text.length).toBeLessThanOrEqual(200);
    const long = upstreamAuthRejectedSummary('名'.repeat(300), 20, 10);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long).toContain('名'.repeat(40) + '」');
    expect(long).not.toContain('名'.repeat(41));
  });

  it('自检失败（密钥真坏了）不计数：只有自检通过才进提醒计数', async () => {
    const { service } = upstreamService([{ ok: false, reason: 'invalid_key' }]);
    type Noting = { noteAuthRejection(upstreamId: string): Promise<void> };
    const note = vi.spyOn(service as unknown as Noting, 'noteAuthRejection');
    expect(await service.confirmAuthRejection('up-1')).toBe(false);
    expect(note).not.toHaveBeenCalled();
    const passed = upstreamService([{ ok: true }]);
    const notePassed = vi
      .spyOn(passed.service as unknown as Noting, 'noteAuthRejection')
      .mockResolvedValue(undefined);
    expect(await passed.service.confirmAuthRejection('up-1')).toBe(true);
    expect(notePassed).toHaveBeenCalledWith('up-1');
  });
});
