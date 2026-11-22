import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicCacheUsage, openAiCacheUsage, recordedCacheUsage } from './cache-usage.js';
import { anthropicUsage, AnthropicTextAdapter } from './anthropic-adapter.js';
import { billableUsage, OpenAiTextAdapter, type TextAdapter } from './text-adapter.js';

afterEach(() => vi.restoreAllMocks());

describe('cache reporting is independent from billing estimates', () => {
  it('distinguishes missing cache usage, explicit zero and malformed values', () => {
    expect(openAiCacheUsage({ prompt_tokens: 100 })).toMatchObject({ state: 'missing' });
    expect(
      openAiCacheUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } }),
    ).toMatchObject({ state: 'reported', source: 'openai', cachedInputTokens: 0 });
    for (const cached_tokens of [-1, 101, '80', 1.5, Infinity])
      expect(
        openAiCacheUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens } }).state,
      ).toBe('invalid');
  });

  it('uses the same DeepSeek precedence as billing, including an explicit zero', () => {
    expect(
      openAiCacheUsage({
        prompt_tokens: 100,
        prompt_cache_hit_tokens: 0,
        prompt_tokens_details: { cached_tokens: 90 },
      }),
    ).toMatchObject({ state: 'reported', source: 'deepseek', cachedInputTokens: 0 });
  });

  it('counts Anthropic uncached, read and both write tiers exactly once', () => {
    const raw = {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 90,
      cache_creation: { ephemeral_5m_input_tokens: 50, ephemeral_1h_input_tokens: 40 },
    };
    const usage = anthropicUsage(raw, 25, 'synthetic output');
    expect(usage.cacheUsage).toEqual({
      version: 1,
      state: 'reported',
      source: 'anthropic',
      totalInputTokens: 1000,
      cachedInputTokens: 900,
    });
    expect(billableUsage(usage)).toEqual({
      inputTokens: 10,
      cachedInputTokens: 900,
      cacheWrite5mTokens: 50,
      cacheWrite1hTokens: 40,
      outputTokens: 20,
    });
  });

  it('does not turn Anthropic missing cache fields into a confirmed miss', () => {
    const usage = anthropicUsage({ input_tokens: 100, output_tokens: 20 }, 25, 'synthetic');
    expect(usage.cacheUsage?.state).toBe('missing');
    expect(usage.estimated).toBe(false);
    expect(billableUsage(usage)).toEqual({
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 20,
    });
    expect(
      anthropicCacheUsage({
        input_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      }),
    ).toMatchObject({ state: 'reported', totalInputTokens: 100, cachedInputTokens: 0 });
  });

  it('flags malformed and contradictory Anthropic cache quantities without changing billing', () => {
    const base = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 90 };
    expect(anthropicCacheUsage({ ...base, cache_creation_input_tokens: -5 }).state).toBe('invalid');
    expect(
      anthropicCacheUsage({
        ...base,
        cache_creation_input_tokens: 10,
        cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 6 },
      }).state,
    ).toBe('invalid');
    expect(anthropicCacheUsage({ ...base, cache_creation_input_tokens: null }).state).toBe(
      'missing',
    );
  });

  it('does not reinterpret historical normalized zero or malformed diagnostics as reported', () => {
    expect(recordedCacheUsage(undefined)).toBeNull();
    expect(recordedCacheUsage({ inputTokens: 100, cachedInputTokens: 0 })).toBeNull();
    expect(
      recordedCacheUsage({
        version: 1,
        state: 'reported',
        source: 'openai',
        totalInputTokens: 100,
        cachedInputTokens: 200,
      }),
    ).toBeNull();
  });
});

const input: Parameters<TextAdapter['generate']>[0] = {
  baseUrl: 'https://upstream.invalid/v1',
  apiKey: 'fake-secret',
  model: 'test-model',
  messages: [
    { role: 'system', content: 'synthetic stable context', cacheBreakpoint: true },
    { role: 'user', content: 'synthetic question' },
  ],
  maxOutputTokens: 100,
  idempotencyKey: 'synthetic-call',
  timeoutMs: 1000,
};

describe('final serialized request observation', () => {
  it.each(['openai', 'anthropic'] as const)(
    '%s observes the exact request without credentials',
    async (protocol) => {
      const payload =
        protocol === 'openai'
          ? {
              choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 10,
                prompt_tokens_details: { cached_tokens: 0 },
              },
            }
          : {
              content: [{ type: 'text', text: 'answer' }],
              stop_reason: 'end_turn',
              usage: {
                input_tokens: 100,
                output_tokens: 10,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            };
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(payload));
      const observed = vi.fn();
      const adapter = protocol === 'openai' ? new OpenAiTextAdapter() : new AnthropicTextAdapter();
      const result = await adapter.generate({ ...input, onRequestPrepared: observed });
      expect(result).toMatchObject({
        ok: true,
        usage: { cacheUsage: { state: 'reported', cachedInputTokens: 0 } },
      });
      const sent = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      expect(observed).toHaveBeenCalledExactlyOnceWith({ protocol, body: sent });
      expect(JSON.stringify(observed.mock.calls)).not.toContain('fake-secret');
    },
  );

  it.each(['openai', 'anthropic'] as const)(
    '%s observation failure cannot alter or stop the request',
    async (protocol) => {
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(Response.json({}, { status: 500 }));
      const adapter = protocol === 'openai' ? new OpenAiTextAdapter() : new AnthropicTextAdapter();
      await adapter.generate({
        ...input,
        onRequestPrepared: ({ body }) => {
          (body as Record<string, unknown>).model = 'changed by observer';
          throw new Error('synthetic observer failure');
        },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).model).toBe('test-model');
    },
  );
});
