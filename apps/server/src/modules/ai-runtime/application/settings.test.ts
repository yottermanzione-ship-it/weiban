import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import type { CharacterForRuntime } from '@weiban/contracts';
import { TestClock, type Database } from '../../../platform/index.js';
import { PolicyService } from '../../policy/testing.js';
import { companionSettings } from '../infra/db/schema.js';
import { CompanionSettingsService } from './settings.js';

const userId = '11111111-1111-4111-8111-111111111111';
const characterId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

/**
 * 旧卡角色：只有 legacyCard、没有 card，所以卡片里没有 modes.adminAllowlist。
 * 这正是线上 677 张旧卡的形态。
 */
function legacyRole(
  classification: {
    basis?: 'original' | 'real_person';
    realPersonKind?: 'celebrity' | null;
    ageSetting?: 'adult' | 'minor';
  } = {},
): CharacterForRuntime {
  return {
    profile: { kind: 'preset' },
    classification: {
      basis: 'original',
      realPersonKind: null,
      ageSetting: 'adult',
      childAppearance: false,
      childFeaturesDetected: false,
      ...classification,
    },
    card: null,
    legacyCard: {},
    personaVersion: 1,
    fallbackGreetings: [],
    userSupplement: null,
  } as unknown as CharacterForRuntime;
}

interface SettingsRow {
  id: string;
  userId: string;
  characterId: string | null;
  instantReply: boolean;
  splitBubbles: boolean;
  personaFit: number;
  scenarioMode: string;
  proactiveMessages: boolean;
  proactiveFrequency: string;
  proactiveCalls: boolean;
  dailyLife: boolean;
  voiceId: string | null;
  updatedAt: Date;
}

interface SystemMessageInput {
  conversationId: string;
  code: string;
  params?: Record<string, string | number | boolean>;
  idempotencyKey: string;
}

/** 只实现 settings.get 用到的查询形状（select.from.where / update.set.where / tx.query）。 */
function selectResult(rows: unknown[]) {
  return {
    for: async () => rows,
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
}

function setup(
  options: {
    role?: CharacterForRuntime;
    scenarioMode?: string;
    adultModel?: { available: boolean; reason: 'not_configured' };
  } = {},
) {
  const role = options.role ?? legacyRole();
  const clock = new TestClock('2026-10-25T02:12:00.000Z');
  const row: SettingsRow = {
    id: '44444444-4444-4444-8444-444444444444',
    userId,
    characterId,
    instantReply: false,
    splitBubbles: true,
    personaFit: 3,
    scenarioMode: options.scenarioMode ?? 'daily',
    proactiveMessages: true,
    proactiveFrequency: 'medium',
    proactiveCalls: false,
    dailyLife: true,
    voiceId: null,
    // 与测试时钟不同，复现线上「幂等键取上一次 updatedAt」会随时间变化的场景。
    updatedAt: new Date('2026-10-24T18:12:00.000Z'),
  };
  const settingWrites: Array<{ scenarioMode?: string; updatedAt?: Date }> = [];
  // 真实 chat 按 idempotencyKey 去重；这里同样按 key 只留一条，另记全部尝试供断言键稳定。
  const attempts: SystemMessageInput[] = [];
  const posted = new Map<string, SystemMessageInput>();
  const digests = {
    enqueue: vi.fn(async (_tx: unknown, _input: { eventKey: string }) => undefined),
  };
  const tx = {
    query: async () => ({ rows: [], rowCount: 0 }),
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => selectResult(table === companionSettings ? [{ ...row }] : []),
        }),
      }),
      update: (table: unknown) => ({
        set: (values: { scenarioMode?: string; updatedAt?: Date }) => ({
          where: async () => {
            if (table !== companionSettings) throw new Error('测试桩只处理 companion_settings');
            settingWrites.push(values);
            Object.assign(row, values);
          },
        }),
      }),
    },
  };
  const database = {
    transaction: async (work: (transaction: unknown) => Promise<unknown>) => work(tx),
  } as unknown as Database;
  const contacts = {
    getActiveContact: async () => ({ conversationId }),
    getActiveContactEpoch: async () => ({ version: 1 }),
  };
  const chat = {
    postSystemMessage: vi.fn(async (_tx: unknown, input: SystemMessageInput) => {
      attempts.push(input);
      if (!posted.has(input.idempotencyKey)) posted.set(input.idempotencyKey, input);
      return { id: 'message' };
    }),
    setContentScope: vi.fn(async () => ({ ok: true as const, value: undefined })),
  };
  const characters = { getForRuntime: async () => role };
  const policy = new PolicyService(
    characters as unknown as ConstructorParameters<typeof PolicyService>[0],
    { record: async () => undefined } as unknown as ConstructorParameters<typeof PolicyService>[1],
  );
  const args = [
    database,
    clock,
    { getAccountStatus: async () => 'active' },
    contacts,
    { appendUpdate: async () => undefined },
    policy,
    characters,
    chat,
    {
      getAdultModelStatus: async () => options.adultModel ?? { available: true, reason: null },
    },
    {},
    {},
    digests,
  ] as unknown as ConstructorParameters<typeof CompanionSettingsService>;
  return {
    service: new CompanionSettingsService(...args),
    row,
    clock,
    settingWrites,
    attempts,
    posted,
    chat,
    digests,
  };
}

