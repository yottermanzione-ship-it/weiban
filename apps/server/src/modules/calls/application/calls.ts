/**
 * 语音通话会话（MED-06、MED-07，ADR-0025，T-070）。
 *
 * 状态：ringing → active → ended（拨出时角色 2～5 秒后「接听」；来电由用户接听）。
 * - 每个用户同时最多一通未结束的通话（数据库部分唯一索引兜底）。
 * - 结束统一走 end()：条件更新 state <> 'ended'，保证只结束一次；同一事务写通话记录消息、发 calls.call_ended、
 *   写 call.updated。
 * - 定时：响铃超时、拨出自动接听、断线等待重连用延迟任务；另有每分钟巡检兜底（进程崩溃、任务丢失）。
 * - 计费：通话里的语音识别、角色回复、语音合成都在 ai-runtime 经模型网关按分钟 / 按字数冻结与结算（ADR-0025），
 *   calls 不碰钱；这里只做拨打前余额检查、通话中余额用完的 30 秒兜底收尾。任何接口都不返回费用。
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, eq, ne, isNull } from 'drizzle-orm';
import {
  CALL_LIMITS,
  CallSession as CallSessionSchema,
  type BillingReadPort,
  type CallSession,
  type CallSessionPort,
  type ChatParticipantPort,
  type ChatReadPort,
  type ContactsReadPort,
  type PortResult,
  type SyncPort,
  type UserDataOwner,
} from '@weiban/contracts';
import {
  AppError,
  CHARACTER_PURGE_REGISTRY,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  OUTBOX,
  PLATFORM_KEY_OWNER,
  USER_DATA_REGISTRY,
  newId,
  type CharacterPurgeRegistry,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type JobQueue,
  type Outbox,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { CHAT_PARTICIPANT_PORT, CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { callSessions } from '../infra/db/schema.js';
import {
  CALL_AGENT_PORT,
  CALL_SERVICE_STATUS,
  type CallAgentPort,
  type CallServiceStatus,
} from '../tokens.js';

export type CallRow = typeof callSessions.$inferSelect;
export type CallOutcomeValue =
  | 'completed'
  | 'missed'
  | 'declined'
  | 'cancelled'
  | 'failed'
  | 'insufficient_balance'
  | 'time_limit';

/** 音频流凭证有效期。 */
const TICKET_TTL_MS = 2 * 60 * 1000;
/** 通话中余额用完后最多再等 30 秒（角色道别），之后强制结束（MDL-10 第 5 条）。 */
const BALANCE_GOODBYE_MS = 30 * 1000;

const JOB_AUTO_ANSWER = 'calls.auto_answer';
const JOB_RING_TIMEOUT = 'calls.ring_timeout';
const JOB_RECONNECT = 'calls.reconnect_check';
const JOB_SWEEP = 'calls.sweep';

