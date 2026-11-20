import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateTokens,
  OpenAiTextAdapter,
  stripReasoning,
  type TextAdapter,
} from './text-adapter.js';

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

describe('OpenAI 兼容回执与计量', () => {
  it('官方 OpenAI 请求用量，保留末帧的完整回执并结束已完成的流', async () => {
    const encoder = new TextEncoder();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const frame of [
              'data: {"choices":[{"delta":{"content":"你好"}}],"usage":null}\r\n\r\n',
              'data: {"choices":[{"finish_reason":"stop"}]}\r\n\r\n',
              'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":40,"prompt_tokens_details":{"cached_tokens":70},"completion_tokens_details":{"reasoning_tokens":25}}}\r\n\r\n',
              'data: [DO',
              'NE]\r\n\r\n',
            ])
              controller.enqueue(encoder.encode(frame));
            // 故意保持连接打开，结束标记后适配器无需等 TCP 关闭。
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    const result = await new OpenAiTextAdapter().generate({
      ...input,
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(result).toMatchObject({
      ok: true,
      text: '你好',
      usage: {
        inputTokens: 50,
        cachedInputTokens: 70,
        outputTokens: 40,
        reasoningTokens: 25,
        estimated: false,
      },
    });
  });

  it('直连 Abliteration 回到有用量的 JSON 请求，保留缓存亲和参数；自定义中转保持原协议', async () => {
    respond('合成测试回复', 'stop', 0);
    respond('合成测试回复', 'stop', 0);
    const fetch = vi.mocked(globalThis.fetch);
    const adapter = new OpenAiTextAdapter();
    await expect(
      adapter.generate({
        ...input,
        baseUrl: 'https://api.abliteration.ai/v1',
        promptCacheKey: 'test-affinity',
      }),
    ).resolves.toMatchObject({ ok: true, usage: { estimated: false } });
    await adapter.generate(input);
    const [direct, relay] = fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(direct).toMatchObject({ stream: false, prompt_cache_key: 'test-affinity' });
    expect(direct).not.toHaveProperty('stream_options');
    expect(relay).toMatchObject({ stream: true });
    expect(relay).not.toHaveProperty('stream_options');
  });

  it('单个 UTF-8 字符跨片且 SSE 信封超过两兆时，保留完整的短正文', async () => {
    const encoder = new TextEncoder();
    const frame =
      'data: {"choices":[{"delta":{"content":"好"}}],"padding":"' + 'x'.repeat(1024) + '"}\n\n';
    const wire = encoder.encode(frame.repeat(2048) + 'data: [DONE]\n\n');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            for (let at = 0; at < wire.length; at += 997)
              controller.enqueue(wire.slice(at, at + 997));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    await expect(new OpenAiTextAdapter().generate(input)).resolves.toMatchObject({
      ok: true,
      text: '好'.repeat(2048),
    });
  });

  it('识别流中的损坏帧，避免把半截回复交给用户', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        'data: {"choices":[{"delta":{"content":"半句话"}}]}\n\ndata: invalid\n\ndata: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    await expect(new OpenAiTextAdapter().generate(input)).resolves.toMatchObject({
      ok: false,
      category: 'provider_error',
      diagnostic: 'response_parse_error',
    });
  });

  it.each([
    { timeoutMs: 3, deadlineMs: 60, diagnostic: 'timeout_idle' },
    { timeoutMs: 60, deadlineMs: 3, diagnostic: 'timeout_deadline' },
    { timeoutMs: 5, deadlineMs: 5, diagnostic: 'timeout_deadline' },
  ])('分别记录连接空闲与整次截止时间', async ({ timeoutMs, deadlineMs, diagnostic }) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    await expect(
      new OpenAiTextAdapter().generate({ ...input, timeoutMs, deadlineMs }),
    ).resolves.toMatchObject({ ok: false, category: 'network_error', diagnostic });
  });

  function controlledStream(options: Partial<Parameters<TextAdapter['generate']>[0]> = {}) {
    let emit!: (line: string) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              emit = (line) => controller.enqueue(encoder.encode(line + '\n\n'));
              init!.signal!.addEventListener(
                'abort',
                () => controller.error(new DOMException('aborted', 'AbortError')),
                { once: true },
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const reply = new OpenAiTextAdapter().generate({
      ...input,
      timeoutMs: 90,
      deadlineMs: 100,
      failover: { progressTimeoutMs: 30, backupAvailable: () => true },
      ...options,
    });
    return { emit, reply };
  }

  it('心跳、空角色和纯空白不能给备用线路的等待窗续期', async () => {
    vi.useFakeTimers();
    try {
      const { emit, reply } = controlledStream();
      for (const line of [
        ': ping',
        'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}',
        'data: {"choices":[{"delta":{"content":"  ","reasoning_content":" "}}]}',
      ]) {
        await vi.advanceTimersByTimeAsync(9);
        emit(line);
      }
      await vi.advanceTimersByTimeAsync(3);
      await expect(reply).resolves.toMatchObject({ ok: false, diagnostic: 'timeout_progress' });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(['reasoning_content', 'content'])('持续有 %s 时保留主线，末尾正常结算', async (field) => {
    vi.useFakeTimers();
    try {
      const { emit, reply } = controlledStream();
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(24);
        emit('data: ' + JSON.stringify({ choices: [{ delta: { [field]: '合成进度' } }] }));
      }
      await vi.advanceTimersByTimeAsync(23);
      emit('data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}');
      emit('data: [DONE]');
      await expect(reply).resolves.toMatchObject({
        ok: true,
        text: expect.stringContaining('完成'),
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it('持续思考也不能延长调用方的总截止', async () => {
    vi.useFakeTimers();
    try {
      const { emit, reply } = controlledStream();
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(24);
        emit('data: {"choices":[{"delta":{"reasoning":"x"}}]}');
      }
      await vi.advanceTimersByTimeAsync(4);
      await expect(reply).resolves.toMatchObject({ ok: false, diagnostic: 'timeout_deadline' });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(['no-backup', 'unavailable-at-timeout'])('保留 %s 的原始等待窗口', async (kind) => {
    vi.useFakeTimers();
    try {
      const { emit, reply } = controlledStream({
        failover:
          kind === 'no-backup'
            ? undefined
            : { progressTimeoutMs: 30, backupAvailable: () => false },
      });
      await vi.advanceTimersByTimeAsync(60);
      emit('data: {"choices":[{"delta":{"content":"原线路成功"}}]}');
      emit('data: [DONE]');
      await expect(reply).resolves.toMatchObject({ ok: true, text: '原线路成功' });
    } finally {
      vi.useRealTimers();
    }
  });
  it('明确非流式的官方 JSON 线路可在原时限内完成', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((resolve, reject) => {
            init!.signal!.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
            setTimeout(
              () => resolve(Response.json({ choices: [{ message: { content: '完整 JSON' } }] })),
              60,
            );
          }),
      );
      const reply = new OpenAiTextAdapter().generate({
        ...input,
        baseUrl: 'https://api.abliteration.ai/v1',
        timeoutMs: 90,
        deadlineMs: 100,
        failover: { progressTimeoutMs: 30, backupAvailable: () => true },
      });
      await vi.advanceTimersByTimeAsync(60);
      await expect(reply).resolves.toMatchObject({ ok: true, text: '完整 JSON' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('只估算缺失的出站 token，并计入独立返回的思考用量', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            message: { content: '简短回复', reasoning_content: '独立思考内容' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 120, prompt_cache_hit_tokens: 70 },
      }),
    );
    await expect(new OpenAiTextAdapter().generate(input)).resolves.toMatchObject({
      ok: true,
      usage: {
        estimated: true,
        inputTokens: 50,
        cachedInputTokens: 70,
        outputTokens: estimateTokens('简短回复') + estimateTokens('独立思考内容'),
        reasoningTokens: estimateTokens('独立思考内容'),
      },
    });
  });

  it('识别嵌在 200 流里的拒绝和没有结束帧的部分文本', async () => {
    const sse = (data: unknown) =>
      new Response(`data: ${JSON.stringify(data)}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(sse({ error: { code: 'policy_violation' } }))
      .mockResolvedValueOnce(sse({ choices: [{ delta: { content: '尚未完成' } }] }));
    const adapter = new OpenAiTextAdapter();
    await expect(adapter.generate(input)).resolves.toMatchObject({
      ok: false,
      category: 'content_rejected',
      retryable: false,
    });
    await expect(adapter.generate(input)).resolves.toMatchObject({
      ok: false,
      category: 'network_error',
      usage: { estimated: true },
    });
  });
});

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

  it.each([{ finishReason: 'stop', reasoningTokens: 3 }])(
    '保留原有正常纯文本返回',
    async ({ finishReason, reasoningTokens }) => {
      const text = '行，那我先睡了，明天聊。';
      respond(text, finishReason, reasoningTokens);
      expect(await new OpenAiTextAdapter().generate(input)).toMatchObject({
        ok: true,
        text,
        finishReason,
      });
    },
  );

  it('达到上游输出上限时只有已写部分，不把截断当作正常完整回复', async () => {
    respond('第一句还没写完', 'length', 0);
    await expect(new OpenAiTextAdapter().generate(input)).resolves.toMatchObject({
      ok: false,
      category: 'truncated',
      partialText: '第一句还没写完',
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
  it('有空行时只去掉思考段，保留答案', () => {
    expect(stripReasoning('Thinking:\r\nI should answer.\r\n\r\nGood night.')).toBe('Good night.');
  });

  it('没有空行时只删标题，不能把标题后的正文一起吃掉', () => {
    expect(stripReasoning('Reasoning: The reply is still missing.')).toBe(
      'The reply is still missing.',
    );
    expect(stripReasoning('Thinking: 直接回答\n你好')).toBe('直接回答\n你好');
  });

  it('没有标题的分析原样交给出站检查', () => {
    const text = '我们需要回答群聊。需要判断角色。没有指定是谁。';
    expect(stripReasoning(text)).toBe(text);
  });
});
