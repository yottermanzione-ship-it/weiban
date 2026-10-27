/**
 * V2（2026-10-28）：实时通话音色按需复刻（照旧版 `ensureRealtimeVoice`）。
 *
 * 选音色顺序（同一角色 + 同一实时模型）：
 * 1. 已有绑定（旧站迁入 / 管理员登记 / 之前复刻的）→ 直接用；
 * 2. 没有绑定、角色有声音样本 → 当场复刻一个只给这个模型用的音色，写入 realtime_voice_bindings，以后复用；
 *    同一角色 + 模型同时只发一次复刻请求（并发的通话等同一个结果）；
 * 3. 复刻失败或 20 秒内没完成 → 用这个模型的默认系统音色（复刻仍在后台继续，成功后下一通就能用）；
 * 4. 也没有默认音色 → 不接通（由调用方给用户明确提示），不会无限等待。
 *
 * 复刻失败后 10 分钟内不再重试同一角色 + 模型（避免每通电话都多等 20 秒）；本机忙（转码并发满）不算失败。
 * 单进程内去重；多实例同时复刻时，后写入的一方读回先写入的音色（最多多花一次 0.01 元）。
 * 复刻发生在冻结第一段通话费用之前，所以等待、失败、超时都不会留下冻结。
 */
import type { MediaAdapterResult } from '../infra/media-adapter.js';
import type { CloneSampleFile } from '../infra/dashscope-voice-clone.js';
import { ProviderVoiceKey } from './realtime-voices.js';

export const CLONE_WAIT_MS = 20_000;
export const CLONE_RETRY_AFTER_MS = 10 * 60_000;

export interface RealtimeCloneModel {
  modelKey: string;
}

export interface RealtimeCloneSample extends CloneSampleFile {
  sampleMediaId: string;
}

export type RealtimeVoiceChoice =
  | { voice: string; source: 'binding' | 'cloned' | 'default' }
  | { voice: null; reason: 'no_voice' | 'clone_failed' };

type CloneOutcome = { voice: string } | { reason: 'no_sample' | 'failed' };

export interface RealtimeVoiceClonerDeps<M extends RealtimeCloneModel> {
  binding(characterId: string, modelKey: string): Promise<string | null>;
  defaultVoice(modelKey: string): Promise<string | null>;
  /** 角色自己的声音样本（默认音色登记的参考音频）；没有返回 null。 */
  sample(characterId: string): Promise<RealtimeCloneSample | null>;
  /** 调供应商复刻（含转码）。localRateLimit = 本机忙，不进入失败冷却。 */
  clone(
    model: M,
    input: { characterId: string; sample: RealtimeCloneSample },
  ): Promise<MediaAdapterResult<{ voice: string }>>;
  /** 写入绑定并审计；已有绑定（并发 / 其他实例）时返回已有的音色。 */
  save(
    characterId: string,
    modelKey: string,
    voice: string,
    sample: RealtimeCloneSample,
  ): Promise<string>;
  nowMs(): number;
  waitMs?: number;
}

export class RealtimeVoiceCloner<M extends RealtimeCloneModel> {
  private readonly inflight = new Map<string, Promise<CloneOutcome>>();
  private readonly failedAt = new Map<string, number>();

  constructor(private readonly deps: RealtimeVoiceClonerDeps<M>) {}

  /**
   * call：接通时用（有默认音色也会先等复刻，最多 20 秒）；
   * precheck：拨打前检查（有默认音色就立即放行、复刻在后台进行；没有默认音色才等复刻结果）。
   */
  async choose(
    characterId: string,
    model: M,
    mode: 'call' | 'precheck',
  ): Promise<RealtimeVoiceChoice> {
    const own = await this.deps.binding(characterId, model.modelKey);
    if (own) return { voice: own, source: 'binding' };
    const fallback = await this.deps.defaultVoice(model.modelKey);
    const task = this.start(characterId, model);
    if (mode === 'precheck' && fallback) return { voice: fallback, source: 'default' };
    const outcome = await this.within(task, this.deps.waitMs ?? CLONE_WAIT_MS);
    if (outcome && 'voice' in outcome) return { voice: outcome.voice, source: 'cloned' };
    if (fallback) return { voice: fallback, source: 'default' };
    return {
      voice: null,
      reason: outcome && outcome.reason === 'no_sample' ? 'no_voice' : 'clone_failed',
    };
  }

  /** 同一角色 + 模型只跑一个复刻任务；任务不随等待超时取消（成功后下一通直接复用）。 */
  private start(characterId: string, model: M): Promise<CloneOutcome> {
    const key = `${characterId}|${model.modelKey}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const failed = this.failedAt.get(key);
    const coolingDown = failed !== undefined && this.deps.nowMs() - failed < CLONE_RETRY_AFTER_MS;
    const task = (async (): Promise<CloneOutcome> => {
      const sample = await this.deps.sample(characterId).catch(() => null);
      if (!sample) return { reason: 'no_sample' };
      if (coolingDown) return { reason: 'failed' };
      const result = await this.deps
        .clone(model, { characterId, sample })
        .catch((): MediaAdapterResult<{ voice: string }> => ({
          ok: false,
          category: 'provider_error',
        }));
      if (!result.ok || !ProviderVoiceKey.safeParse(result.value.voice).success) {
        if (result.ok || !result.localRateLimit) this.failedAt.set(key, this.deps.nowMs());
        return { reason: 'failed' };
      }
      const voice = await this.deps.save(characterId, model.modelKey, result.value.voice, sample);
      this.failedAt.delete(key);
      return { voice };
    })()
      .catch((): CloneOutcome => ({ reason: 'failed' }))
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async within(task: Promise<CloneOutcome>, ms: number): Promise<CloneOutcome | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
      timer.unref?.();
    });
    try {
      return await Promise.race([task, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
