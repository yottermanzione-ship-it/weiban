/** ai-runtime 对外令牌（由装配入口绑定给其他模块）。 */
/** 契约 CallAgentPort（T-072）：app.module 绑定为 calls 的 CALL_AGENT_PORT。 */
export const AI_CALL_AGENT_PORT = Symbol('weiban.ai-runtime.call-agent');
/** 契约 UserQuietStatePort（T-072，P-45）：其他模块只读。 */
export const AI_USER_QUIET_STATE_PORT = Symbol('weiban.ai-runtime.user-quiet-state-port');
/** 契约 ImportAnalyzerPort（T-081）：app.module 绑定为 importer 的 IMPORTER_ANALYZER。 */
export const AI_IMPORT_ANALYZER = Symbol('weiban.ai-runtime.import-analyzer');
/**
 * T-081 服务器内部：人设版本更新摘要（CHR-10 第 4 条），类型见 PersonaUpdateSummaryService.summarize。
 * characters 不能 import ai-runtime；需要时由装配入口绑给 characters 自己定义的令牌。
 */
export const AI_PERSONA_UPDATE_SUMMARIZER = Symbol('weiban.ai-runtime.persona-update-summarizer');
/**
 * T-082 服务器内部：卡片「角色写给你的一句话」（GRW-05，≤ 40 字），类型见 CardLineService.writeLine。
 * growth 自己发的纪念 / 熟悉度 / 节日 / 宠物卡若要用 AI 写这句话，由装配入口绑给 growth 定义的令牌。
 */
export const AI_CARD_LINE_WRITER = Symbol('weiban.ai-runtime.card-line-writer');
