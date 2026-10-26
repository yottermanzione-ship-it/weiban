/**
 * 批 EJ：后台 JSON 任务截断（生产 10-20~26：memory / simulation 输出全部顶满上限）。
 * 完整 JSON 后只剩空白 → 按成功返回；其余截断带诊断（思考 / 空白 / 重复），不含正文。
 */
import { describe, expect, it } from 'vitest';
import { completeJsonPrefix, truncationKind } from './text-adapter.js';

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
