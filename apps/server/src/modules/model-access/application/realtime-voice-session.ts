/**
 * 实时语音 / Omni 通话会话的计费与事件翻译（批 V）。连接由适配器建立（服务端持密钥中转），这里负责：
 *
 * - 计费：供应商按「每次回应」报告分模态 token，所以每次回应一个计费段。始终预先冻结好「下一次回应」的段；
 *   回应真正开始（response.created）才标记已发送；response.done 按报告用量结算，随后冻结下一段。
 *   下一段冻结失败（余额不足 / 日上限）→ 发 ended(insufficient_balance)，不再上传声音，取消正在进行的回应。
 * - 静音不计费：上行只转发本地静音门判断为说话的部分（含前置与尾音），长静音、静音键期间都不上传。
 * - 打断：用户开口（供应商 speech_started）或客户端 barge_in → 取消当前回应、丢弃它之后到达的声音；已产生的用量照常结算。
 * - 挂断：取消进行中的回应，最多等 3 秒拿到它的用量；拿不到的按「成本待核」处理；预冻结但没用上的段释放，不留残余冻结。
 */
import type {
  GenerateError,
  MediaCallResult,
  RealtimeVoiceEvent,
  RealtimeVoiceSession,
  RouteBillingBounds,
  UsageQuantities,
} from '@weiban/contracts';
import type {
  RealtimeConnection,
  RealtimeTransportEvent,
} from '../infra/dashscope-realtime.js';
import { realtimeUsageQuantities, SpeechGate } from './realtime-call.js';

/** 网关里本会话用到的计费操作（ModelGatewayMedia 的公开方法；单独声明便于测试替换）。 */
export interface RealtimeBillingOps<C extends { sent: boolean; usageRecordId: string }> {
  /** 冻结第 segment 段（每段 = 一次回应的估算用量）。 */
  reserve(segment: number): Promise<{ ok: true; value: C } | { ok: false; error: GenerateError }>;
  beginCharge(charge: C): Promise<boolean>;
  succeed(
    charge: C,
    actual: UsageQuantities,
    actualKnown?: boolean,
  ): Promise<{ ok: true; value: MediaCallResult } | { ok: false; error: GenerateError }>;
  /** 已发给供应商却拿不到用量：按「成本待核」释放，不按估算扣用户。 */
  failUnknown(charge: C): Promise<void>;
  cancelCharge(charge: C): Promise<void>;
}

interface ResponseState<C> {
  id: string;
  cancelled: boolean;
  charge: C | null;
  done: boolean;
}

const CLOSE_GRACE_MS = 3000;
const MAX_INSTRUCTIONS = 20_000;
const MAX_PUSH_BYTES = 32_000 * 10;

