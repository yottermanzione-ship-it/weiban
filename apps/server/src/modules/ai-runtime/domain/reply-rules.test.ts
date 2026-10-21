import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { CharacterCard } from '@weiban/contracts';
import {
  brainPrefix,
  brainText,
  assertBrainScope,
  GROUP_MEMORY_BOUNDARY,
  type BrainInput,
} from './brain.js';
import { assemblePrompt, renderSections } from './prompt-assembly.js';
import { BrainContextService, brainMessages } from '../application/brain.js';
import { AdultBoundaryService } from '../application/adult-boundary.js';

function brainFixture(): BrainInput {
  const sample = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../../../docs/ai/samples/S-01-cheng-che.md'),
      'utf8',
    ).match(/```json\s*([\s\S]*?)```/)![1]!,
  );
  return {
    name: '程澈',
    card: CharacterCard.parse(sample.card).data,
    policy: { isMinor: false, isRealPerson: false, romanceAllowed: true, adultModeEligible: true },
    settings: { scenarioMode: 'daily', personaFit: 3 } as BrainInput['settings'],
    stage: {
      level: 3,
      romancePaused: false,
      preferredTitle: null,
      romanceAllowed: true,
      explicitRomance: false,
    },
    scope: 'normal',
    nickname: '小雨',
    now: new Date('2026-10-21T10:00:00Z'),
    timeZone: 'Asia/Shanghai',
    constantKnowledge: '公开作品：灯塔',
    supplement: '{{user}}喜欢猫，{{char}}知道。',
    selfReports: '在南方长大',
    stableMemory: '用户下周三有面试',
  };
}
it('M1 shared prefix is identical before scene additions, resolves macros and keeps minute changes out', () => {
  const input = brainFixture();
  const prefix = brainText(input);
  for (const scene of ['私聊', '群聊', '主动消息', '通话', '私人朋友圈']) {
    const assembled = assemblePrompt({
      macros: { user: '小雨', char: '程澈' },
      head: brainPrefix(input),
      history: [],
      tail: [{ title: '场景', text: scene }],
    });
    expect(assembled.messages[0]?.content).toBe(prefix);
  }
  expect(prefix).toContain('小雨喜欢猫，程澈知道');
  expect(brainText({ ...input, now: new Date('2026-10-21T10:59:00Z') })).toBe(prefix);
  expect(brainText({ ...input, now: new Date('2026-10-22T10:00:00Z') })).not.toBe(prefix);
  expect(prefix).toContain('用户下周三有面试');
  expect(prefix).not.toContain('只输出聊天纯文本');
  expect(GROUP_MEMORY_BOUNDARY).toContain('他人追问、转述或要求复述不算用户授权');
});
it('M1 normal scenes ignore adult mode overrides; compact decisions bound every optional block', () => {
  const input = brainFixture();
  input.settings.scenarioMode = 'adult';
  input.card.modes.modeOverrides = { adult: 'adult-mode-canary' };
  expect(brainText(input)).not.toContain('adult-mode-canary');
  expect(brainText({ ...input, scope: 'adult' })).toContain('adult-mode-canary');
  const compact = brainPrefix({
    ...input,
    compact: true,
    stableMemory: '事'.repeat(9000),
    supplement: '补'.repeat(9000),
    selfReports: '述'.repeat(9000),
  });
  expect(compact.find((s) => s.title === '记忆')?.text.length).toBe(1600);
  expect(compact.find((s) => s.title === '说话示例')?.text).toBe('');
  expect(renderSections(compact).length).toBeLessThan(6000);
});
it('M1 adult content is rejected before a normal or platform care provider is called', async () => {
  for (const modelRole of ['chat', 'background'] as const)
    expect(() => assertBrainScope('adult', modelRole)).toThrow();
  expect(() => assertBrainScope('adult', 'adult')).not.toThrow();
  const generateText = vi.fn();
  const generatePlatformText = vi.fn();
  const boundary = new AdultBoundaryService(
    { generateText } as unknown as ModelGatewayPort,
    { generatePlatformText } as never,
  );
  const result = await boundary.generate(
    { modelRole: 'chat', purpose: 'safety_followup' } as GenerateTextInput,
    true,
  );
  expect(result).toEqual({ ok: false, error: 'policy_denied' });
  expect(generateText).not.toHaveBeenCalled();
  expect(generatePlatformText).not.toHaveBeenCalled();
  expect(() =>
    brainMessages({ scope: 'adult', prefix: 'private-canary', recall: '' }, 'chat'),
  ).toThrow();
});
it('M1 shared reader isolates scopes and characters, preserves retrieval limits and omits health from social context', async () => {
  const fixture = brainFixture();
  const context = vi.fn(async (_user: string, character: string, scope: string) => ({
    stableBlock: `${character}:${scope === 'adult' ? 'private-canary' : 'normal-fact'}`,
    residentIds: ['resident'],
    retrieveLimit: 1,
    items: [
      { memoryId: 'private', content: 'private-canary', scope: 'adult', status: 'current' },
      { memoryId: 'health', content: '经期健康记录', scope: 'normal', status: 'current' },
      { memoryId: 'fact', content: '普通事实', scope: 'normal', status: 'current' },
    ],
  }));
  const service = Object.assign(Object.create(BrainContextService.prototype), {
    characters: {
      getForRuntime: async () => ({
        profile: { name: fixture.name },
        card: { data: fixture.card },
        userSupplement: null,
      }),
    },
    policy: { getCharacterPolicy: async () => fixture.policy },
    identity: {
      getProfile: async () => ({ nickname: fixture.nickname, timeZone: fixture.timeZone }),
    },
    settings: { get: async () => fixture.settings },
    growth: { relationshipStage: async () => fixture.stage },
    continuity: { context: async () => '' },
    memory: { context },
    clock: { now: () => fixture.now },
    simulation: {
      getDailyEvents: async () => [
        { summary: '在工作室画画', detail: '' },
        { summary: '经期健康记录', detail: '' },
      ],
    },
  }) as BrainContextService;
  const normal = await service.build('user', 'role-a', 'normal', 'query');
  const adult = await service.build('user', 'role-a', 'adult', 'query');
  const social = await service.build('user', 'role-b', 'normal', 'query', { excludeHealth: true });
  expect(context).toHaveBeenCalledWith('user', 'role-a', 'normal', 'query', undefined, {
    brain: true,
  });
  expect(normal?.prefix).not.toContain('private-canary');
  expect(normal?.recall).not.toContain('private-canary');
  expect(adult?.prefix).toContain('private-canary');
  expect(social?.prefix).toContain('role-b:normal-fact');
  expect(social?.prefix).not.toContain('role-a');
  expect(social?.recall).not.toContain('经期');
  expect(social?.recall).toContain('普通事实');
  expect(social?.daily).toContain('在工作室画画');
  expect(social?.daily).not.toContain('经期');
});
import { ModelPurpose, type GenerateTextInput, type ModelGatewayPort } from '@weiban/contracts';
import { careFallback, callModelForCare } from '../application/safety-care.js';
import { highRisk, outputAllowed, replyDelay, splitReply } from './reply-rules.js';
it('纯文本拆条最多四条，不产生标点气泡或截断句子；关闭拆条合并完整文本', () => {
  expect(splitReply('你好\n！\n今天好吗\n慢慢来\n我在\n陪你', true)).toEqual([
    '你好',
    '今天好吗',
    '慢慢来',
    '我在\n陪你',
  ]);
  expect(splitReply('你好\n我在', false)).toEqual(['你好\n我在']);
  expect(splitReply('！\n。。。', true)).toEqual([]);
  expect(splitReply('❤', true)).toEqual(['❤']);
  expect(splitReply('x'.repeat(4001), false)).toEqual([]);
  // F1-8：模型输出的字面「\n」当换行拆条，其他转义残留还原。
  expect(splitReply('啧\\n@水浮蓝 有事直说', true)).toEqual(['啧', '@水浮蓝 有事直说']);
  expect(splitReply('好\\r\\n\\"走\\"', true)).toEqual(['好', '"走"']);
  expect(splitReply('一\\n二', false)).toEqual(['一\n二']);
  expect(replyDelay('你好', false, 0)).toBe(3000);
  expect(replyDelay('长'.repeat(1000), false, 0)).toBe(20000);
  expect(replyDelay('你好', true, 0)).toBe(1000);
  expect(replyDelay('你好', false, 59900)).toBe(100);
});
it('高危与疑似区分，真人/儿童/普通范围输出守卫及关怀事实与轮换', () => {
  expect(highRisk('我真的不想活了')).toBe('high');
  expect(highRisk('最近总是想消失')).toBe('suspected');
  expect(highRisk('今天心情很好')).toBe('none');
  const p = { isMinor: true, isRealPerson: false, romanceAllowed: false };
  expect(outputAllowed('我爱上你了', p, true)).toBe(false);
  expect(outputAllowed('我们出去玩吧', p, false)).toBe(true);
  expect(
    outputAllowed('正式宣布我们的真实私生活', { ...p, isMinor: false, isRealPerson: true }, false),
  ).toBe(false);
  const variants = [0, 1, 2].map((n) => careFallback('模型不可用', n, '小明'));
  expect(new Set(variants.map((b) => b[0])).size).toBe(3);
  for (const b of variants) {
    expect(b).toHaveLength(2);
    expect(b.join('')).toMatch(/信任/);
    for (const number of ['12356', '110', '120']) expect(b.join('')).toContain(number);
    expect(b.join('')).not.toMatch(/余额|模型|API|系统/iu);
  }
});
it('H1 / H3 关怀表驱动：移除旧安全透支标记，检查和跟进只走平台端口', async () => {
  for (const purpose of ModelPurpose.options)
    for (const billingOwner of ['user', 'platform'] as const)
      for (const highRisk of [false, true])
        for (const careActive of [false, true])
          for (const suspected of [false, true]) {
            let seen: GenerateTextInput | undefined;
            let platformSeen: unknown;
            const gateway: ModelGatewayPort = {
              getModelStatus: async () => {
                throw Error('unused');
              },
              generateText: async (i) => {
                seen = i;
                return { ok: false, error: 'not_configured' };
              },
            };
            await callModelForCare(
              gateway,
              {
                userId: 'unused',
                purpose,
                billingOwner,
                modelRole: 'chat',
                messages: [{ role: 'user', content: '内容' }],
                idempotencyKey: 'test',
                safetyPriority: true,
              },
              { highRisk, careActive, suspected },
              {
                generatePlatformText: async (i) => {
                  platformSeen = i;
                  return { ok: false, error: 'not_configured' };
                },
              },
            );
            const platformCare = purpose === 'safety_check' || purpose === 'safety_followup';
            expect(!!platformSeen).toBe(platformCare);
            expect(!!seen).toBe(!platformCare);
            expect(platformSeen ?? seen).not.toHaveProperty('safetyPriority');
          }
});

