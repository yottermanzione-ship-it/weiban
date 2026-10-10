/**
 * play 模块对外的注入令牌（上层模块，ADR-0024）。
 * ai-runtime 可 import 本模块 index.ts（T-101 上层白名单 ai-runtime → play）；play 不能 import ai-runtime / growth，
 * 反方向一律用事件（play.*），发卡等需要 growth 的动作由 ai-runtime（T-096）调用或装配入口注入。
 */
import type { GrowthCardPort } from '@weiban/contracts';

/** 契约 PlayReadPort（ai-runtime：专注状态、心愿清单、提醒、待生成回信）。 */
export const PLAY_READ_PORT = Symbol('weiban.play.read-port');
/** 契约 PlayAgentPort（ai-runtime 回写「角色说的话」）。 */
export const PLAY_AGENT_PORT = Symbol('weiban.play.agent-port');

/**
 * 服务器内部（非契约）：每日一问 TA 的答案生成状态，给 T-096 使用。
 * - 生成时余额不足 → markDailyAnswerWaitingBalance：页面显示「余额不足，TA 暂时没法回答」；
 * - 余额恢复（billing.balance_restored）后 listDailyAnswersWaitingBalance 取出重试，成功后照常 setDailyCharacterAnswer。
 */
export const PLAY_DAILY_ANSWER_STATUS = Symbol('weiban.play.daily-answer-status');
export interface PlayDailyAnswerStatus {
  markDailyAnswerWaitingBalance(answerId: string): Promise<void>;
  listDailyAnswersWaitingBalance(userId: string): Promise<
    Array<{
      answerId: string;
      characterId: string;
      questionId: string;
      question: string;
      /** 用户的回答（生成 TA 的答案时作为上下文）。 */
      userAnswer: string;
      messageId: string | null;
    }>
  >;
  /** 生成 TA 的答案时读取题目与用户回答（收到 play.daily_answer_submitted 后调用）。 */
  getDailyAnswerForGeneration(answerId: string): Promise<{
    userId: string;
    characterId: string;
    question: string;
    userAnswer: string;
    status: 'pending' | 'ready' | 'waiting_balance';
  } | null>;
}

/**
 * 发瞬间卡（契约 GrowthCardPort.issueCard，kind = 'play'）。play 不能 import growth（上层白名单），
 * 由 app.module.ts 绑定到 growth 的 GROWTH_CARD_PORT；未绑定时不发卡（cardIssued 保持 false，以后补发）。
 * T-092 心愿完成、T-093 第一次收到某角色回信使用。
 */
export const PLAY_CARD_ISSUER = Symbol('weiban.play.card-issuer');
export type PlayCardIssuer = Pick<GrowthCardPort, 'issueCard'>;

/**
 * 心愿提议卡片（action_card，cardKind = wishlist_proposal）的约定，T-096 发卡片时使用：
 * ref = { kind: 'wishlist_proposal', id: proposalId }，按钮 actionId 用下面两个。
 */
export const WISHLIST_PROPOSAL_REF_KIND = 'wishlist_proposal';
export const WISHLIST_PROPOSAL_ACTIONS = { add: 'add', skip: 'skip' } as const;

/** 服务器内部（非契约）：心愿跟进标记，给 T-096（「我们那件事做了吗」每项最多问一次）。 */
export const PLAY_WISHLIST_FOLLOW_UP = Symbol('weiban.play.wishlist-follow-up');
export interface PlayWishlistFollowUp {
  /** 标记已跟进；返回 false 表示已跟进过或该项不存在 / 已完成（不要再问）。 */
  markWishlistFollowedUp(itemId: string): Promise<boolean>;
}

/**
 * 用户活跃时段（P-06 学到的活跃小时，用户时区 0～23）。数据归 ai-runtime（T-053 user_chat_activity），
 * play 不能 import ai-runtime，由 app.module.ts 绑定；未绑定或返回 null 时用 P-05 默认 09:00–23:00。
 * T-093 慢信回信送达时间使用。
 */
export const PLAY_ACTIVE_HOURS = Symbol('weiban.play.active-hours');
export interface PlayActiveHours {
  getActiveHours(userId: string): Promise<Set<number> | null>;
}
