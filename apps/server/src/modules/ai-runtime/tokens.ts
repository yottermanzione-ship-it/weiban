/** ai-runtime 对外令牌（由装配入口绑定给其他模块）。 */
/** 契约 CallAgentPort（T-072）：app.module 绑定为 calls 的 CALL_AGENT_PORT。 */
export const AI_CALL_AGENT_PORT = Symbol('weiban.ai-runtime.call-agent');
/** 契约 UserQuietStatePort（T-072，P-45）：其他模块只读。 */
export const AI_USER_QUIET_STATE_PORT = Symbol('weiban.ai-runtime.user-quiet-state-port');