export class RealtimeVoice<C extends { sent: boolean; usageRecordId: string }>
  implements RealtimeVoiceSession
{
  readonly outputSampleRate = 24000 as const;
  private readonly gate = new SpeechGate();
  private readonly out: RealtimeVoiceEvent[] = [];
  private wake: (() => void) | null = null;
  private outEnded = false;
  private pending: C | null;
  private segment = 0;
  private billing: Promise<void> = Promise.resolve();
  private active: ResponseState<C> | null = null;
  private readonly inflight = new Set<ResponseState<C>>();
  private ended = false;
  private closed = false;
  private closing: Promise<MediaCallResult> | null = null;
  private chargedMicros = 0;
  private lastUsageId: string;
  private sessionTimer: NodeJS.Timeout | null = null;
  private doneWaiters: Array<() => void> = [];
  private connClosed = false;

  constructor(
    private readonly ops: RealtimeBillingOps<C>,
    private readonly model: {
      modelKey: string;
      bounds: NonNullable<RouteBillingBounds['realtime']>;
    },
    private readonly conn: RealtimeConnection,
    first: C,
  ) {
    this.pending = first;
    this.lastUsageId = first.usageRecordId;
  }

  get modelKey(): string {
    return this.model.modelKey;
  }

  start(): void {
    this.sessionTimer = setTimeout(
      () => this.end('time_limit'),
      this.model.bounds.maxSessionSeconds * 1000,
    );
    this.sessionTimer.unref?.();
    void this.pump();
  }

  pushAudio(chunk: Uint8Array): void {
    if (this.closed || this.ended || !chunk.length) return;
    if (chunk.length % 2 || chunk.length > MAX_PUSH_BYTES) return;
    const speech = this.gate.accept(chunk);
    if (speech.length) this.conn.appendAudio(speech);
  }

  respond(input?: { instructions?: string }): void {
    if (this.closed || this.ended || this.active) return;
    this.conn.createResponse(input?.instructions?.slice(0, MAX_INSTRUCTIONS));
  }

  interrupt(): void {
    const active = this.active;
    if (!active || active.cancelled) return;
    active.cancelled = true;
    this.conn.cancelResponse();
  }

  updateInstructions(instructions: string): void {
    if (this.closed) return;
    const text = instructions.trim().slice(0, MAX_INSTRUCTIONS);
    if (text) this.conn.updateInstructions(text);
  }

  async *events(): AsyncIterable<RealtimeVoiceEvent> {
    for (;;) {
      const next = this.out.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.outEnded) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }

  close(): Promise<MediaCallResult> {
    this.closing ??= this.finish();
    return this.closing;
  }

  // ---------- 内部 ----------

  private emit(event: RealtimeVoiceEvent): void {
    if (this.outEnded) return;
    this.out.push(event);
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private endStream(): void {
    this.outEnded = true;
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  /** 网关主动结束（余额 / 时长 / 故障）：停止上传、取消进行中的回应，交给上层道别并挂断。 */
  private end(reason: 'insufficient_balance' | 'time_limit' | 'failed'): void {
    if (this.ended || this.closed) return;
    this.ended = true;
    this.interrupt();
    this.emit({ kind: 'ended', reason });
  }

  private queueBilling(task: () => Promise<void>): void {
    this.billing = this.billing.then(task).catch(() => this.end('failed'));
  }

  private async pump(): Promise<void> {
    try {
      for await (const event of this.conn.events()) {
        this.handle(event);
        if (event.type === 'closed') break;
      }
    } catch {
      // 读事件失败按供应商故障处理。
    }
    this.connClosed = true;
    if (!this.closed) this.end('failed');
    this.doneWaiters.splice(0).forEach((w) => w());
  }

  private handle(event: RealtimeTransportEvent): void {
    switch (event.type) {
      case 'speech_started':
        // 用户开口 = 打断角色当前的回应（供应商可能已自动截断，这里再取消一次，重复取消是无害提示）。
        this.interrupt();
        this.emit({ kind: 'user_speech_started' });
        return;
      case 'user_transcript':
        this.emit({ kind: 'user_transcript', text: event.text });
        return;
      case 'response_started':
        this.onResponseStarted(event.responseId);
        return;
      case 'audio':
        if (this.deliverable(event.responseId)) this.emit({ kind: 'audio', chunk: event.pcm });
        return;
      case 'assistant_text':
        if (this.deliverable(event.responseId))
          this.emit({ kind: 'assistant_text', text: event.text, final: event.final });
        return;
      case 'response_done':
        this.onResponseDone(event);
        return;
      case 'error':
        if (event.fatal) this.end('failed');
        else this.interrupt();
        return;
      case 'closed':
        return;
    }
  }

  private deliverable(responseId: string): boolean {
    const active = this.active;
    return (
      !!active &&
      !active.cancelled &&
      !this.closed &&
      !this.ended &&
      (!responseId || !active.id || responseId === active.id)
    );
  }

  private onResponseStarted(id: string): void {
    const response: ResponseState<C> = {
      id,
      cancelled: this.closed || this.ended,
      charge: null,
      done: false,
    };
    this.active = response;
    this.inflight.add(response);
    if (response.cancelled) this.conn.cancelResponse();
    else this.emit({ kind: 'response_started' });
    this.queueBilling(async () => {
      let charge = this.pending;
      this.pending = null;
      if (!charge) {
        const next = await this.ops.reserve(++this.segment);
        if (!next.ok) {
          response.cancelled = true;
          this.conn.cancelResponse();
          this.end('insufficient_balance');
          return;
        }
        charge = next.value;
      }
      if (!charge.sent && !(await this.ops.beginCharge(charge))) {
        await this.ops.cancelCharge(charge);
        response.cancelled = true;
        this.conn.cancelResponse();
        this.end('failed');
        return;
      }
      response.charge = charge;
      this.lastUsageId = charge.usageRecordId;
    });
  }

  private onResponseDone(event: Extract<RealtimeTransportEvent, { type: 'response_done' }>): void {
    const response =
      [...this.inflight].find((r) => !r.done && (!event.responseId || r.id === event.responseId)) ??
      null;
    if (this.active === response) this.active = null;
    if (response) {
      response.done = true;
      this.emit({
        kind: 'response_done',
        interrupted: response.cancelled || event.status !== 'completed',
      });
    }
    this.queueBilling(async () => {
      if (response) {
        this.inflight.delete(response);
        const charge = response.charge;
        response.charge = null;
        if (charge) {
          // 供应商报了分模态用量就按它结算；没报 = 成本待核（不按估算扣用户）。
          const settled = event.usage
            ? await this.ops.succeed(charge, realtimeUsageQuantities(event.usage), true)
            : await this.ops.succeed(charge, {}, false);
          if (settled.ok) this.chargedMicros += settled.value.chargedMicros;
        }
      }
      this.doneWaiters.splice(0).forEach((w) => w());
      if (!this.ended && !this.closed && !this.pending) {
        const next = await this.ops.reserve(++this.segment);
        if (next.ok) this.pending = next.value;
        else this.end('insufficient_balance');
      }
    });
  }

  private async finish(): Promise<MediaCallResult> {
    this.closed = true;
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    if (this.active && !this.active.done) {
      this.active.cancelled = true;
      this.conn.cancelResponse();
    }
    // 等进行中的回应报回用量（最多 3 秒），之后断开连接。
    const deadline = Date.now() + CLOSE_GRACE_MS;
    while (
      !this.connClosed &&
      [...this.inflight].some((r) => !r.done) &&
      Date.now() < deadline
    ) {
      await Promise.race([
        new Promise<void>((resolve) => this.doneWaiters.push(resolve)),
        new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, deadline - Date.now()))),
      ]);
    }
    this.conn.close();
    await this.billing;
    // 没拿到用量的回应：已向供应商发出，成本待核（不猜、不按估算扣用户）。
    for (const response of this.inflight) {
      if (response.charge) await this.ops.failUnknown(response.charge);
      response.charge = null;
    }
    this.inflight.clear();
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      if (pending.sent) await this.ops.failUnknown(pending);
      else await this.ops.cancelCharge(pending);
    }
    this.endStream();
    return {
      modelKey: this.model.modelKey,
      chargedMicros: this.chargedMicros,
      latencyMs: 0,
      usageRecordId: this.lastUsageId,
    };
  }
}
