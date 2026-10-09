import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type {
  ContactsReadPort,
  IdentityAccountStatusPort,
  ModelGatewayPort,
} from '@weiban/contracts';
import {
  Database,
  TestClock,
  newId,
  type JobQueue,
  type EnvelopeCrypto,
} from '../src/platform/index.js';
import { Migrator } from '../src/platform/db/migrator.js';
import { SimulationService, ReplyPlanStore } from '../src/modules/ai-runtime/testing.js';
import {
  describeDb,
  resetTestDatabase,
  requireTestDatabaseUrl,
  MIGRATIONS_DIR,
} from './support/db.js';

describeDb('T-051 推演真实PG：迁移、预算、幂等、活跃与迟到注销', () => {
  let db: Database;
  let service: SimulationService;
  let active = true;
  let epoch = 'relationship-1';
  const userId = newId();
  const characterId = newId();
  const clock = new TestClock('2026-10-09T10:00:00Z');
  const jobs = { send: vi.fn().mockResolvedValue(newId()) } as unknown as JobQueue;
  const accounts: IdentityAccountStatusPort = {
    getAccountStatus: async () => (active ? 'active' : 'deleting'),
  };
  const contacts: ContactsReadPort = {
    getActiveContactEpoch: async () => ({ version: epoch, acceptAfter: '2026-10-01T00:00:00Z' }),
    getActiveContact: async () => null,
    listActiveContacts: async () => [],
    getPendingGreeting: async () => null,
  };
  const generate = vi.fn<ModelGatewayPort['generateText']>();
  const gateway: ModelGatewayPort = {
    generateText: generate,
    getModelStatus: async () => {
      throw new Error('unused');
    },
  };
  const output = (n = 3) =>
    JSON.stringify({
      events: Array.from({ length: n }, (_, i) => ({ kind: 'work', summary: `日常事件${i}` })),
      overallMood: 'happy',
    });
  const result = (text = output()) => ({
    ok: true as const,
    value: {
      text,
      modelKey: 'test/model',
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, estimated: false },
      chargedMicros: 1,
      latencyMs: 1,
      usageRecordId: newId(),
    },
  });

  beforeAll(async () => {
    await resetTestDatabase();
    db = new Database({ url: requireTestDatabaseUrl() });
    service = new SimulationService(db, clock, jobs, gateway, accounts, contacts);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.query(
      'TRUNCATE ai_runtime.simulation_states, ai_runtime.daily_events, ai_runtime.mood_states',
    );
    active = true;
    epoch = 'relationship-1';
    clock.set('2026-10-09T10:00:00Z');
    generate.mockReset().mockResolvedValue(result());
    jobs.send = vi.fn().mockResolvedValue(newId());
    await db.transaction((tx) => service.markActive(tx, userId, characterId));
  });

  it('迁移已登记，实际回滚再执行后三张表可用', async () => {
    const migrator = new Migrator(requireTestDatabaseUrl(), MIGRATIONS_DIR);
    expect(await migrator.down()).toEqual(['0019_simulation_engine']);
    expect(await migrator.up()).toEqual(['0019_simulation_engine']);
    expect(
      (await db.query("SELECT to_regclass('ai_runtime.daily_events') AS name")).rows[0],
    ).toEqual({ name: 'ai_runtime.daily_events' });
  });

  it('日报调度与生成走后台网关，同日重跑不重复事件或模型调用', async () => {
    await service.runDailySimulations();
    expect(jobs.send).toHaveBeenCalledWith(
      'ai.simulate_character',
      { userId, characterId },
      expect.anything(),
    );
    await service.simulateCharacter(userId, characterId);
    await service.simulateCharacter(userId, characterId);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'simulation',
        modelRole: 'background',
        countAsBackground: true,
      }),
    );
    expect(await service.getDailyEvents(userId, characterId, '2026-10-09')).toHaveLength(3);
    expect(await service.getCurrentMood(userId, characterId)).toBe('happy');
  });

  it('余额/后台预算不足静默暂停，恢复预算后可继续', async () => {
    generate.mockResolvedValueOnce({ ok: false, error: 'budget_exceeded' });
    await service.simulateCharacter(userId, characterId);
    expect(await service.getDailyEvents(userId, characterId, '2026-10-09')).toEqual([]);
    expect(
      (await db.query('SELECT paused_reason FROM ai_runtime.simulation_states')).rows[0],
    ).toEqual({ paused_reason: 'budget_exceeded' });
    await service.simulateCharacter(userId, characterId);
    expect(await service.getDailyEvents(userId, characterId, '2026-10-09')).toHaveLength(3);
  });

  it('P-17七天不活跃停止生成，活跃更新后恢复', async () => {
    clock.advance(7 * 86400_000);
    await service.simulateCharacter(userId, characterId);
    expect(generate).not.toHaveBeenCalled();
    await db.transaction((tx) => service.markActive(tx, userId, characterId));
    await service.simulateCharacter(userId, characterId);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([2, 7])('P-15范围外的%s条事件不入库', async (n) => {
    generate.mockResolvedValue(result(output(n)));
    await service.simulateCharacter(userId, characterId);
    expect(await service.getDailyEvents(userId, characterId, '2026-10-09')).toEqual([]);
    expect(await service.getCurrentMood(userId, characterId)).toBe('neutral');
  });

  it('关系恢复期间迟到生成不能写入新关系', async () => {
    generate.mockImplementation(async () => {
      epoch = 'relationship-2';
      return result();
    });
    await service.simulateCharacter(userId, characterId);
    expect(await service.getDailyEvents(userId, characterId, '2026-10-09')).toEqual([]);
  });

  it('注销清理包含全部推演数据，迟到生成不能复原', async () => {
    const store = new ReplyPlanStore(db, clock, {} as EnvelopeCrypto, jobs, accounts);
    await service.simulateCharacter(userId, characterId);
    expect(await store.countUserData(userId)).toBe(5);
    expect(await store.purgeUser(userId)).toBe(5);
    expect(await store.countUserData(userId)).toBe(0);
    await db.transaction((tx) => service.markActive(tx, userId, characterId));
    generate.mockImplementation(async () => {
      active = false;
      await store.purgeUser(userId);
      return result();
    });
    await service.simulateCharacter(userId, characterId);
    expect(await store.countUserData(userId)).toBe(0);
  });
});
