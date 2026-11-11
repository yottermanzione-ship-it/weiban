import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiTextAdapter, stripReasoning, type TextAdapter } from './text-adapter.js';

const input: Parameters<TextAdapter['generate']>[0] = {
  baseUrl: 'https://upstream.invalid/v1',
  apiKey: 'fake-key',
  model: 'test-model',
  messages: [{ role: 'user', content: '合成测试消息' }],
  maxOutputTokens: 400,
  responseFormat: 'text',
  idempotencyKey: 'test-call',
  timeoutMs: 1000,
};

function respond(content: string | null, finishReason: string, reasoningTokens: number) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    Response.json({
      choices: [{ message: { content }, finish_reason: finishReason }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: finishReason === 'length' ? 400 : 12,
        completion_tokens_details: { reasoning_tokens: reasoningTokens },
      },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('OpenAI 兼容纯文本结束原因', () => {
  it.each(['这是尚未结束的部分内容', null])('思考占用额度后的截断可以重试', async (content) => {
    respond(content, 'length', 165);
    const result = await new OpenAiTextAdapter().generate(input);
    expect(result).toMatchObject({
      ok: false,
      category: 'truncated',
      retryable: true,
      finishReason: 'length',
      truncation: 'reasoning',
      usage: { outputTokens: 400, reasoningTokens: 165 },
    });
    expect(result).not.toHaveProperty('partialText');
  });

  it.each([
    { finishReason: 'stop', reasoningTokens: 3 },
    { finishReason: 'length', reasoningTokens: 0 },
  ])('保留原有正常纯文本返回', async ({ finishReason, reasoningTokens }) => {
    const text = '行，那我先睡了，明天聊。';
    respond(text, finishReason, reasoningTokens);
    expect(await new OpenAiTextAdapter().generate(input)).toMatchObject({
      ok: true,
      text,
      finishReason,
    });
  });

  it('完整 JSON 仍可在耗尽总额度时使用', async () => {
    respond('{"summary":"合成结果"}', 'length', 165);
    expect(
      await new OpenAiTextAdapter().generate({ ...input, responseFormat: 'json' }),
    ).toMatchObject({ ok: true, text: '{"summary":"合成结果"}', finishReason: 'length' });
  });
});

describe('只剥除明确标记的英文思考段', () => {
  it('识别带空行的 Thinking 标题和只有思考的 Reasoning 标题', () => {
    expect(stripReasoning('Thinking:\r\nI should answer.\r\n\r\nGood night.')).toBe('Good night.');
    expect(stripReasoning('Reasoning: The reply is still missing.')).toBe('');
  });

  it('没有标题的分析原样交给出站检查', () => {
    const text = '我们需要回答群聊。需要判断角色。没有指定是谁。';
    expect(stripReasoning(text)).toBe(text);
  });
});
