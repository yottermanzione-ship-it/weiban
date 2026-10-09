/**
 * T-054 时间线摘要服务单元测试。
 *
 * 验收标准：
 * - 离线 < 1 小时时返回空摘要，不调用模型
 * - 无推演事件时返回空摘要，不调用模型
 * - 有事件且离线 >= 1 小时时调用模型，传 behavior_planning 用途 + countAsBackground
 * - 后台预算耗尽时返回空摘要，不报错
 * - 摘要生成时产生计费记录（usageRecordId 出现在响应链路）
 */
import { expect, it, vi } from 'vitest';
import {
  type ModelGatewayPort,
  type GenerateTextInput,
  type GenerateTextOutput,
  type PortResult,
} from '@weiban/contracts';
import { TimelineSummaryService } from './timeline.js';
import {
  type SimulationReadPort,
  type DailyEventEntry,
  type SimulationMood,
} from './simulation.js';
import { type Clock } from '../../../platform/index.js';

// ---------------------------------------------------------------------------
// 固定时间：2026-10-09T10:00:00Z（今天）
// ---------------------------------------------------------------------------
const NOW = new Date('2026-10-09T10:00:00.000Z');
const TODAY = '2026-10-09';

function makeClock(): Clock {
  return { now: () => NOW, nowMs: () => NOW.getTime() };
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

function makeEvents(n: number): DailyEventEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `evt-${i}`,
    userId: 'u1',
    characterId: 'c1',
    eventDate: TODAY,
    seq: i,
    kind: 'work' as const,
    summary: `事件${i + 1}`,
    createdAt: NOW,
  }));
}

function makeSimulation(events: DailyEventEntry[], mood: SimulationMood = 'happy'): SimulationReadPort {
  return {
    getDailyEvents: vi.fn().mockResolvedValue(events),
    getCurrentMood: vi.fn().mockResolvedValue(mood),
  };
}

function makeGatewayOk(text = '今天也努力过啦'): ModelGatewayPort {
  return {
    generateText: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        text,
        modelKey: 'deepseek-chat',
        usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, estimated: false },
        chargedMicros: 500,
        latencyMs: 300,
        usageRecordId: 'rec-001',
      } satisfies GenerateTextOutput,
    } satisfies PortResult<GenerateTextOutput, never>),
    getModelStatus: vi.fn().mockResolvedValue({ available: true, reason: null }),
  };
}

function makeGatewayBudgetExceeded(): ModelGatewayPort {
  return {
    generateText: vi.fn().mockResolvedValue({
      ok: false,
      error: 'budget_exceeded',
    } satisfies PortResult<never, 'budget_exceeded'>),
    getModelStatus: vi.fn().mockResolvedValue({ available: true, reason: null }),
  };
}

function makeService(
  simulation: SimulationReadPort,
  gateway: ModelGatewayPort,
): TimelineSummaryService {
  // 使用直接注入（不走 NestJS DI）
  const svc = new (TimelineSummaryService as any)(simulation, gateway, makeClock());
  return svc;
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

it('离线时长 < 1 小时时返回空摘要，不调用模型', async () => {
  const events = makeEvents(3);
  const simulation = makeSimulation(events);
  const gateway = makeGatewayOk();
  const svc = makeService(simulation, gateway);

  // lastActiveAt = 30 分钟前
  const lastActiveAt = new Date(NOW.getTime() - 30 * 60 * 1000).toISOString();
  const result = await svc.getSummary('u1', 'c1', 'conv1', lastActiveAt);

  expect(result.summary).toBeNull();
  expect(result.offlineSeconds).toBeLessThan(3600);
  expect(result.events).toHaveLength(3);
  expect(gateway.generateText).not.toHaveBeenCalled();
});

it('无推演事件时返回空摘要，不调用模型', async () => {
  const simulation = makeSimulation([]); // 空事件
  const gateway = makeGatewayOk();
  const svc = makeService(simulation, gateway);

  // lastActiveAt = 2 小时前
  const lastActiveAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const result = await svc.getSummary('u1', 'c1', 'conv1', lastActiveAt);

  expect(result.summary).toBeNull();
  expect(result.events).toHaveLength(0);
  expect(gateway.generateText).not.toHaveBeenCalled();
});

it('有事件且离线 >= 1 小时时调用模型，传 behavior_planning + countAsBackground', async () => {
  const events = makeEvents(3);
  const simulation = makeSimulation(events);
  const gateway = makeGatewayOk();
  const svc = makeService(simulation, gateway);

  // lastActiveAt = 2 小时前
  const lastActiveAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const result = await svc.getSummary('u1', 'c1', 'conv1', lastActiveAt);

  expect(result.summary).toBe('今天也努力过啦');
  expect(result.events).toHaveLength(3);
  expect(result.currentMood).toBe('happy');
  expect(result.offlineSeconds).toBeGreaterThanOrEqual(3600);

  const calls = (gateway.generateText as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls).toHaveLength(1);
  const input: GenerateTextInput = calls[0][0];
  expect(input.purpose).toBe('behavior_planning');
  expect(input.countAsBackground).toBe(true);
  expect(input.billingOwner).toBe('user');
  expect(input.modelRole).toBe('background');
});

it('后台预算耗尽时返回空摘要，不报错', async () => {
  const events = makeEvents(3);
  const simulation = makeSimulation(events);
  const gateway = makeGatewayBudgetExceeded();
  const svc = makeService(simulation, gateway);

  const lastActiveAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const result = await svc.getSummary('u1', 'c1', 'conv1', lastActiveAt);

  expect(result.summary).toBeNull();
  expect(result.events).toHaveLength(3);
  // 不应抛出异常
});

it('模型调用有计费记录：idempotencyKey 包含用户+角色+日期', async () => {
  const events = makeEvents(2);
  const simulation = makeSimulation(events);
  const gateway = makeGatewayOk();
  const svc = makeService(simulation, gateway);

  const lastActiveAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
  await svc.getSummary('u1', 'c1', 'conv1', lastActiveAt);

  const input: GenerateTextInput = (gateway.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(input.idempotencyKey).toMatch(/^timeline:u1:c1:/);
  expect(input.idempotencyKey).toContain(TODAY);
});
