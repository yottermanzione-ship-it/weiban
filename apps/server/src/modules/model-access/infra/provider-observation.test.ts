import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicTextAdapter } from './anthropic-adapter.js';
import { OpenAiTextAdapter, type TextAdapter } from './text-adapter.js';
import { type ProviderDiagnostic, providerDomain, retryAfterMs } from './provider-observation.js';
import { joinTextContinuation } from '../domain/text-continuation.js';

const input: Parameters<TextAdapter['generate']>[0] = {
  model: 'synthetic',
  baseUrl: 'https://fixture.invalid/v1',
  apiKey: 'test-secret',
  messages: [{ role: 'user', content: '合成场景' }],
  idempotencyKey: 'test',
  timeoutMs: 1000,
  maxOutputTokens: 400,
};
afterEach(() => vi.restoreAllMocks());
describe.each([
  ['openai', new OpenAiTextAdapter()],
  ['anthropic', new AnthropicTextAdapter()],
] as const)('%s 适配器诊断', (protocol, adapter) => {
  it('限流回执只保存安全字段，错误消息、任意错误码和 URL 不入库', async () => {
    const report = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'sensitive-arbitrary-value',
            type: 'rate_limit_error',
            param: 'temperature',
            message: 'test-secret backup.raw/secret',
          },
        },
        { status: 429, headers: { 'retry-after': '7', 'x-request-id': 'req_0123456789abcdef' } },
      ),
    );
    const r = await adapter.generate({ ...input, onDiagnostic: report });
    expect(r).toMatchObject({ ok: false, category: 'rate_limited' });
    const data = report.mock.calls[0]![0];
    expect(data).toMatchObject({
      httpStatus: 429,
      providerCode: 'rate_limit_error',
      requestField: 'temperature',
      requestId: 'req_0123456789abcdef',
      retryAfterMs: 7000,
    });
    const json = JSON.stringify(data);
    for (const denied of [
      'test-secret',
      'fixture.invalid',
      'sensitive-arbitrary-value',
      'backup.raw',
    ])
      expect(json).not.toContain(denied);
  });
  it('派发绝对截止与连接故障单列', async () => {
    const report = vi.fn();
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(
        (_u, i) =>
          new Promise((_resolve, reject) => {
            i!.signal!.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      )
      .mockRejectedValueOnce(new TypeError('private failure detail'));
    await expect(
      adapter.generate({ ...input, timeoutMs: 500, deadlineMs: 5, onDiagnostic: report }),
    ).resolves.toMatchObject({ ok: false, diagnostic: 'timeout_deadline' });
    await expect(adapter.generate({ ...input, onDiagnostic: report })).resolves.toMatchObject({
      ok: false,
      category: 'network_error',
    });
    expect(report.mock.calls[1]?.[0]).toMatchObject({ stage: 'connect' });
  });
  it('响应头到达后中断可与连接前失败区分', async () => {
    const report = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error('never retain this message'));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    await expect(adapter.generate({ ...input, onDiagnostic: report })).resolves.toMatchObject({
      ok: false,
      category: 'network_error',
    });
    expect(report.mock.calls[0]?.[0]).toMatchObject({ httpStatus: 200 });
    expect(report.mock.calls[0]?.[0].stage).not.toBe('connect');
  });
  it('只有思考的空响应有明确原因', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json(
        protocol === 'openai'
          ? {
              choices: [
                { message: { content: ' ', reasoning_content: '不可输出' }, finish_reason: 'stop' },
              ],
            }
          : { content: [{ type: 'thinking', thinking: '不可输出' }], stop_reason: 'end_turn' },
      ),
    );
    const report = vi.fn();
    await expect(adapter.generate({ ...input, onDiagnostic: report })).resolves.toMatchObject({
      ok: false,
      category: 'empty_output',
    });
    expect(report.mock.calls[0]?.[0]).toMatchObject({ emptyKind: 'reasoning_only' });
  });
});
it('原生流只在有效文本或思考更新有效进度；截断的流不能作为回复', async () => {
  const event = (e: unknown) => 'data: ' + JSON.stringify(e) + '\n\n';
  const report = vi.fn<(d: ProviderDiagnostic) => void>();
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(
      event({ type: 'ping' }) +
        event({
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: '合成' },
        }) +
        event({ type: 'content_block_delta', delta: { type: 'text_delta', text: '未完' } }),
      { headers: { 'content-type': 'text/event-stream' } },
    ),
  );
  await expect(
    new AnthropicTextAdapter().generate({ ...input, onDiagnostic: report }),
  ).resolves.toMatchObject({ ok: false, diagnostic: 'stream_incomplete' });
  expect(report.mock.calls[0]![0]).toMatchObject({
    firstProgressMs: expect.any(Number),
    lastProgressMs: expect.any(Number),
    lastDataMs: expect.any(Number),
  });
});
it('只用网络入口分组，同域不同路径仍是共享入口', () => {
  expect(providerDomain('https://host.invalid/upstream-a')).toBe(
    providerDomain('https://host.invalid/other'),
  );
  expect(providerDomain('https://host.invalid')).not.toBe(providerDomain('https://other.invalid'));
  expect(
    retryAfterMs('Sun, 06 Nov 1994 08:49:37 GMT', Date.parse('Sun, 06 Nov 1994 08:49:35 GMT')),
  ).toBe(2000);
  expect(retryAfterMs('invalid')).toBeUndefined();
});
it('真实完成的尾段与未交付的前半段合并，剔除重叠，空续写不可交付', () => {
  expect(joinTextContinuation('前半句和一段末尾', '一段末尾接完整。')).toBe(
    '前半句和一段末尾接完整。',
  );
  expect(joinTextContinuation('旧句', '新句')).toBe('旧句新句');
  expect(joinTextContinuation('已有前半句', '前半句')).toBeNull();
});
