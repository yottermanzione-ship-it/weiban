/**
 * T-051 推演引擎：角色日常事件、心情与花费控制。
 *
 * 设计要点（对齐 SIM-01/SIM-02/SIM-12/SIM-13 与 runtime-overview.md 2.4 节）：
 * - 用途 `simulation`，modelRole `background`，countAsBackground=true，计入后台预算。
 * - 每角色每天至多一次模型调用，最多生成 MAX_EVENTS_PER_RUN 条事件（SIM-12）。
 * - 长期不活跃（INACTIVE_DAYS_THRESHOLD = 14 天）时推演暂停，不报错（SIM-13）。
 * - 余额不足 / 预算超限时推演静默跳过，不影响聊天，pausedReason 记录原因。
 * - 生成内容只写入 daily_events / mood_states，不注入用户聊天上下文（隔离性要求）。
 * - 心情与事件可被 T-052 主动消息调度读取（接口见底部 SimulationReadPort）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import {
  type ModelGatewayPort,
  type IdentityAccountStatusPort,
  type ContactsReadPort,
} from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  newId,
  type Clock,
  type Database,
  type DbTx,
  type JobQueue,
} from '../../../platform/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { simulationStates, dailyEvents, moodStates } from '../infra/db/schema.js';

// ---------------------------------------------------------------------------
// 常量（SIM-12 规模控制）
// ---------------------------------------------------------------------------
/** 每角色每天最多生成事件数（SIM-12）。 */
const MAX_EVENTS_PER_RUN = 6;
/** 长期不活跃判定天数（SIM-13）。 */
const INACTIVE_DAYS_THRESHOLD = 7;
/** 推演 maxOutputTokens（后台任务，不需要长回复）。 */
const SIMULATION_MAX_OUTPUT_TOKENS = 512;

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------
export const SimulationMood = z.enum([
  'happy',
  'neutral',
  'tired',
  'annoyed',
  'excited',
  'sad',
  'anxious',
]);
export type SimulationMood = z.infer<typeof SimulationMood>;

export const EventKind = z.enum(['work', 'social', 'leisure', 'errand', 'rest', 'unexpected']);
export type EventKind = z.infer<typeof EventKind>;

const SimulatedEvent = z.object({
  kind: EventKind,
  summary: z.string().min(1).max(200),
  detail: z.string().max(500).optional(),
  moodAfter: SimulationMood.optional(),
});

const SimulationOutput = z.object({
  events: z.array(SimulatedEvent).min(3).max(MAX_EVENTS_PER_RUN),
  overallMood: SimulationMood,
});
type SimulationOutput = z.infer<typeof SimulationOutput>;

/** 暂停原因枚举，与数据库 check 约束一致。 */
export type PausedReason = 'budget_exceeded' | 'inactive' | 'model_unavailable';

// ---------------------------------------------------------------------------
// 可供 T-052 读取的公共接口
// ---------------------------------------------------------------------------
export interface DailyEventEntry {
  id: string;
  userId: string;
  characterId: string;
  eventDate: string;
  seq: number;
  kind: EventKind;
  summary: string;
  detail?: string;
  moodAfter?: SimulationMood;
  createdAt: Date;
}

export interface MoodEntry {
  userId: string;
  characterId: string;
  mood: SimulationMood;
  updatedAt: Date;
}

/** T-052 主动消息调度可注入此接口读取推演产出。 */
export interface SimulationReadPort {
  /** 查询某角色某日的全部日常事件（按 seq 升序）。 */
  getDailyEvents(userId: string, characterId: string, date: string): Promise<DailyEventEntry[]>;
  /** 查询某角色当前心情，不存在时返回 neutral。 */
  getCurrentMood(userId: string, characterId: string): Promise<SimulationMood>;
}

export const SIMULATION_READ_PORT = Symbol('SIMULATION_READ_PORT');