@Injectable()
export class CallService implements CallSessionPort, UserDataOwner, OnModuleInit {
  readonly module = 'calls';
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(CHARACTER_PURGE_REGISTRY) private readonly purgeRegistry: CharacterPurgeRegistry,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(CHAT_READ_PORT) private readonly chatRead: ChatReadPort,
    @Inject(CHAT_PARTICIPANT_PORT) private readonly chatWrite: ChatParticipantPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Optional() @Inject(CALL_AGENT_PORT) readonly agent: CallAgentPort | null = null,
    @Optional()
    @Inject(CALL_SERVICE_STATUS)
    private readonly service: CallServiceStatus | null = null,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register(this);
    this.purgeRegistry.register({
      module: 'calls',
      purge: (tx, characterId) => this.purgeCharacter(tx, characterId),
    });
    await this.jobs.work<{ callId: string }>(JOB_AUTO_ANSWER, (job) =>
      this.autoAnswer(job.data.callId),
    );
    await this.jobs.work<{ callId: string }>(JOB_RING_TIMEOUT, (job) =>
      this.ringTimeout(job.data.callId),
    );
    await this.jobs.work<{ callId: string }>(JOB_RECONNECT, (job) =>
      this.reconnectCheck(job.data.callId),
    );
    await this.jobs.work(JOB_SWEEP, () => this.sweep());
    await this.jobs.schedule(JOB_SWEEP, '* * * * *');
  }

  // ---------- 读取 ----------

  dto(row: CallRow, stream: CallSession['stream'] = null): CallSession {
    return CallSessionSchema.parse({
      callId: row.id,
      characterId: row.characterId,
      conversationId: row.conversationId,
      direction: row.direction,
      state: row.state,
      outcome: row.outcome,
      createdAt: row.createdAt.toISOString(),
      answeredAt: row.answeredAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      durationSec: this.durationOf(row),
      stream,
    });
  }

  durationOf(row: CallRow): number {
    if (row.state === 'ended') return row.durationSec;
    if (!row.answeredAt) return 0;
    return Math.min(
      CALL_LIMITS.maxDurationSec,
      Math.max(0, Math.floor((this.clock.nowMs() - row.answeredAt.getTime()) / 1000)),
    );
  }

  async find(callId: string): Promise<CallRow | null> {
    const [row] = await this.database.db
      .select()
      .from(callSessions)
      .where(eq(callSessions.id, callId));
    return row ?? null;
  }

  private async mine(userId: string, callId: string): Promise<CallRow> {
    const row = await this.find(callId);
    if (!row || row.userId !== userId) throw new AppError('not_found', '通话不存在');
    return row;
  }

  async getCall(userId: string, callId: string): Promise<CallSession> {
    return this.dto(await this.mine(userId, callId));
  }

  async getActiveCall(userId: string): Promise<CallSession | null> {
    const [row] = await this.database.db
      .select()
      .from(callSessions)
      .where(and(eq(callSessions.userId, userId), ne(callSessions.state, 'ended')));
    return row ? this.dto(row) : null;
  }

  // ---------- 能不能打 ----------

  private async serviceEnabled(): Promise<boolean> {
    if (!this.agent) return false;
    if (!this.service) return true;
    try {
      return await this.service.isVoiceCallEnabled();
    } catch {
      return false;
    }
  }

  private async balanceOk(userId: string): Promise<boolean> {
    const status = await this.billing.getSpendStatus(userId);
    return !status.depleted && !status.insufficient && status.availableMicros > 0;
  }

  async availability(
    userId: string,
    characterId: string,
  ): Promise<{
    available: boolean;
    reason:
      | 'service_disabled'
      | 'insufficient_balance'
      | 'busy'
      | 'contact_inactive'
      | 'private_mode'
      | null;
  }> {
    if (!(await this.serviceEnabled())) return { available: false, reason: 'service_disabled' };
    if (!(await this.contacts.getActiveContact(userId, characterId)))
      return { available: false, reason: 'contact_inactive' };
    if (await this.inPrivateMode(userId, characterId))
      return { available: false, reason: 'private_mode' };
    if (await this.getActiveCall(userId)) return { available: false, reason: 'busy' };
    if (!(await this.balanceOk(userId)))
      return { available: false, reason: 'insufficient_balance' };
    return { available: true, reason: null };
  }

  /**
   * 3.28（H2，总经理 10-21 C14）：私密模式只开放文字与图片，不能语音通话。
   * 以私聊会话当前的内容范围为准（切到私密模式时 ai-runtime 把会话改成 adult）。
   */
  private async inPrivateMode(userId: string, characterId: string): Promise<boolean> {
    const conversation = await this.chatRead.findDirectConversation(userId, characterId);
    return conversation?.contentScope === 'adult';
  }

  // ---------- 拨出（MED-06） ----------

  async startCall(
    userId: string,
    input: { characterId: string; clientRequestId: string },
  ): Promise<CallSession> {
    const [existing] = await this.database.db
      .select()
      .from(callSessions)
      .where(
        and(eq(callSessions.userId, userId), eq(callSessions.requestKey, input.clientRequestId)),
      );
    if (existing) return this.withTicket(existing);
    if (!(await this.serviceEnabled()))
      throw new AppError('service_disabled', '暂时无法通话', { status: 422 });
    if (!(await this.contacts.getActiveContact(userId, input.characterId)))
      throw new AppError('not_found', '请先添加好友');
    if (!(await this.balanceOk(userId)))
      throw new AppError('insufficient_balance', '余额不足，暂时无法通话', { status: 422 });
    const conversation = await this.chatRead.findDirectConversation(userId, input.characterId);
    if (!conversation) throw new AppError('not_found', '找不到会话');
    if (conversation.contentScope === 'adult')
      throw new AppError('private_mode_unsupported', '私密模式只支持文字和图片，暂时不能语音通话', {
        status: 422,
      });
    const row = await this.create(userId, {
      characterId: input.characterId,
      conversationId: conversation.conversationId,
      direction: 'outgoing',
      requestKey: input.clientRequestId,
    });
    if (!row.ok) throw new AppError('call_busy', '已有进行中的通话', { status: 409 });
    // 角色永远会接：2～5 秒后接听（MED-06 第 4 条）。
    const ringMs =
      (CALL_LIMITS.outgoingRingMinSec +
        Math.random() * (CALL_LIMITS.outgoingRingMaxSec - CALL_LIMITS.outgoingRingMinSec)) *
      1000;
    await this.jobs.send(
      JOB_AUTO_ANSWER,
      { callId: row.value.id },
      { delayMs: Math.round(ringMs), singletonKey: `answer:${row.value.id}` },
    );
    return this.withTicket(row.value);
  }

  private async create(
    userId: string,
    input: {
      characterId: string;
      conversationId: string;
      direction: 'outgoing' | 'incoming';
      requestKey: string;
    },
  ): Promise<PortResult<CallRow, 'busy'>> {
    const id = newId();
    try {
      const row = await this.database.transaction(async (tx) => {
        const [inserted] = await tx.db
          .insert(callSessions)
          .values({
            id,
            userId,
            characterId: input.characterId,
            conversationId: input.conversationId,
            direction: input.direction,
            state: 'ringing',
            outcome: null,
            requestKey: input.requestKey,
            createdAt: this.clock.now(),
          })
          .returning();
        await this.outbox.publish(tx, 'calls.call_started', 'calls', {
          callId: id,
          userId,
          characterId: input.characterId,
          direction: input.direction,
        });
        await this.updated(tx, inserted!);
        return inserted!;
      });
      return { ok: true, value: row };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        // 并发重试同一请求：返回已有的那一通。
        const [same] = await this.database.db
          .select()
          .from(callSessions)
          .where(
            and(eq(callSessions.userId, userId), eq(callSessions.requestKey, input.requestKey)),
          );
        if (same) return { ok: true, value: same };
        return { ok: false, error: 'busy' };
      }
      throw error;
    }
  }

  async autoAnswer(callId: string): Promise<void> {
    await this.answerRow(callId, 'outgoing');
  }

  // ---------- 来电（MED-07） ----------

  async startIncomingCall(input: {
    userId: string;
    characterId: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<PortResult<CallSession, 'busy' | 'contact_inactive' | 'service_disabled'>> {
    const requestKey = `in:${input.idempotencyKey}`.slice(0, 200);
    const [existing] = await this.database.db
      .select()
      .from(callSessions)
      .where(and(eq(callSessions.userId, input.userId), eq(callSessions.requestKey, requestKey)));
    if (existing) return { ok: true, value: this.dto(existing) };
    if (!(await this.serviceEnabled())) return { ok: false, error: 'service_disabled' };
    if (!(await this.contacts.getActiveContact(input.userId, input.characterId)))
      return { ok: false, error: 'contact_inactive' };
    const conversation = await this.chatRead.findDirectConversation(
      input.userId,
      input.characterId,
    );
    if (!conversation) return { ok: false, error: 'contact_inactive' };
    // H2：私密模式不来电（只开放文字与图片）。
    if (conversation.contentScope === 'adult') return { ok: false, error: 'service_disabled' };
    const row = await this.create(input.userId, {
      characterId: input.characterId,
      conversationId: conversation.conversationId,
      direction: 'incoming',
      requestKey,
    });
    if (!row.ok) return { ok: false, error: 'busy' };
    await this.jobs.send(
      JOB_RING_TIMEOUT,
      { callId: row.value.id },
      { delayMs: CALL_LIMITS.ringTimeoutSec * 1000, singletonKey: `ring:${row.value.id}` },
    );
    return { ok: true, value: this.dto(row.value) };
  }

  async answerCall(userId: string, callId: string): Promise<CallSession> {
    const row = await this.mine(userId, callId);
    if (row.direction !== 'incoming') throw new AppError('conflict', '这不是来电');
    const answered = await this.answerRow(callId, 'incoming');
    if (!answered) throw new AppError('conflict', '来电已结束或已在其他设备接听');
    return this.withTicket(answered);
  }

  private async answerRow(
    callId: string,
    direction: 'incoming' | 'outgoing',
  ): Promise<CallRow | null> {
    return this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .update(callSessions)
        .set({ state: 'active', answeredAt: this.clock.now() })
        .where(
          and(
            eq(callSessions.id, callId),
            eq(callSessions.state, 'ringing'),
            eq(callSessions.direction, direction),
          ),
        )
        .returning();
      if (!row) return null;
      await this.outbox.publish(tx, 'calls.call_answered', 'calls', {
        callId: row.id,
        userId: row.userId,
        characterId: row.characterId,
        direction: row.direction as 'incoming' | 'outgoing',
      });
      await this.updated(tx, row);
      return row;
    });
  }

  async declineCall(userId: string, callId: string): Promise<CallSession> {
    const row = await this.mine(userId, callId);
    if (row.state === 'ended') return this.dto(row);
    if (row.direction !== 'incoming' || row.state !== 'ringing')
      throw new AppError('conflict', '只能拒接正在响铃的来电');
    return this.dto((await this.end(callId, 'declined')) ?? (await this.mine(userId, callId)));
  }

  async ringTimeout(callId: string): Promise<void> {
    const row = await this.find(callId);
    if (!row || row.state !== 'ringing' || row.direction !== 'incoming') return;
    await this.end(callId, 'missed');
  }

  // ---------- 挂断与结束 ----------

  async hangUp(userId: string, callId: string): Promise<CallSession> {
    const row = await this.mine(userId, callId);
    if (row.state === 'ended') return this.dto(row);
    const outcome: CallOutcomeValue =
      row.state === 'ringing'
        ? row.direction === 'outgoing'
          ? 'cancelled'
          : 'declined'
        : 'completed';
    return this.dto((await this.end(callId, outcome)) ?? (await this.mine(userId, callId)));
  }

  /**
   * 结束通话（只生效一次）。私聊写通话记录（拨出 = 用户发出；来电 = 角色发出，未接 / 拒接显示「未接来电」），
   * 发 calls.call_ended，写 call.updated。已经结束返回 null。
   */
  async end(callId: string, outcome: CallOutcomeValue): Promise<CallRow | null> {
    const ended = await this.database.transaction(async (tx) => {
      const [current] = await tx.db
        .select()
        .from(callSessions)
        .where(eq(callSessions.id, callId))
        .for('update');
      if (!current || current.state === 'ended') return null;
      const now = this.clock.now();
      const durationSec = current.answeredAt
        ? Math.min(
            CALL_LIMITS.maxDurationSec,
            Math.max(
              0,
              Math.floor(
                ((current.streamLostAt && outcome === 'failed'
                  ? current.streamLostAt
                  : now
                ).getTime() -
                  current.answeredAt.getTime()) /
                  1000,
              ),
            ),
          )
        : 0;
      const finalOutcome: CallOutcomeValue =
        !current.answeredAt && outcome === 'completed' ? 'cancelled' : outcome;
      const [row] = await tx.db
        .update(callSessions)
        .set({
          state: 'ended',
          outcome: finalOutcome,
          endedAt: now,
          durationSec,
          streamConnection: null,
        })
        .where(eq(callSessions.id, callId))
        .returning();
      await this.writeRecord(tx, row!);
      await this.outbox.publish(tx, 'calls.call_ended', 'calls', {
        callId: row!.id,
        userId: row!.userId,
        characterId: row!.characterId,
        conversationId: row!.conversationId,
        direction: row!.direction as 'incoming' | 'outgoing',
        outcome: finalOutcome,
        durationSec,
      });
      await this.updated(tx, row!);
      return row!;
    });
    return ended;
  }

  /** 私聊里的通话记录（CallRecordContent）。会话已停用（删好友）时不写，不影响结束。 */
  private async writeRecord(tx: DbTx, row: CallRow): Promise<void> {
    const participants = await this.chatRead.getParticipants(row.conversationId);
    const sender =
      row.direction === 'outgoing'
        ? participants.find((p) => p.kind === 'user' && p.refId === row.userId)
        : participants.find((p) => p.kind === 'character' && p.refId === row.characterId);
    if (!sender) return;
    await this.chatWrite.postMessage(
      {
        conversationId: row.conversationId,
        senderParticipantId: sender.participantId,
        content: {
          type: 'call_record',
          callId: row.id,
          direction: row.direction as 'incoming' | 'outgoing',
          outcome: row.outcome as CallOutcomeValue,
          durationSec: row.durationSec,
        },
        // 用户发送方的幂等键必须是 UUID：直接用 callId（一通电话只有一条记录）。
        idempotencyKey: row.direction === 'outgoing' ? row.id : `call:${row.id}`,
      },
      tx,
    );
  }

  private async updated(tx: DbTx, row: CallRow): Promise<void> {
    await this.sync.appendUpdate(tx, row.userId, {
      type: 'call.updated',
      data: { call: this.dto(row) },
    });
  }

  // ---------- 音频流凭证 ----------

  async withTicket(row: CallRow): Promise<CallSession> {
    if (row.state === 'ended') return this.dto(row);
    return this.dto(row, await this.ticket(row));
  }

  async renewTicket(userId: string, callId: string): Promise<NonNullable<CallSession['stream']>> {
    const row = await this.mine(userId, callId);
    if (row.state === 'ended') throw new AppError('conflict', '通话已结束');
    return this.ticket(row);
  }

  private async ticket(row: CallRow): Promise<NonNullable<CallSession['stream']>> {
    const expiresAt = new Date(this.clock.nowMs() + TICKET_TTL_MS);
    const token = (
      await this.crypto.seal(
        PLATFORM_KEY_OWNER,
        `call-stream:${row.id}`,
        JSON.stringify({ userId: row.userId, expiresAt: expiresAt.getTime() }),
      )
    ).toString('base64url');
    return { path: `/api/v1/calls/${row.id}/stream`, token, expiresAt: expiresAt.toISOString() };
  }

  /** 校验音频流凭证；通过返回通话行（未结束）。 */
  async verifyTicket(callId: string, token: string): Promise<CallRow | null> {
    if (!token || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    try {
      const plain = await this.crypto.open(
        PLATFORM_KEY_OWNER,
        `call-stream:${callId}`,
        Buffer.from(token, 'base64url'),
      );
      const grant = JSON.parse(plain.toString('utf8')) as { userId: string; expiresAt: number };
      if (!Number.isFinite(grant.expiresAt) || grant.expiresAt <= this.clock.nowMs()) return null;
      const row = await this.find(callId);
      if (!row || row.userId !== grant.userId || row.state === 'ended') return null;
      return row;
    } catch {
      return null;
    }
  }

  // ---------- 音频流连接状态（stream-server 调用） ----------

  async streamAttached(callId: string, connection: string): Promise<void> {
    await this.database.db
      .update(callSessions)
      .set({ streamConnection: connection, streamLostAt: null })
      .where(and(eq(callSessions.id, callId), ne(callSessions.state, 'ended')));
  }

  async streamDetached(callId: string, connection: string): Promise<void> {
    const [row] = await this.database.db
      .update(callSessions)
      .set({ streamConnection: null, streamLostAt: this.clock.now() })
      .where(
        and(
          eq(callSessions.id, callId),
          eq(callSessions.streamConnection, connection),
          ne(callSessions.state, 'ended'),
        ),
      )
      .returning();
    if (row)
      await this.jobs.send(
        JOB_RECONNECT,
        { callId },
        { delayMs: (CALL_LIMITS.reconnectGraceSec + 1) * 1000 },
      );
  }

  async reconnectCheck(callId: string): Promise<void> {
    const row = await this.find(callId);
    if (!row || row.state !== 'active' || row.streamConnection || !row.streamLostAt) return;
    if (this.clock.nowMs() - row.streamLostAt.getTime() < CALL_LIMITS.reconnectGraceSec * 1000)
      return;
    await this.end(callId, 'failed');
  }

  /**
   * 通话中余额检查（stream-server 每 15 秒调用一次）：用完后记下时刻，ai-runtime 让角色道别并发 end；
   * 30 秒后仍未结束则强制以 insufficient_balance 结束。返回 true 表示已结束。
   */
  async checkBalanceDuringCall(row: CallRow): Promise<boolean> {
    const status = await this.billing.getSpendStatus(row.userId);
    if (!status.depleted) {
      if (row.balanceLowAt)
        await this.database.db
          .update(callSessions)
          .set({ balanceLowAt: null })
          .where(eq(callSessions.id, row.id));
      return false;
    }
    if (!row.balanceLowAt) {
      await this.database.db
        .update(callSessions)
        .set({ balanceLowAt: this.clock.now() })
        .where(and(eq(callSessions.id, row.id), isNull(callSessions.balanceLowAt)));
      return false;
    }
    if (this.clock.nowMs() - row.balanceLowAt.getTime() >= BALANCE_GOODBYE_MS) {
      await this.end(row.id, 'insufficient_balance');
      return true;
    }
    return false;
  }

  /** 每分钟兜底：响铃超时、拨出未自动接听、断线未重连、超过时长上限。 */
  async sweep(): Promise<void> {
    const now = this.clock.nowMs();
    const open = await this.database.db
      .select()
      .from(callSessions)
      .where(ne(callSessions.state, 'ended'))
      .limit(500);
    for (const row of open) {
      if (row.state === 'ended') continue;
      try {
        if (row.state === 'ringing') {
          const age = now - row.createdAt.getTime();
          if (row.direction === 'incoming' && age >= CALL_LIMITS.ringTimeoutSec * 1000)
            await this.end(row.id, 'missed');
          else if (row.direction === 'outgoing' && age >= CALL_LIMITS.outgoingRingMaxSec * 1000)
            await this.autoAnswer(row.id);
          continue;
        }
        if (this.durationOf(row) >= CALL_LIMITS.maxDurationSec) {
          await this.end(row.id, 'time_limit');
          continue;
        }
        const lostFor = row.streamLostAt ? now - row.streamLostAt.getTime() : 0;
        const neverConnected =
          !row.streamConnection &&
          !row.streamLostAt &&
          row.answeredAt &&
          now - row.answeredAt.getTime() > 60 * 1000;
        if (
          (!row.streamConnection && lostFor > CALL_LIMITS.reconnectGraceSec * 1000) ||
          neverConnected
        )
          await this.end(row.id, 'failed');
        else await this.checkBalanceDuringCall(row);
      } catch {
        // 单条失败不影响其他通话，下一分钟再试。
      }
    }
  }

  // ---------- 注销 ----------

  /** 后台彻底删除角色：该角色的全部通话会话。 */
  private async purgeCharacter(tx: DbTx, characterId: string): Promise<void> {
    await tx.db.delete(callSessions).where(eq(callSessions.characterId, characterId));
  }

  async purgeUser(userId: string): Promise<number> {
    const rows = await this.database.db
      .delete(callSessions)
      .where(eq(callSessions.userId, userId))
      .returning({ id: callSessions.id });
    return rows.length;
  }

  async countUserData(userId: string): Promise<number> {
    const rows = await this.database.db
      .select({ id: callSessions.id })
      .from(callSessions)
      .where(eq(callSessions.userId, userId));
    return rows.length;
  }
}
