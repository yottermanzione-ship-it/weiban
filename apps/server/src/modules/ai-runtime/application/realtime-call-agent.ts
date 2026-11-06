/**
 * 批 V：实时语音 / Omni 通话的角色一侧（契约 CallAgentSession 不变，客户端协议不变）。
 *
 * 与级联通话（call-agent.ts）的差别：不再「识别 → 角色聊天模型 → 合成」，而是把同一份人设、记忆、
 * 边界与通话规则拼成会话指令交给一个端到端实时模型（服务端中转，密钥不出服务器），由它直接听和说。
 * 保留的规则：接通后角色先开口；用户插话打断；55 分钟提醒、59 分半道别；余额用完道别；高风险内容开启安全关怀；
 * 结束后通话摘要写入记忆。私密范围不开放实时通话（调用方拒绝）。
 *
 * 已知限制（交接里写明）：实时模型边说边出字，角色台词的文字检查只能在出声的同时进行；发现越界会立即打断
 * 这次回应并丢弃尚未播放的声音，但已经播出的半句无法撤回（级联通话是先检查整句再合成）。
 */
import type {
  CallAgentSession,
  CallAgentSignal,
  ChatMessageForModel,
  BillingReadPort,
  RealtimeVoiceSession,
} from '@weiban/contracts';
import type { Clock } from '../../../platform/index.js';
import { highRisk, outputAllowed } from '../domain/reply-rules.js';
import type { MemoryService } from './memory.js';
import type { ReplyContext, ReplySnapshot } from './reply-context.js';
import { saveCallTranscript } from './call-transcript.js';
import { realtimeCallInstructions } from '../domain/realtime-prompt.js';
export { realtimeCallInstructions } from '../domain/realtime-prompt.js';

const REMIND_AT_MS = 55 * 60_000;
const FAREWELL_AT_MS = 59 * 60_000 + 30_000;
const BALANCE_CHECK_MS = 20_000;
const FAREWELL_TIMEOUT_MS = 10_000;

const CARE_ADDENDUM =
  '【安全关怀】用户可能处于危险中：以关怀为先，语气温和，先确认对方是否安全，建议联系身边信任的人或拨打 12356，紧急时 110/120，不提供任何伤害方法。';