// ---------------------------------------------------------------------------
// 主服务
// ---------------------------------------------------------------------------
@Injectable()
export class SimulationService implements SimulationReadPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
  ) {}

  // -------------------------------------------------------------------------
  // SimulationReadPort 实现
  // -------------------------------------------------------------------------

  async getDailyEvents(
    userId: string,
    characterId: string,
    date: string,
  ): Promise<DailyEventEntry[]> {
    const rows = await this.db.db
      .select()
      .from(dailyEvents)
      .where(
        and(
          eq(dailyEvents.userId, userId),
          eq(dailyEvents.characterId, characterId),
          eq(dailyEvents.eventDate, date),
        ),
      )
      .orderBy(dailyEvents.seq);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      characterId: r.characterId,
      eventDate: r.eventDate,
      seq: r.seq,
      kind: r.kind as EventKind,
      summary: r.summary,
      detail: r.detail ?? undefined,
      moodAfter: r.moodAfter ? (r.moodAfter as SimulationMood) : undefined,
      createdAt: r.createdAt,
    }));
  }

  async getCurrentMood(userId: string, characterId: string): Promise<SimulationMood> {
    const [row] = await this.db.db
      .select()
      .from(moodStates)
      .where(and(eq(moodStates.userId, userId), eq(moodStates.characterId, characterId)));
    if (!row) return 'neutral';
    const parsed = SimulationMood.safeParse(row.mood);
    return parsed.success ? parsed.data : 'neutral';
  }

  // -------------------------------------------------------------------------
  // 内部：记录活跃时间（聊天消息到达时由 lifecycle 调用）
  // -------------------------------------------------------------------------

  async markActive(tx: DbTx, userId: string, characterId: string): Promise<void> {
    const now = this.clock.now();
    await tx.db
      .insert(simulationStates)
      .values({
        id: newId(),
        userId,
        characterId,
        lastActiveAt: now,
        eventsToday: 0,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [simulationStates.userId, simulationStates.characterId],
        set: { lastActiveAt: now, updatedAt: now },
      });
  }

  // -------------------------------------------------------------------------
  // 每日推演任务入口（由 lifecycle 每天凌晨调度）
  // -------------------------------------------------------------------------

  async runDailySimulations(): Promise<void> {
    const now = this.clock.now();
    const today = toDateString(now);

    // 找出尚未完成今天推演的全部活跃角色对
    const states = await this.db.db
      .select()
      .from(simulationStates)
      .where(
        // 只处理最近 INACTIVE_DAYS_THRESHOLD 天内有活动的
        gte(
          simulationStates.lastActiveAt,
          new Date(now.getTime() - INACTIVE_DAYS_THRESHOLD * 86400_000),
        ),
      );

    for (const state of states) {
      // 今天已推演过则跳过
      if (state.lastSimulatedDate === today) continue;

      // 入队异步执行，避免长时间占用调度进程
      await this.jobs.send(
        SIMULATE_CHARACTER_JOB,
        { userId: state.userId, characterId: state.characterId },
        { retryLimit: 2, retryBackoff: true },
      );
    }
  }

  // -------------------------------------------------------------------------
  // 单角色推演（job worker 入口）
  // -------------------------------------------------------------------------

  async simulateCharacter(userId: string, characterId: string): Promise<void> {
    const now = this.clock.now();
    const today = toDateString(now);
    const epoch = await this.contacts.getActiveContactEpoch(userId, characterId);
    if (!epoch) return;

    // 加载或初始化状态（行锁）
    const state = await this.db.transaction(async (tx) => {
      if (!(await this.lockActiveAccount(tx, userId))) return null;
      const [existing] = await tx.db
        .select()
        .from(simulationStates)
        .where(
          and(eq(simulationStates.userId, userId), eq(simulationStates.characterId, characterId)),
        )
        .for('update');
      return existing ?? null;
    });

    if (!state) return; // 没有状态记录，说明角色从未活跃，跳过

    // 今天已推演过则幂等返回
    if (state.lastSimulatedDate === today) return;

    // 检查长期不活跃（SIM-13）
    const daysSinceActive = (now.getTime() - state.lastActiveAt.getTime()) / 86400_000;
    if (daysSinceActive >= INACTIVE_DAYS_THRESHOLD) {
      await this.setPausedReason(userId, characterId, 'inactive');
      return;
    }

    // 构造推演提示词
    const prompt = buildSimulationPrompt(today, MAX_EVENTS_PER_RUN);

    // 调用模型（走后台网关，simulation 用途，countAsBackground=true）
    const result = await this.gateway.generateText({
      userId,
      purpose: 'simulation',
      billingOwner: 'user',
      modelRole: 'background',
      characterId,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: SIMULATION_MAX_OUTPUT_TOKENS,
      responseFormat: 'json',
      idempotencyKey: `sim:${userId}:${characterId}:${today}`,
      countAsBackground: true,
    });

    if (!result.ok) {
      // 余额不足或预算超限 → 静默暂停，不影响聊天
      const reason: PausedReason =
        result.error === 'budget_exceeded'
          ? 'budget_exceeded'
          : result.error === 'insufficient_balance'
            ? 'budget_exceeded'
            : 'model_unavailable';
      await this.setPausedReason(userId, characterId, reason);
      return;
    }

    // 解析 JSON 输出
    let output: SimulationOutput;
    try {
      const raw = JSON.parse(result.value.text);
      output = SimulationOutput.parse(raw);
    } catch {
      // 模型输出格式错误 → 静默跳过，不写入任何状态
      return;
    }

    // 在事务中写入事件、心情、更新推演状态
    await this.db.transaction(async (tx) => {
      if (!(await this.lockActiveAccount(tx, userId))) return;
      const currentEpoch = await this.contacts.getActiveContactEpoch(userId, characterId, tx);
      if (currentEpoch?.version !== epoch.version) return;
      const [current] = await tx.db
        .select()
        .from(simulationStates)
        .where(
          and(eq(simulationStates.userId, userId), eq(simulationStates.characterId, characterId)),
        )
        .for('update');
      if (!current || current.lastSimulatedDate === today) return;
      // 写入日常事件（seq 从 0 开始）
      for (let i = 0; i < output.events.length; i++) {
        const ev = output.events[i]!;
        await tx.db
          .insert(dailyEvents)
          .values({
            id: newId(),
            userId,
            characterId,
            eventDate: today,
            seq: i,
            kind: ev.kind,
            summary: ev.summary,
            detail: ev.detail ?? null,
            moodAfter: ev.moodAfter ?? null,
            createdAt: now,
          })
          .onConflictDoNothing(); // 幂等：同一 (user, character, date, seq) 不重复写
      }

      // 更新心情状态（upsert）
      await tx.db
        .insert(moodStates)
        .values({
          id: newId(),
          userId,
          characterId,
          mood: output.overallMood,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [moodStates.userId, moodStates.characterId],
          set: { mood: output.overallMood, updatedAt: now },
        });

      // 更新推演控制状态
      await tx.db
        .update(simulationStates)
        .set({
          lastSimulatedDate: today,
          eventsToday: output.events.length,
          pausedReason: null, // 成功则清除暂停原因
          updatedAt: now,
        })
        .where(
          and(eq(simulationStates.userId, userId), eq(simulationStates.characterId, characterId)),
        );
    });
  }

  // -------------------------------------------------------------------------
  // 内部工具
  // -------------------------------------------------------------------------

  private async lockActiveAccount(tx: DbTx, userId: string): Promise<boolean> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))", [
      userId,
    ]);
    return (await this.accounts.getAccountStatus(userId, tx)) === 'active';
  }

  private async setPausedReason(
    userId: string,
    characterId: string,
    reason: PausedReason,
  ): Promise<void> {
    await this.db.db
      .update(simulationStates)
      .set({ pausedReason: reason, updatedAt: this.clock.now() })
      .where(
        and(eq(simulationStates.userId, userId), eq(simulationStates.characterId, characterId)),
      );
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function buildSimulationPrompt(date: string, maxEvents: number): string {
  return `你是一个 AI 角色的内部状态模拟器。今天是 ${date}。

请为这个角色生成今天的日常生活概要，以 JSON 格式输出，格式如下：
{
  "events": [
    {
      "kind": "work|social|leisure|errand|rest|unexpected",
      "summary": "简短的事件描述（10-50 字）",
      "detail": "可选的细节（50-200 字）",
      "moodAfter": "happy|neutral|tired|annoyed|excited|sad|anxious（可选）"
    }
  ],
  "overallMood": "happy|neutral|tired|annoyed|excited|sad|anxious"
}

要求：
- events 数组包含 3 到 ${maxEvents} 条，每条描述角色今天经历的一件具体事情。
- 事件要贴近角色人设，真实可信，不要过于戏剧化。
- overallMood 反映今天整体心情。
- 只输出 JSON，不要有其他内容。`;
}

// ---------------------------------------------------------------------------
// Job 名称常量（供 lifecycle 注册 worker）
// ---------------------------------------------------------------------------
export const SIMULATE_CHARACTER_JOB = 'ai.simulate_character';
export const RUN_DAILY_SIMULATIONS_JOB = 'ai.run_daily_simulations';
