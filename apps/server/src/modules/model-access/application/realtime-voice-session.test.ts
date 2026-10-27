import { describe, expect, it, vi } from 'vitest';
import type { RealtimeVoiceEvent } from '@weiban/contracts';
import type {
  RealtimeConnection,
  RealtimeTransportEvent,
  RealtimeUsage,
} from '../infra/dashscope-realtime.js';
import { RealtimeVoice, type RealtimeBillingOps } from './realtime-voice-session.js';
import { SpeechGate, realtimeUsageQuantities } from './realtime-call.js';

interface FakeCharge {
  id: number;
  sent: boolean;
  usageRecordId: string;
}

/** 受控的假供应商连接：测试直接推事件，记录上行动作。 */
function fakeConnection() {
  const queue: RealtimeTransportEvent[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  const calls = { appended: 0, creates: 0, cancels: 0, closed: 0, instructions: [] as string[] };
  const conn: RealtimeConnection = {
    appendAudio: (pcm) => (calls.appended += pcm.length),
    createResponse: () => calls.creates++,
    cancelResponse: () => calls.cancels++,
    updateInstructions: (text) => calls.instructions.push(text),
    close: () => {
      calls.closed++;
      push({ type: 'closed' });
      ended = true;
    },
    async *events() {
      for (;;) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        if (ended) return;
        await new Promise<void>((r) => (wake = r));
      }
    },
  };
  function push(event: RealtimeTransportEvent) {
    queue.push(event);
    const w = wake;
    wake = null;
    w?.();
  }
  return { conn, push, calls };
}

function fakeOps(options: { reserveOk?: (segment: number) => boolean } = {}) {
  let n = 0;
  const reserve = vi.fn(async (segment: number) =>
    (options.reserveOk?.(segment) ?? true)
      ? { ok: true as const, value: { id: ++n, sent: false, usageRecordId: `u${n}` } }
      : { ok: false as const, error: 'insufficient_balance' as const },
  );
  const ops: RealtimeBillingOps<FakeCharge> = {
    reserve,
    beginCharge: vi.fn(async (c: FakeCharge) => {
      c.sent = true;
      return true;
    }),
    succeed: vi.fn(async (c: FakeCharge) => ({
      ok: true as const,
      value: { modelKey: 'qwen/rt', chargedMicros: 100, latencyMs: 0, usageRecordId: c.usageRecordId },
    })),
    failUnknown: vi.fn(async () => undefined),
    cancelCharge: vi.fn(async () => undefined),
  };
  return { ops, reserve };
}

const USAGE: RealtimeUsage = {
  textInputTokens: 900,
  cachedTextInputTokens: 100,
  audioInputTokens: 300,
  textOutputTokens: 40,
  audioOutputTokens: 200,
};

