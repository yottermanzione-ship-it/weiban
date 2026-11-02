/**
 * 小V同学官方身份的固定文案与身份判定（方向 B）。
 * 固定键/固定 refId 见契约（OFFICIAL_IDENTITY_KEY / OFFICIAL_REF_ID），这里只放文案与判定。
 * 文案口径来源见各条注释；待确认的文案标 TODO(待确认），不得擅自改成别的说法。
 */
import {
  OFFICIAL_IDENTITY_KEY,
  OFFICIAL_NAME,
  OFFICIAL_REF_ID,
  type Conversation,
  type Participant,
} from '@weiban/contracts';

export { OFFICIAL_IDENTITY_KEY, OFFICIAL_NAME, OFFICIAL_REF_ID };

/** 沿用旧版签名（Q1 头像/签名沿用与否待总控确认，当前按旧版）。 */
export const OFFICIAL_SIGNATURE = '微伴官方小客服，使用上有任何问题都可以问我～';

/**
 * 欢迎语定稿（2026-10-31 晓楠认可：仅替换旧版一句，其余沿用旧版原文）。
 * 只在官方会话首次创建时发一条，幂等键去重、永不重发。
 */
export const OFFICIAL_WELCOME_TEXT =
  '你好呀，我是小V同学。微伴使用上有任何问题都可以直接问我，需要帮忙的时候也可以把情况告诉我，我来帮你看看～';

/**
 * 未知口径定稿（2026-10-31 晓楠定：一般问题答不出也先给微信）。
 * 先说没核实到、再给微信；不得只给微信不说明，不得编答案，不得接“稍后人工回复/已转工单”。
 */
export const OFFICIAL_UNKNOWN_TEXT =
  '这个问题我目前没有核实到确切答案，先不跟你乱说；你可以加微信 xingliubuji 把情况告诉我。';

/** 模型调用失败时的固定回复：不说技术原因、不编答案，给微信口径。 */
export const OFFICIAL_FAILURE_TEXT =
  '我这边现在有点忙，没能帮你查到；你可以加微信 xingliubuji 把情况告诉我。';

/**
 * TODO(待确认）：限频超限文案尚未定稿（方案 Q4 第 2 点待确认）。
 * 当前为旧版同类文案占位，定稿后只改这一处。
 */
export const OFFICIAL_RATE_LIMIT_TEXT = '今天和小V聊得有点多啦，明天再来找我聊～';

/**
 * 非文字消息的固定回复：客服暂不处理图片/语音/链接内容，不调模型、不猜内容。
 * 拍一拍、表情包等不触发回复（lifecycle 只对 text/image/voice/link 投递任务，见 engine）。
 * TODO(待确认）：Q5 发图/跳转/语音/表情包待确认后，这里的口径随能力一起改。
 */
export const OFFICIAL_NON_TEXT_TEXT =
  '我这边暂时只能看文字消息，你用文字把问题发给我，我来帮你看看～';

/** 本会话近期历史窗口：最近 N 条文字消息（“近期历史”具体范围待确认，见 Q7 待确认项）。 */
export const RECENT_HISTORY_LIMIT = 10;

/**
 * 会触发客服处理的用户消息类型：文字走回答引擎；图片/语音/链接/合并转发只发固定提示；
 * 其余类型（拍一拍、表情包等）静默不回。lifecycle 与 engine 共用同一集合，不得各写一份。
 */
export const OFFICIAL_TRIGGER_CONTENT_TYPES = new Set([
  'text',
  'image',
  'voice',
  'link',
  'forwarded_record',
]);

/** 官方会话判定：direct + 含 kind='official' 且 refId 为固定键的参与者。 */
export function isOfficialConversation(conversation: Conversation): boolean {
  return (
    conversation.type === 'direct' &&
    conversation.participants.some((p) => p.kind === 'official' && p.refId === OFFICIAL_REF_ID)
  );
}

/** 取会话里的官方参与者；没有则返回 null（调用方按“不是官方会话”处理）。 */
export function officialParticipantOf(conversation: Conversation): Participant | null {
  return (
    conversation.participants.find((p) => p.kind === 'official' && p.refId === OFFICIAL_REF_ID) ??
    null
  );
}
