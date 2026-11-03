/**
 * T-20261103j：上游安全策略拦截归为 content_rejected，不当成密钥失效（invalid_key）。
 * 2026-11-03 Abliteration 对一条消息回 403 `{"error":{"code":"policy_violation","type":"policy_error"}}`，
 * 原先落到 401/403 → invalid_key，整个上游被标不可用。测试数据全部自造，不经网络（替换 fetch）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAiTextAdapter,
  SAFETY_POLICY_CODES,
  isSafetyPolicyBlock,
  type TextAdapter,
} from './text-adapter.js';
import { AnthropicTextAdapter, classifyAnthropicError } from './anthropic-adapter.js';

type Input = Parameters<TextAdapter['generate']>[0];
const input = (over: Partial<Input> = {}): Input => ({
  baseUrl: 'https://upstream.invalid/v1',
  apiKey: 'sk-test-not-real',
  model: 'test-model',
  messages: [{ role: 'user', content: '测试消息' }],
  maxOutputTokens: 100,
  idempotencyKey: 'idem-1',
  timeoutMs: 5000,
  ...over,
});
const POLICY_BODY = {
  error: {
    code: 'policy_violation',
    type: 'policy_error',
    message: 'The request was blocked by a safety policy.',
  },
};

function respond(status: number, body: string, contentType = 'application/json') {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': contentType } }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('安全策略名单（唯一定义）', () => {
  it('code 命中名单或 type = policy_error 即为安全策略拦截，不区分大小写', () => {
    expect(SAFETY_POLICY_CODES).toEqual(
      expect.arrayContaining([
        'content_filter',
        'content_policy_violation',
        'moderation_blocked',
        'policy_violation',
      ]),
    );
    expect(isSafetyPolicyBlock(POLICY_BODY.error)).toBe(true);
    expect(isSafetyPolicyBlock({ code: 'policy_violation' })).toBe(true);
    expect(isSafetyPolicyBlock({ type: 'policy_error' })).toBe(true);
    expect(isSafetyPolicyBlock({ code: 'Content_Filter' })).toBe(true);
    expect(isSafetyPolicyBlock({ code: 'invalid_api_key', type: 'authentication_error' })).toBe(
      false,
    );
    expect(isSafetyPolicyBlock({ message: 'blocked' })).toBe(false);
    expect(isSafetyPolicyBlock(undefined)).toBe(false);
    expect(isSafetyPolicyBlock('policy_violation')).toBe(false);
  });
});

describe('OpenAI 兼容适配器（非流式）', () => {
  const adapter = new OpenAiTextAdapter();

  it('403 + policy_violation（生产实际正文）→ content_rejected', async () => {
    respond(403, JSON.stringify(POLICY_BODY));
    expect(await adapter.generate(input())).toMatchObject({
      ok: false,
      category: 'content_rejected',
      retryable: false,
    });
  });

  it('403 + 只有 type = policy_error → content_rejected', async () => {
    respond(403, JSON.stringify({ error: { type: 'policy_error', message: 'blocked' } }));
    expect(await adapter.generate(input())).toMatchObject({
      ok: false,
      category: 'content_rejected',
    });
  });

  it('400 / 401 带安全策略正文同样 → content_rejected；原有 content_filter 不变', async () => {
    for (const [status, body] of [
      [400, POLICY_BODY],
      [401, POLICY_BODY],
      [400, { error: { code: 'content_filter' } }],
      [403, { error: { code: 'moderation_blocked' } }],
    ] as const) {
      respond(status, JSON.stringify(body));
      expect(await adapter.generate(input()), `${status}`).toMatchObject({
        ok: false,
        category: 'content_rejected',
      });
      vi.restoreAllMocks();
    }
  });

  it('401 / 403 不带安全策略正文仍是 invalid_key（含非 JSON 正文）', async () => {
    for (const [status, body] of [
      [401, JSON.stringify({ error: { message: 'Incorrect API key provided' } })],
      [403, JSON.stringify({ error: { code: 'forbidden', type: 'permission_error' } })],
      [403, '<html>Forbidden</html>'],
    ] as const) {
      respond(status, body);
      expect(await adapter.generate(input()), `${status} ${body}`).toMatchObject({
        ok: false,
        category: 'invalid_key',
        retryable: false,
      });
      vi.restoreAllMocks();
    }
  });
});

describe('Anthropic 原生适配器（流式 SSE）', () => {
  const adapter = new AnthropicTextAdapter();
  const anthropic = (over: Partial<Input> = {}) =>
    input({ protocol: 'anthropic', baseUrl: 'https://upstream.invalid', ...over });

  it('流式响应中的 error 事件是安全策略拦截 → content_rejected', async () => {
    const sse = [
      'event: message_start',
      `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 5 } } })}`,
      '',
      'event: error',
      `data: ${JSON.stringify({ type: 'error', error: { type: 'policy_error', message: 'blocked' } })}`,
      '',
    ].join('\n');
    respond(200, sse, 'text/event-stream');
    expect(await adapter.generate(anthropic())).toMatchObject({
      ok: false,
      category: 'content_rejected',
      retryable: false,
    });
  });

  it('HTTP 403 + policy_violation 错误体 → content_rejected', async () => {
    respond(403, JSON.stringify({ type: 'error', ...POLICY_BODY }));
    expect(await adapter.generate(anthropic())).toMatchObject({
      ok: false,
      category: 'content_rejected',
    });
  });

  it('401 / 403 鉴权类错误仍是 invalid_key', async () => {
    for (const [status, type] of [
      [401, 'authentication_error'],
      [403, 'permission_error'],
    ] as const) {
      respond(status, JSON.stringify({ type: 'error', error: { type, message: 'nope' } }));
      expect(await adapter.generate(anthropic()), type).toMatchObject({
        ok: false,
        category: 'invalid_key',
      });
      vi.restoreAllMocks();
    }
    expect(classifyAnthropicError(403, undefined).category).toBe('invalid_key');
    expect(classifyAnthropicError(0, { type: 'policy_error' }).category).toBe('content_rejected');
  });
});