class Queue<T> {
  private items: T[] = [];
  private waiters: Array<() => void> = [];
  private ended = false;
  push(item: T): void {
    if (this.ended) return;
    this.items.push(item);
    this.waiters.splice(0).forEach((w) => w());
  }
  clear(): void {
    this.items = [];
  }
  end(): void {
    this.ended = true;
    this.waiters.splice(0).forEach((w) => w());
  }
  async *iterate(): AsyncIterable<T> {
    for (;;) {
      const next = this.items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
}

export interface RealtimeAgentInfo {
  epoch: string;
  callId: string;
  userId: string;
  characterId: string;
  conversationId: string;
  direction: 'outgoing' | 'incoming';
  policy: ReplySnapshot['policy'];
  callReason: string | null;
  instructions: string;
  healthUsed?: boolean;
}

export class RealtimeAgentSession implements CallAgentSession {
  readonly outputSampleRate = 24_000;
  private readonly audioQ = new Queue<Uint8Array>();
  private readonly signalQ = new Queue<CallAgentSignal>();
  private readonly turns: ChatMessageForModel[] = [];
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly startedAt: number;
  private muted = false;
  private closed = false;
  private ending = false;
  private endRequested = false;
  private careActive = false;
  private speaking = false;
  /** 本次回应的文字没通过检查：打断并丢弃之后的声音。 */
  private blocked = false;
  private spokeThisResponse = false;
  private responseActive = false;
  private doneWaiters: Array<() => void> = [];
  private instructions: string;
  private refreshVersion = 0;
  private nextInstructions: string | null = null;
  private responseTurn: ChatMessageForModel | null = null;
  private interrupted = false;

  constructor(
    private readonly deps: {
      billing: BillingReadPort;
      memory: MemoryService;
      clock: Clock;
      context?: ReplyContext;
    },
    private readonly info: RealtimeAgentInfo,
    private readonly rt: RealtimeVoiceSession,
  ) {
    this.startedAt = deps.clock.nowMs();
    this.instructions = info.instructions;
  }

  start(): void {
    void this.listen();
    // 接通后角色先开口（MED-06）。
    this.rt.respond({
      instructions: this.withInstructions(
        this.info.direction === 'incoming'
          ? `你主动给对方打了电话，对方刚接通。先开口打招呼，自然说出打电话的原因：${this.info.callReason ?? '想和对方聊聊天'}。`
          : '对方给你打来电话，你刚接起。先开口，像接电话那样自然地打招呼。',
      ),
    });
    this.timers.push(
      setTimeout(() => {
        if (this.closed || this.ending) return;
        this.rt.respond({
          instructions: this.withInstructions(
            '自然地提醒对方：我们聊了快一个小时啦，再过五分钟电话就要自动挂断了。',
          ),
        });
      }, REMIND_AT_MS),
      setTimeout(() => void this.farewell('time_limit'), FAREWELL_AT_MS),
      setInterval(() => void this.checkBalance(), BALANCE_CHECK_MS),
    );
  }

  onUserAudio(chunk: Uint8Array): void {
    if (this.closed || this.ending || this.muted) return;
    this.rt.pushAudio(chunk);
  }

  onBargeIn(): void {
    if (this.closed || this.endRequested) return;
    this.rt.interrupt();
    this.markInterrupted();
    this.stopSpeaking();
  }

  onMute(muted: boolean): void {
    if (this.closed || this.ending) return;
    // 静音只关闭麦克风（不再上传、不计费），不打断角色。
    this.muted = muted;
  }

  audio(): AsyncIterable<Uint8Array> {
    return this.audioQ.iterate();
  }

  async *signals(): AsyncIterable<CallAgentSignal> {
    for await (const signal of this.signalQ.iterate()) if (!this.closed) yield signal;
  }

  async close(input: { durationSec: number; outcome: string }): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.audioQ.clear();
    this.audioQ.end();
    this.signalQ.clear();
    this.signalQ.end();
    this.doneWaiters.splice(0).forEach((w) => w());
    await this.rt.close().catch(() => undefined);
    if (input.durationSec > 0 && this.turns.length > 0)
      await this.summarize().catch(() => undefined);
  }

  // ---------- 内部 ----------

  private withInstructions(addendum: string): string {
    return `${this.instructions}\n\n${this.careActive ? CARE_ADDENDUM + '\n' : ''}${addendum}`;
  }

  private markInterrupted(): void {
    // 完整回应结束后的下一次正常开口，不是对上一轮的打断。
    if (!this.responseActive && !this.speaking) return;
    this.interrupted = true;
    if (this.responseTurn)
      this.responseTurn.content =
        '[角色语音被打断，无法确认用户听到哪一部分，不把未播完的话当作已告知]';
  }

  /** 实时服务自己维持声音对话；刷新共享动态资料供后续回合使用，不取消重发而额外产生付费回应。 */
  private async refreshContext(): Promise<void> {
    if (!this.deps.context) return;
    const version = ++this.refreshVersion;
    const snapshot = await this.deps.context
      .buildCall({
        ...this.info,
        startedAt: new Date(this.startedAt),
        turns: this.turns.filter(
          (t): t is { role: 'user' | 'assistant'; content: string } => t.role !== 'system',
        ),
        includeLiveHistory: false,
      })
      .catch(() => null);
    if (this.closed || this.ending || version !== this.refreshVersion) return;
    if (!snapshot || snapshot.epoch !== this.info.epoch) {
      this.requestEnd('failed');
      return;
    }
    this.info.policy = snapshot.policy;
    this.info.healthUsed ||= snapshot.healthUsed;
    this.careActive ||= snapshot.highRisk || snapshot.careActive;
    this.nextInstructions = realtimeCallInstructions(snapshot.messages);
    this.applyContext();
  }

  private applyContext(): void {
    if (this.responseActive || !this.nextInstructions) return;
    this.instructions = this.nextInstructions;
    this.nextInstructions = null;
    this.rt.updateInstructions(this.withInstructions(''));
  }

  private clearTimers(): void {
    this.timers.splice(0).forEach((t) => clearTimeout(t));
  }

  private stopSpeaking(): void {
    this.audioQ.clear();
    if (this.speaking) {
      this.speaking = false;
      this.signalQ.push({ kind: 'speaking', speaking: false });
    }
  }

  private async listen(): Promise<void> {
    try {
      for await (const event of this.rt.events()) {
        if (this.closed) return;
        switch (event.kind) {
          case 'user_speech_started':
            this.markInterrupted();
            this.stopSpeaking();
            break;
          case 'user_transcript': {
            if (this.muted || this.ending) break;
            const text = event.text.trim();
            if (!text) break;
            this.turns.push({ role: 'user', content: text });
            if (highRisk(text) === 'high' && !this.careActive) {
              this.careActive = true;
              this.rt.updateInstructions(this.withInstructions(CARE_ADDENDUM));
            }
            void this.refreshContext();
            break;
          }
          case 'response_started':
            this.responseActive = true;
            this.blocked = false;
            this.spokeThisResponse = false;
            this.interrupted = false;
            this.responseTurn = null;
            break;
          case 'audio':
            if (this.blocked || !event.chunk.length) break;
            if (!this.speaking) {
              this.speaking = true;
              this.signalQ.push({ kind: 'speaking', speaking: true });
            }
            this.spokeThisResponse = true;
            this.audioQ.push(event.chunk);
            break;
          case 'assistant_text': {
            if (this.blocked || !event.text.trim()) break;
            if (!outputAllowed(event.text, this.info.policy, false)) {
              // 越界：立即打断这次回应，丢弃尚未播放的声音，不写入通话记录。
              this.blocked = true;
              this.rt.interrupt();
              this.stopSpeaking();
              break;
            }
            if (event.final && this.spokeThisResponse && event.text.trim()) {
              const content = this.interrupted
                ? '[角色语音被打断，无法确认用户听到哪一部分，不把未播完的话当作已告知]'
                : event.text.trim();
              if (this.responseTurn) this.responseTurn.content = content;
              else {
                this.responseTurn = { role: 'assistant', content };
                this.turns.push(this.responseTurn);
              }
            }
            break;
          }
          case 'response_done':
            if (event.interrupted) this.markInterrupted();
            if (this.speaking) {
              this.speaking = false;
              this.signalQ.push({ kind: 'speaking', speaking: false });
            }
            this.responseActive = false;
            this.applyContext();
            this.doneWaiters.splice(0).forEach((w) => w());
            break;
          case 'ended':
            // 网关已结束会话（余额不足以继续 / 单通上限 / 供应商故障）：无法再请模型道别，直接按结局结束。
            this.ending = true;
            this.requestEnd(event.reason);
            break;
        }
      }
    } catch {
      // 事件流异常按故障结束。
    }
    if (!this.closed && !this.endRequested) {
      this.ending = true;
      this.requestEnd('failed');
    }
  }

  private requestEnd(outcome: 'time_limit' | 'insufficient_balance' | 'failed'): void {
    if (this.closed || this.endRequested) return;
    this.endRequested = true;
    this.clearTimers();
    this.signalQ.push({ kind: 'end', outcome });
  }

  private async checkBalance(): Promise<void> {
    if (this.closed || this.ending) return;
    const spend = await this.deps.billing.getSpendStatus(this.info.userId).catch(() => null);
    if (spend?.depleted) await this.farewell('insufficient_balance');
  }

  private async farewell(outcome: 'time_limit' | 'insufficient_balance'): Promise<void> {
    if (this.closed || this.ending) return;
    this.ending = true;
    this.clearTimers();
    const started = this.deps.clock.nowMs();
    // 角色正在说话：先打断并等这次回应结束（供应商不接受同时两个回应），再请它道别。
    if (this.responseActive) {
      this.rt.interrupt();
      await this.waitResponseDone(3000);
    }
    if (!this.closed) {
      this.rt.respond({
        instructions: this.withInstructions(
          outcome === 'time_limit'
            ? '用一两句话自然道别：时间差不多了，今天先聊到这儿，回头再聊。'
            : '用一两句话自然道别：电话这边好像要断了，先挂了，回头打字接着聊。',
        ),
      });
      // 包括上面的等待，道别总共不超过 10 秒（余额用完后 30 秒内必须结束）。
      await this.waitResponseDone(
        Math.max(1000, FAREWELL_TIMEOUT_MS - (this.deps.clock.nowMs() - started)),
        true,
      );
    }
    this.requestEnd(outcome);
  }

  /** 等当前（或下一次，nextOne = true）回应结束，最多 ms 毫秒。 */
  private async waitResponseDone(ms: number, nextOne = false): Promise<void> {
    if (!nextOne && !this.responseActive) return;
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      new Promise<void>((resolve) => this.doneWaiters.push(resolve)),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, ms);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }

  private async summarize(): Promise<void> {
    const transcript = this.turns
      .map((t) => `${t.role === 'user' ? '用户' : '我'}：${t.content}`)
      .join('\n');
    await saveCallTranscript(this.deps.memory, {
      userId: this.info.userId,
      characterId: this.info.characterId,
      conversationId: this.info.conversationId,
      callId: this.info.callId,
      epoch: this.info.epoch,
      scope: 'normal',
      healthUsed: this.info.healthUsed,
      transcript,
      turns: this.turns.filter(
        (item): item is { role: 'user' | 'assistant'; content: string } => item.role !== 'system',
      ),
      startedAt: new Date(this.startedAt),
    });
  }
}
