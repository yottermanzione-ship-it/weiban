/**
 * 批 EJ：后台 JSON 任务截断（生产 10-20~26：memory / simulation 输出全部顶满上限）。
 * 完整 JSON 后只剩空白 → 按成功返回；其余截断带诊断（思考 / 空白 / 重复），不含正文。
 */
import { describe, expect, it } from 'vitest';
import {
  completeJsonPrefix,
  reasoningTokensOf,
  thinkingOnFields,
  truncationKind,
} from './text-adapter.js';
import { anthropicThinkingOn } from './anthropic-adapter.js';
import { thinkingBudgetFor } from '../application/gateway.js';

describe('completeJsonPrefix', () => {
  it('完整对象后只有空白：取回对象', () => {
    expect(completeJsonPrefix('{"operations":[],"summary":"a}b"}' + '\n'.repeat(3000))).toBe(
      '{"operations":[],"summary":"a}b"}',
    );
    expect(completeJsonPrefix('  {"a":"x\\"}"}  ')).toBe('{"a":"x\\"}"}');
  });

  it('没写完、后面还有内容、或不是对象：不当成功', () => {
    expect(completeJsonPrefix('{"operations":[{"action":"ADD"')).toBeNull();
    expect(completeJsonPrefix('{"a":1}{"a":1}')).toBeNull();
    expect(completeJsonPrefix('[1,2]')).toBeNull();
    expect(completeJsonPrefix('')).toBeNull();
  });
});

describe('truncationKind', () => {
  it('上游报告思考 token 或返回思考内容 = reasoning', () => {
    expect(truncationKind('{"a', { completion_tokens_details: { reasoning_tokens: 2900 } })).toBe(
      'reasoning',
    );
    expect(truncationKind('{"a', {}, { reasoning_content: '...' })).toBe('reasoning');
    expect(truncationKind('<think>x', {})).toBe('reasoning');
  });

  it('结尾大段空白 = whitespace；后半段重复 = repeat；其他不标', () => {
    expect(truncationKind('{"a":"' + ' '.repeat(500), {})).toBe('whitespace');
    const loop =
      '{"operations":[' + '{"action":"NOOP","content":"用户喜欢猫咪和下雨天"},'.repeat(30);
    expect(truncationKind(loop, {})).toBe('repeat');
    expect(truncationKind('{"a":"短"', {})).toBeUndefined();
  });
});

describe('批 EJ：后台任务保留思考、思考与正文分开预算', () => {
  it('只有记忆整理与推演开思考；预算 1024～2048，正文额度不变', () => {
    expect(thinkingBudgetFor('memory', 1000)).toBe(1024);
    expect(thinkingBudgetFor('memory', 3200)).toBe(2048);
    expect(thinkingBudgetFor('simulation', 512)).toBe(1024);
    expect(thinkingBudgetFor('chat_reply', 600)).toBe(0);
    expect(thinkingBudgetFor('behavior_planning', 150)).toBe(0);
  });

  it('有原生预算参数的上游照发；DeepSeek 等不发任何字段（不再关思考）', () => {
    expect(thinkingOnFields('qwen', 1024)).toEqual({
      enable_thinking: true,
      thinking_budget: 1024,
    });
    expect(thinkingOnFields('openrouter', 2048)).toEqual({ reasoning: { max_tokens: 2048 } });
    expect(thinkingOnFields('deepseek', 1024)).toEqual({});
  });

  it('Anthropic：新模型自适应思考；旧模型给预算且必须小于总上限，放不下不开', () => {
    expect(anthropicThinkingOn('claude-sonnet-4-6', 3000, 1024)).toEqual({
      thinking: { type: 'adaptive' },
    });
    expect(anthropicThinkingOn('claude-opus-4-5', 3000, 1024)).toEqual({
      thinking: { type: 'enabled', budget_tokens: 1024 },
    });
    expect(anthropicThinkingOn('claude-3-7-sonnet', 1000, 1024)).toEqual({});
  });

  it('思考 token：优先上游报告，否则按思考内容估算，都没有为 undefined', () => {
    expect(reasoningTokensOf({ completion_tokens_details: { reasoning_tokens: 300 } })).toBe(300);
    expect(reasoningTokensOf({}, '想'.repeat(40))).toBeGreaterThan(0);
    expect(reasoningTokensOf({})).toBeUndefined();
  });
});