it('旧卡没有 modes.adminAllowlist 时按「不限制」返回日常与自动，而不是空列表', async () => {
  const { service } = setup();
  const ids = (await service.listModes(userId, characterId)).items.map((mode) => mode.id);
  expect(ids).toContain('daily');
  expect(ids).toContain('auto');
  expect(ids).toEqual(['auto', 'daily', 'treehole', 'tsundere', 'cheer', 'adult']);
});

it('空白名单不会让儿童角色拿到不具备资格的模式', async () => {
  const { service } = setup({ role: legacyRole({ ageSetting: 'minor' }) });
  const ids = (await service.listModes(userId, characterId)).items.map((mode) => mode.id);
  expect(ids).toContain('daily');
  expect(ids).not.toContain('adult');
  expect(ids).not.toContain('romance');
});

it('已经是日常时再次进入聊天不再写设置、不再发系统提示', async () => {
  const { service, settingWrites, posted, chat, digests } = setup({ scenarioMode: 'daily' });
  const first = await service.get(userId, characterId);
  const second = await service.get(userId, characterId);
  expect(first.scenarioMode).toBe('daily');
  expect(second.scenarioMode).toBe('daily');
  expect(settingWrites).toHaveLength(0);
  expect(chat.postSystemMessage).not.toHaveBeenCalled();
  expect(posted.size).toBe(0);
  expect(digests.enqueue).not.toHaveBeenCalled();
});

it('真正的回落只保留一条提示，幂等键不随写入时间变化', async () => {
  const t = setup({
    scenarioMode: 'adult',
    adultModel: { available: false, reason: 'not_configured' },
  });
  const first = await t.service.get(userId, characterId);
  expect(first.scenarioMode).toBe('daily');
  expect(t.settingWrites).toHaveLength(1);
  expect(t.posted.size).toBe(1);

  // 模拟设置行又被写成 adult（例如另一台设备），且写入时间已经变化。
  t.row.scenarioMode = 'adult';
  t.row.updatedAt = new Date('2026-10-25T02:13:00.000Z');
  t.clock.advance(60_000);
  const second = await t.service.get(userId, characterId);
  expect(second.scenarioMode).toBe('daily');

  expect(t.attempts).toHaveLength(2);
  expect(t.attempts[0]?.idempotencyKey).toBe(t.attempts[1]?.idempotencyKey);
  // 同一用户、同一角色、同一原因只产生一条可见提示（真实 chat 按幂等键去重）。
  expect(t.posted.size).toBe(1);
  expect(t.digests.enqueue).toHaveBeenCalledTimes(2);
  const digestKeys = t.digests.enqueue.mock.calls.map((call) => call[1].eventKey);
  expect(digestKeys[0]).toBe(digestKeys[1]);
});
