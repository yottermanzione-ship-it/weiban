/**
* 客服专用提示词（方向 B §7.5）：新知识库 + 只读用户状态简报 + 硬红线。
* 不复用角色聊天路的提示词，不读角色卡/世界书/记忆，不带任何角色身份表述。
*/
import type { ChatMessageForModel} from '@weiban/contracts';
import type { KnowledgeBaseEntry} from './knowledge-base.js';
import { OFFICIAL_UNKNOWN_TEXT} from './identity.js';

/** 模型输出后处理：去空白；空输出返回 null（调用方改发固定失败文案）；超长在句末截断。 */
export function sanitizeReply(text: string): string | null {
const trimmed = text.trim();
if (!trimmed) return null;
const MAX_REPLY_CHARS = 1800;
if (trimmed.length <= MAX_REPLY_CHARS) return trimmed;
const cut = trimmed.slice(0, MAX_REPLY_CHARS);
const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('\n'));
return lastStop > 200? cut.slice(0, lastStop + 1): `${cut}……`;
}

export function buildSystemPrompt(input: {
briefLines: string[];
matched: KnowledgeBaseEntry | null;
}): string {
const brief =
input.briefLines.length > 0
? input.briefLines.map((line) => `- ${line}`).join('\n')
: '- 本次没能查到用户状态；没查到的项不要编、不要猜。';
const kb = input.matched
? input.matched.unknown
? `本次问题属于“没有核实到”的条目（${input.matched.id}）：必须按未知口径答，不得编造。\n${input.matched.guidance?? ''}`
: `本次匹配到知识库条目 ${input.matched.id}，核实到的事实如下，必须按此回答，不得改动数字与规则：\n${input.matched.guidance?? input.matched.answer?? ''}`
: '本次没有匹配到知识库条目：只按“核实到的事实”和用户状态简报答；答不出按未知口径。';
return [
'你是小V同学，微伴的官方 AI 助手，不是真人，也不是任何角色。你在跟用户一对一聊天，语气像微信聊天：简洁、口语，必要时分点；不要模板腔，不要自称“作为 AI”。',
'只说下面“核实到的事实”里写明的公开内容；数字、价格、步骤一律以事实为准，不得改动、不得推测、不得编造。',
'（只读，不代操作）',
brief,
'',
kb,
'',
'- 绝不透露成本价/上游价、内部编号、报错堆栈、后台配置细节；只说前台已公开写出来的内容。',
'- 不向用户解释“平台付费、不扣积分”等内部规则；用户问费用只按事实答。',
'- 退款、付款核对、封禁、账号纠纷：只给微信 xingliubuji，不展开、不承诺处理结果。',
`- 不知道、没核实到：先说没核实到、再给微信。未知口径原文：「${OFFICIAL_UNKNOWN_TEXT}」不得说“已转人工、稍后回复”（没有人工接管和工单）。`,
'- 你不能改头像、改人设、代操作、进群聊发言、发朋友圈；用户要求这些时，说明你这边做不了，并指到对应功能或给微信。',
'- 只回答这一次对话里的事；不要提及记忆、长期记录、其他角色的聊天内容。',
'- 一条回复说完，不要分多条；不要用括号动作描写，不要输出思考过程。',
].join('\n');
}

/** 近期历史转模型消息：用户消息 role=user，官方回复 role=assistant；撤回/空正文已在调用方滤掉。 */
export function toModelMessages(
history: Array<{ senderKind: 'user' | 'official'; text: string}>,
): ChatMessageForModel[] {
return history.map((m) => ({
role: m.senderKind === 'user'? ('user' as const): ('assistant' as const),
content: m.text,
}));
}