function setup(options: Parameters<typeof fakeOps>[0] = {}) {
  const { conn, push, calls } = fakeConnection();
  const { ops, reserve } = fakeOps(options);
  const first: FakeCharge = { id: 0, sent: false, usageRecordId: 'u0' };
  const session = new RealtimeVoice<FakeCharge>(
    ops,
    {
      modelKey: 'qwen/rt',
      bounds: { maxSessionSeconds: 3600, maxResponseOutputTokens: 2048, contextTokens: 32000 },
    },
    conn,
    first,
  );
  session.start();
  const events: RealtimeVoiceEvent[] = [];
  void (async () => {
    for await (const e of session.events()) events.push(e);
  })();
  return { session, push, calls, ops, reserve, first, events };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

function loud(ms: number): Uint8Array {
  const buf = Buffer.alloc((ms / 1000) * 32000);
  for (let i = 0; i < buf.length; i += 2) buf.writeInt16LE(i % 4 ? 3000 : -3000, i);
  return new Uint8Array(buf);
}

describe('实时语音会话：静音门', () => {
  it('长静音不上传；说话段带前置与尾音（让供应商断句能检测到说完）', () => {
    const gate = new SpeechGate();
    expect(gate.accept(new Uint8Array(32000 * 5)).length).toBe(0); // 5 秒静音
    const speech = gate.accept(loud(1000));
    // 1 秒说话 + 300ms 前置
    expect(speech.length).toBe(32000 + 15 * 640);
    const tail = gate.accept(new Uint8Array(32000 * 3));
    expect(tail.length).toBe(60 * 640); // 1.2 秒尾音后停止
  });
});

describe('实时语音会话：按回应分模态 token 计费', () => {
  it('回应开始才标记已发送；结束按供应商用量结算，随后预冻结下一段', async () => {
    const { push, ops, first, events, session } = setup();
    session.respond({ instructions: '先打招呼' });
    push({ type: 'response_started', responseId: 'r1' });
    push({ type: 'audio', responseId: 'r1', pcm: new Uint8Array(4800) });
    push({ type: 'assistant_text', responseId: 'r1', text: '喂？', final: true });
    push({ type: 'response_done', responseId: 'r1', status: 'completed', usage: USAGE });
    await tick();
    expect(ops.beginCharge).toHaveBeenCalledWith(first);
    expect(ops.succeed).toHaveBeenCalledWith(first, realtimeUsageQuantities(USAGE), true);
    expect(realtimeUsageQuantities(USAGE)).toEqual({
      inputTokens: 900,
      cachedInputTokens: 100,
      audioInputTokens: 300,
      outputTokens: 40,
      audioOutputTokens: 200,
    });
    expect(ops.reserve).toHaveBeenCalledWith(1);
    expect(events.map((e) => e.kind)).toEqual([
      'response_started',
      'audio',
      'assistant_text',
      'response_done',
    ]);
    const result = await session.close();
    expect(result.chargedMicros).toBe(100);
    // 预冻结的下一段没用上：直接释放，不留残余冻结
    expect(ops.cancelCharge).toHaveBeenCalledTimes(1);
    expect(ops.failUnknown).not.toHaveBeenCalled();
  });

  it('供应商没报分模态用量 = 成本待核，不按估算扣用户', async () => {
    const { push, ops, first, session } = setup();
    push({ type: 'response_started', responseId: 'r1' });
    push({ type: 'response_done', responseId: 'r1', status: 'completed', usage: null });
    await tick();
    expect(ops.succeed).toHaveBeenCalledWith(first, {}, false);
    await session.close();
  });

  it('用户开口打断：取消回应、丢弃之后到达的旧声音；被打断的回应照常按已报用量结算', async () => {
    const { push, ops, calls, events, session } = setup();
    push({ type: 'response_started', responseId: 'r1' });
    push({ type: 'audio', responseId: 'r1', pcm: new Uint8Array(100) });
    push({ type: 'speech_started' });
    push({ type: 'audio', responseId: 'r1', pcm: new Uint8Array(100) });
    push({ type: 'response_done', responseId: 'r1', status: 'cancelled', usage: USAGE });
    await tick();
    expect(calls.cancels).toBe(1);
    expect(events.filter((e) => e.kind === 'audio')).toHaveLength(1);
    expect(events).toContainEqual({ kind: 'response_done', interrupted: true });
    expect(ops.succeed).toHaveBeenCalledTimes(1);
    await session.close();
  });

  it('下一段冻结失败（余额不足）→ ended(insufficient_balance)，之后不再上传声音', async () => {
    const { push, calls, events, session } = setup({ reserveOk: (segment) => segment < 1 });
    push({ type: 'response_started', responseId: 'r1' });
    push({ type: 'response_done', responseId: 'r1', status: 'completed', usage: USAGE });
    await tick();
    expect(events).toContainEqual({ kind: 'ended', reason: 'insufficient_balance' });
    session.pushAudio(loud(500));
    expect(calls.appended).toBe(0);
    await session.close();
  });

  it('挂断时回应进行中：取消并等它报用量后再断开、结算', async () => {
    const { push, ops, calls, session } = setup();
    push({ type: 'response_started', responseId: 'r1' });
    await tick();
    const closing = session.close();
    await tick();
    expect(calls.cancels).toBe(1);
    push({ type: 'response_done', responseId: 'r1', status: 'cancelled', usage: USAGE });
    await closing;
    expect(ops.succeed).toHaveBeenCalledTimes(1);
    expect(ops.failUnknown).not.toHaveBeenCalled();
    expect(calls.closed).toBe(1);
  });

  it('连接断开、回应没报用量：按成本待核释放，不残留冻结', async () => {
    const { push, ops, events, session } = setup();
    push({ type: 'response_started', responseId: 'r1' });
    await tick();
    push({ type: 'closed' });
    await tick();
    expect(events).toContainEqual({ kind: 'ended', reason: 'failed' });
    await session.close();
    expect(ops.failUnknown).toHaveBeenCalledTimes(1);
  });

  it('静音期间（本地静音门）不上传，说话才上传', () => {
    const { session, calls } = setup();
    session.pushAudio(new Uint8Array(32000));
    expect(calls.appended).toBe(0);
    session.pushAudio(loud(200));
    expect(calls.appended).toBeGreaterThan(0);
    void session.close();
  });
});