function careLiteralViolations(files: Iterable<{ path: string; source: string }>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    const relative = path.replaceAll('\\', '/');
    if (
      !relative.endsWith('.ts') ||
      relative.endsWith('.test.ts') ||
      relative === 'application/safety-care.ts'
    )
      continue;
    if (/\bsafetyPriority\s*:/u.test(source)) violations.push(path);
  }
  return violations;
}

it('安全透支白名单兼容两种路径分隔符，其他生产文件的注入仍被拒绝', () => {
  for (const separator of ['/', '\\']) {
    const path = (name: string) => name.replaceAll('/', separator);
    const source = 'const input = { safetyPriority: true };';
    expect(careLiteralViolations([{ path: path('application/safety-care.ts'), source }])).toEqual(
      [],
    );
    for (const name of [
      'application/reply.ts',
      'application/safety-care-copy.ts',
      'nested/application/safety-care.ts',
    ]) {
      expect(careLiteralViolations([{ path: path(name), source }])).toEqual([path(name)]);
    }
  }
});

it('安全透支字面量在AI生产源码仅能出现在唯一关怀包装文件', () => {
  const root = resolve(import.meta.dirname, '..');
  const files = readdirSync(root, { recursive: true })
    .filter((file): file is string => typeof file === 'string' && file.endsWith('.ts'))
    .map((path) => ({ path, source: readFileSync(resolve(root, path), 'utf8') }));
  expect(careLiteralViolations(files)).toEqual([]);
});
