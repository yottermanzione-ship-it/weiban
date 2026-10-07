import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
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
it('安全透支表驱动：全部用途×账户×高危×关怀×疑似，仅规定组合可携带', async () => {
  for (const purpose of ModelPurpose.options)
    for (const billingOwner of ['user', 'platform'] as const)
      for (const highRisk of [false, true])
        for (const careActive of [false, true])
          for (const suspected of [false, true]) {
            let seen: GenerateTextInput | undefined;
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
              },
              { highRisk, careActive, suspected },
            );
            const allowed =
              billingOwner === 'user' &&
              ['chat_reply', 'safety_check', 'safety_followup'].includes(purpose) &&
              (highRisk || careActive || (suspected && purpose === 'safety_check'));
            expect(seen?.safetyPriority === true).toBe(allowed);
          }
});

it('安全透支字面量在AI生产源码仅能出现在唯一关怀包装文件', () => {
  const root = resolve(import.meta.dirname, '..');
  for (const file of readdirSync(root, { recursive: true })) {
    if (
      typeof file !== 'string' ||
      !file.endsWith('.ts') ||
      file.endsWith('.test.ts') ||
      file === 'application/safety-care.ts'
    )
      continue;
    expect(readFileSync(resolve(root, file), 'utf8'), file).not.toMatch(/\bsafetyPriority\s*:/u);
  }
});
