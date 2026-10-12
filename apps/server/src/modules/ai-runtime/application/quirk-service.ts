import { Inject, Injectable } from '@nestjs/common';
import {
  P11_READ_NO_REPLY,
  P12_RECALL_RESEND_PER_CHARACTER_PER_DAY,
  P13_TYPO_CORRECTION_PER_CHARACTER_PER_DAY,
  type DbTx,
} from '../../../platform/index.js';
import {
  allowedQuirks,
  quirkDelay,
  QuirkAction,
  NO_QUIRK,
  ruleQuirk,
  type QuirkKind,
} from '../domain/quirks.js';
import { ReplyPlanStore, type ReplyPlan } from './plan-store.js';
import { PlannerService } from './planner.js';
import type { ReplySnapshot } from './reply-context.js';

type Usage = Partial<Record<QuirkKind, number>>;

function available(kind: QuirkKind, usage: Usage): boolean {
  if (kind === 'read_delay' || kind === 'shy_typing')
    return (usage.read_delay ?? 0) + (usage.shy_typing ?? 0) < P11_READ_NO_REPLY.perCharacterPerDay;
  if (kind === 'recall') return (usage.recall ?? 0) < P12_RECALL_RESEND_PER_CHARACTER_PER_DAY;
  if (kind === 'typo') return (usage.typo ?? 0) < P13_TYPO_CORRECTION_PER_CHARACTER_PER_DAY;
  return true;
}

@Injectable()
export class QuirkService {
  constructor(
    @Inject(ReplyPlanStore) readonly store: ReplyPlanStore,
    @Inject(PlannerService) readonly planner: PlannerService,
  ) {}

  private date(timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.store.clock.now());
  }

  private async usage(row: ReplyPlan, date: string, tx?: DbTx): Promise<Usage> {
    const result = await (tx ?? this.store.db).query<{ kind: QuirkKind; n: string }>(
      `SELECT kind,count(*)::text AS n FROM ai_runtime.quirk_actions
       WHERE user_id=$1 AND character_id=$2 AND local_date=$3 GROUP BY kind`,
      [row.userId, row.characterId, date],
    );
    return Object.fromEntries(result.rows.map((r) => [r.kind, Number(r.n)]));
  }

  async choose(row: ReplyPlan, snapshot: ReplySnapshot): Promise<QuirkAction> {
    if (row.kind !== 'message' || snapshot.trial) return NO_QUIRK;
    // 情景预设「树洞分享」（含自动判断为倾听）：小巧思全关（docs/refactor/03 第 4.2 节）。
    if (snapshot.effectiveStyle === 'treehole') return NO_QUIRK;
    const options = allowedQuirks({
      fit: snapshot.personaFit,
      tags: snapshot.personaTags,
      // 自动判断为斗嘴时按傲娇的小巧思（仍受次数上限）。
      scenarioMode: snapshot.effectiveStyle === 'tsundere' ? 'tsundere' : snapshot.scenarioMode,
      scope: snapshot.scope,
      instantReply: snapshot.instantReply,
      care: snapshot.highRisk || snapshot.careActive,
      suspected: snapshot.suspected,
      healthUsed: snapshot.healthUsed,
      userText: snapshot.userText,
      typoStyle: snapshot.typoStyle,
    });
    if (options.length === 1) return NO_QUIRK;
    const usage = await this.usage(row, this.date(snapshot.timeZone));
    const legal = options.filter((kind) => available(kind, usage));
    if (legal.length === 1) return NO_QUIRK;
    const rule = ruleQuirk(legal, snapshot.personaFit, Math.random());
    const decision = await this.planner
      .decide({
        userId: row.userId,
        characterId: row.characterId,
        conversationId: row.conversationId,
        decisionType: 'quirk',
        options: legal,
        ruleChoice: rule,
        conservative: 'none',
        ruleReason: '人设规则与当地自然日配额',
        question: '本轮可选人设小巧思；认真说事时选none，不生成回复正文。',
        features: {
          fit: snapshot.personaFit,
          tags: snapshot.personaTags,
          scenarioMode: snapshot.scenarioMode,
        },
        summary: null,
        adult: snapshot.scope === 'adult',
        path: 'reply',
        idempotencyKey: `${row.id}:${row.retryEpoch}:quirk`,
        timeoutMs: 1000,
      })
      .catch(() => null);
    const choice =
      decision && legal.includes(decision.choice as QuirkKind)
        ? (decision.choice as QuirkKind)
        : rule;
    if (choice === 'none') return NO_QUIRK;
    return {
      kind: choice,
      respondAt: new Date(
        this.store.clock.nowMs() + (choice === 'read_delay' ? quirkDelay(Math.random()) : 0),
      ).toISOString(),
      typingCycles: choice === 'shy_typing' ? 1 + Math.floor(Math.random() * 2) : 0,
    };
  }

  /** Caller holds the plan/user lock; counting and reserving stay in that same transaction. */
  async reserve(
    tx: DbTx,
    row: ReplyPlan,
    action: QuirkAction,
    timeZone: string,
  ): Promise<QuirkAction> {
    if (action.kind === 'none') return NO_QUIRK;
    if (!(await this.store.lock(tx, row.userId, row.conversationId))) return NO_QUIRK;
    const current = await tx.query(
      `SELECT id FROM ai_runtime.reply_plans
      WHERE id=$1 AND user_id=$2 AND character_id=$3 AND status='generating' AND lease_id=$4 FOR UPDATE`,
      [row.id, row.userId, row.characterId, row.leaseId],
    );
    if (!current.rows.length) return NO_QUIRK;
    const prior = await tx.query<{ kind: QuirkKind; respond_at: Date; typing_cycles: number }>(
      'SELECT kind,respond_at,typing_cycles FROM ai_runtime.quirk_actions WHERE plan_id=$1',
      [row.id],
    );
    if (prior.rows[0]) {
      const p = prior.rows[0];
      return p.kind === action.kind
        ? { kind: p.kind, respondAt: p.respond_at.toISOString(), typingCycles: p.typing_cycles }
        : NO_QUIRK;
    }
    const date = this.date(timeZone);
    if (!available(action.kind, await this.usage(row, date, tx))) return NO_QUIRK;
    await tx.query(
      `INSERT INTO ai_runtime.quirk_actions
      (plan_id,user_id,character_id,local_date,kind,respond_at,typing_cycles,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.id,
        row.userId,
        row.characterId,
        date,
        action.kind,
        action.respondAt,
        action.typingCycles,
        this.store.clock.now(),
      ],
    );
    return action;
  }

  /** Ephemeral flicker is best effort; parallel workers/retries may not replay it. */
  async consumeTyping(row: ReplyPlan): Promise<boolean> {
    return this.store.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, row.userId, row.conversationId))) return false;
      const plan = await tx.query(
        `SELECT id FROM ai_runtime.reply_plans
        WHERE id=$1 AND user_id=$2 AND status='sending' AND next_bubble=0 FOR UPDATE`,
        [row.id, row.userId],
      );
      if (!plan.rows.length) return false;
      const changed = await tx.query(
        `UPDATE ai_runtime.quirk_actions SET typing_consumed=true
        WHERE plan_id=$1 AND user_id=$2 AND kind='shy_typing' AND NOT typing_consumed RETURNING plan_id`,
        [row.id, row.userId],
      );
      return changed.rows.length === 1;
    });
  }
}
