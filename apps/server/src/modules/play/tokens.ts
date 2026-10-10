/**
 * play 模块对外的注入令牌（上层模块，ADR-0024）。
 * ai-runtime 可 import 本模块 index.ts（T-101 上层白名单 ai-runtime → play）；play 不能 import ai-runtime / growth，
 * 反方向一律用事件（play.*），发卡等需要 growth 的动作由 ai-runtime（T-096）调用或装配入口注入。
 */

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
