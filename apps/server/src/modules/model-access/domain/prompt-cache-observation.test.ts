import { describe, expect, it } from 'vitest';
import { applySystemMessageMode } from './system-messages.js';
import {
  PromptCacheObserver,
  type PreparedPrompt,
  type PromptObservationContext,
} from './prompt-cache-observation.js';

const context: PromptObservationContext = {
  userId: 'private-user-canary',
  characterId: 'private-character-canary',
  conversationId: 'private-conversation-canary',
  purpose: 'chat_reply',
  modelRole: 'chat',
  conversationKind: 'direct',
  promptTemplateVersion: 'chat-v1',
  modelKey: 'catalog-model-canary',
  upstreamId: 'account-canary',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'secret-api-key-canary',
};
function request(memory = 'PRIVATE_MEMORY_CANARY'): PreparedPrompt {
  return {
    protocol: 'openai',
    body: {
      model: 'provider-model-canary',
      messages: [
        { role: 'system', content: `规则\n\n【你是谁】\n角色\n\n【记忆】\n${memory}` },
        { role: 'user', content: '旧问题' },
        { role: 'assistant', content: '旧回答' },
        { role: 'user', content: '新问题' },
        { role: 'system', content: '这轮时间与生态' },
      ],
      temperature: 0.8,
      max_tokens: 1000,
    },
  };
}

describe('prompt cache observation at the prepared request boundary', () => {
  it('locates a changed memory in no_system without mistaking merged user text for the head', () => {
    const observer = new PromptCacheObserver({ now: () => 1000 });
    const converted = (memory: string, user: string) => {
      const head = `固定规则\n\n【记忆】\n${memory}`;
      return {
        context: { ...context, convertedSystemHeadChars: head.length },
        request: {
          protocol: 'openai' as const,
          body: {
            model: 'provider-model-canary',
            messages: applySystemMessageMode(
              [
                { role: 'system', content: head },
                { role: 'user', content: user },
              ],
              'no_system',
            ),
          },
        },
      };
    };
    const first = converted('旧记忆', '用户问题');
    observer.observe(first.context, first.request);
    const second = converted('新记忆', '用户问题');
    expect(observer.observe(second.context, second.request)).toMatchObject({
      firstChange: 'head_changed',
      firstChangedSection: 'memory',
    });
    const third = converted('新记忆', '修改用户问题');
    expect(observer.observe(third.context, third.request)).toMatchObject({
      firstChange: 'turn_or_dynamic_tail',
      firstChangedSection: null,
    });
  });

  it('compares each user/workload with itself despite shared API key and interleaving', () => {
    const observer = new PromptCacheObserver({ now: () => 1000 });
    expect(observer.observe(context, request()).status).toBe('first_observation');
    for (const separate of [
      { userId: 'another-user' },
      { characterId: 'another-character' },
      { conversationId: 'another-conversation' },
      { purpose: 'behavior_planning' },
      { modelRole: 'adult' },
      { promptTemplateVersion: 'daily-question-v1' },
    ])
      expect(observer.observe({ ...context, ...separate }, request('其他内容')).status).toBe(
        'first_observation',
      );
    const result = observer.observe(context, request());
    expect(result).toMatchObject({
      status: 'compared',
      firstChange: 'identical',
      routeChanged: false,
    });
    for (const secret of [...Object.values(context), 'PRIVATE_MEMORY_CANARY'])
      expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('distinguishes memory-head changes, history movement and normal turn/tail changes', () => {
    const observer = new PromptCacheObserver({ now: () => 1000 });
    observer.observe(context, request());
    expect(observer.observe(context, request('更正后的记忆'))).toMatchObject({
      firstChange: 'head_changed',
      firstChangedSection: 'memory',
      firstChangedMessageIndex: 0,
    });
    const original = request('更正后的记忆');
    const messages = original.body.messages as Record<string, unknown>[];
    const appended = {
      ...original,
      body: {
        ...original.body,
        messages: [
          ...messages.slice(0, -1),
          { role: 'assistant', content: '新回答' },
          { role: 'user', content: '下一个问题' },
          { role: 'system', content: '下一轮时间与生态' },
        ],
      },
    };
    expect(observer.observe(context, appended)).toMatchObject({
      firstChange: 'turn_or_dynamic_tail',
      matchingMessages: 4,
    });
    const shifted = {
      ...appended,
      body: { ...appended.body, messages: [messages[0], ...appended.body.messages.slice(3)] },
    };
    expect(observer.observe(context, shifted).firstChange).toBe('history_window_advanced');
  });

  it('reports actual model, route/credential, options and cache-affinity changes independently', () => {
    const observer = new PromptCacheObserver({ now: () => 1000 });
    observer.observe(context, request());
    const next = request();
    next.body = {
      ...next.body,
      model: 'replacement',
      temperature: 0.5,
      prompt_cache_key: 'opaque',
    };
    expect(observer.observe({ ...context, apiKey: 'rotated-key' }, next)).toMatchObject({
      firstChange: 'identical',
      routeChanged: true,
      modelChanged: true,
      optionsChanged: true,
      cacheKeyChanged: true,
    });
  });

  it('observes the Anthropic system blocks and media structure that are actually sent', () => {
    const observer = new PromptCacheObserver({ now: () => 1000 });
    const body = {
      model: 'claude-test',
      system: [
        { type: 'text', text: '系统\n\n【记忆】\n旧记忆', cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        { role: 'user', content: [{ type: 'image', source: { data: 'FAKE_IMAGE_A' } }] },
        { role: 'assistant', content: [{ type: 'text', text: '旧答复' }] },
        { role: 'user', content: [{ type: 'text', text: '新问题' }] },
      ],
    };
    observer.observe(context, { protocol: 'anthropic', body });
    const changed = structuredClone(body);
    changed.system[0]!.text = '系统\n\n【记忆】\n新记忆';
    expect(observer.observe(context, { protocol: 'anthropic', body: changed })).toMatchObject({
      firstChange: 'head_changed',
      firstChangedSection: 'memory',
      currentMessages: 4,
    });
    changed.messages[0]!.content = [{ type: 'image', source: { data: 'FAKE_IMAGE_B' } }];
    expect(observer.observe(context, { protocol: 'anthropic', body: changed }).firstChange).toBe(
      'history_message_changed',
    );
  });

  it('expires/evicts only bounded fingerprints and does not compare an oversized gap', () => {
    let now = 1000;
    const observer = new PromptCacheObserver({
      now: () => now,
      ttlMs: 10,
      maxScopes: 1,
      maxMessagesPerScope: 5,
    });
    observer.observe(context, request());
    now += 11;
    expect(observer.observe(context, request()).status).toBe('first_observation');
    observer.observe({ ...context, userId: 'another' }, request());
    expect(observer.observe(context, request()).status).toBe('first_observation');
    const large = request();
    large.body = {
      ...large.body,
      messages: [...(large.body.messages as unknown[]), { role: 'user', content: 'extra' }],
    };
    expect(observer.observe(context, large).status).toBe('oversized');
    expect(observer.observe(context, request()).status).toBe('first_observation');
    expect(
      observer.observe({ ...context, characterId: undefined, conversationId: undefined }, request())
        .status,
    ).toBe('unscoped');
  });
});
