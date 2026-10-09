/**
 * 3.0 L4～L7 新模块的端口（T-062）。各端口的提供方、调用方见注释与 docs/architecture/contracts-3.0-map.md。
 * 依赖方向（ADR-0004 / R11）：上层模块之间只允许单向；calls（中层）通过 CallAgentPort 反转依赖，由组合根注入 ai-runtime 的实现。
 */
import type { PortResult, Tx } from './common.js';
import type { MomentsPost } from '../http/moments.js';
import type { CardKind } from '../http/growth-cards.js';
import type { PetStage } from '../http/pets.js';
import type { CallSession } from '../http/calls.js';
import type { PrivacyKind } from '../http/plaza.js';
import type { ImportResult } from '../http/importer.js';
import type { FocusSession, Reminder, WishlistItem } from '../http/play.js';

// ---------- moments（提供方 moments，调用方 ai-runtime） ----------

export interface MomentsReadPort {
  getPost(ownerUserId: string, postId: string): Promise<MomentsPost | null>;
  /** 角色最近的动态（避免重复、P-16 计数）。 */
  listCharacterPosts(ownerUserId: string, characterId: string, since: string): Promise<MomentsPost[]>;
  /** 用户发的、对该角色可见的动态（SOC-09 第 5 条记忆素材；不可见的角色不得提起）。 */
  listUserPostsVisibleTo(
    ownerUserId: string,
    characterId: string,
    since: string,
  ): Promise<MomentsPost[]>;
}

export interface MomentsLinkInput {
  url: string;
  title: string;
  source: string | null;
  coverMediaId: string | null;
  appHint: 'music' | 'video' | 'web';
}

/** 以角色身份发圈、点赞、评论。幂等键相同只生效一次。 */
export interface MomentsCharacterPort {
  createPost(
    tx: Tx | null,
    input: {
      ownerUserId: string;
      characterId: string;
      text: string;
      imageMediaIds: string[];
      link: MomentsLinkInput | null;
      /** 对应的日常事件 / 公开动态 / 节日 / 宠物（SOC-07 验收：每条都能对应来源）。 */
      sourceRef: { kind: 'daily_event' | 'public_update' | 'holiday' | 'pet'; id: string };
      idempotencyKey: string;
    },
  ): Promise<PortResult<MomentsPost, 'character_not_in_contacts'>>;
  like(input: {
    ownerUserId: string;
    postId: string;
    characterId: string;
    idempotencyKey: string;
  }): Promise<PortResult<void, 'not_found' | 'not_visible'>>;
  comment(input: {
    ownerUserId: string;
    postId: string;
    characterId: string;
    text: string;
    replyToCommentId: string | null;
    mentionsUser: boolean;
    idempotencyKey: string;
  }): Promise<PortResult<{ commentId: string }, 'not_found' | 'not_visible' | 'comment_limit'>>;
}

// ---------- growth（提供方 growth，调用方 ai-runtime） ----------

export interface GrowthReadPort {
  getFamiliarityLevel(userId: string, characterId: string): Promise<number | null>;
  getDaysKnown(userId: string, characterId: string): Promise<number | null>;
}

/** ai-runtime 发瞬间卡（名场面、宠物、玩法、第一次通话、被拉群等）。同一幂等键只发一张。 */
export interface GrowthCardPort {
  issueCard(
    tx: Tx | null,
    input: {
      userId: string;
      characterId: string;
      kind: CardKind;
      title: string;
      line: string;
      faceMediaId: string | null;
      templateId: string | null;
      sourceMessageIds: string[];
      idempotencyKey: string;
    },
  ): Promise<PortResult<{ cardId: string; serialNo: number }, 'weekly_moment_limit'>>;
}

export interface PetForRuntime {
  petId: string;
  name: string;
  speciesName: string;
  appearanceName: string;
  stage: PetStage;
  daysAdopted: number;
  allowMomentsShare: boolean;
  todayInteractionCount: number;
  status: 'active' | 'sent_away';
  presetImageMediaId: string;
}

export interface PetReadPort {
  listPetsForCharacter(userId: string, characterId: string): Promise<PetForRuntime[]>;
}

/** ai-runtime 回传「让 TA 起名」的候选名（CR-22）。 */
export interface PetNamingPort {
  submitNameCandidates(
    requestId: string,
    names: string[],
  ): Promise<PortResult<void, 'not_found' | 'invalid_names'>>;
  failNaming(requestId: string): Promise<void>;
}

// ---------- calls（ADR-0025） ----------

/** 提供方 calls；调用方 ai-runtime（主动来电，MED-07）。 */
export interface CallSessionPort {
  /** 发起来电：响铃、推送 kind = call、写 call.updated 更新。频率、熟悉度、静默、专注由 ai-runtime 先判断。 */
  startIncomingCall(input: {
    userId: string;
    characterId: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<PortResult<CallSession, 'busy' | 'contact_inactive' | 'service_disabled'>>;
  getActiveCall(userId: string): Promise<CallSession | null>;
}

export type CallAgentSignal =
  | { kind: 'speaking'; speaking: boolean }
  | { kind: 'end'; outcome: 'completed' | 'time_limit' | 'insufficient_balance' | 'failed' };

/** 通话中 ai-runtime 一侧的一次会话。calls 把音频转给它，把它产出的音频发给客户端。 */
export interface CallAgentSession {
  readonly outputSampleRate: number;
  onUserAudio(chunk: Uint8Array): void;
  /** 用户打断（客户端 barge_in）。 */
  onBargeIn(): void;
  onMute(muted: boolean): void;
  /** 角色要说的音频（PCM16 小端单声道，采样率 outputSampleRate）。 */
  audio(): AsyncIterable<Uint8Array>;
  /** 说话状态与结束请求（时长上限道别后、余额用完道别后）。 */
  signals(): AsyncIterable<CallAgentSignal>;
  /** 通话结束（任何原因）；ai-runtime 结算、整理通话摘要入记忆（MED-06 第 5 条）。 */
  close(input: { durationSec: number; outcome: string }): Promise<void>;
}

/**
 * 提供方 ai-runtime，调用方 calls（依赖反转：接口在契约，组合根注入）。
 * openSession 在接通时调用；返回错误时 calls 以对应结果结束通话。
 */
export interface CallAgentPort {
  openSession(input: {
    callId: string;
    userId: string;
    characterId: string;
    conversationId: string;
    direction: 'outgoing' | 'incoming';
  }): Promise<
    PortResult<CallAgentSession, 'insufficient_balance' | 'service_disabled' | 'not_available'>
  >;
}

// ---------- plaza 检测（提供方 ai-runtime，调用方只有 plaza，CR-20） ----------

export interface PlazaPrivacySpanResult {
  fieldKey: string;
  start: number;
  end: number;
  kinds: PrivacyKind[];
  source: Array<'rule' | 'self_data' | 'model'>;
}

export interface PlazaPublishCheckPort {
  checkBeforePublish(input: {
    userId: string;
    idempotencyKey: string;
    source:
      | { kind: 'custom_character'; characterId: string }
      | { kind: 'preset_variant'; presetCharacterId: string };
    texts: Array<{ fieldKey: string; text: string }>;
  }): Promise<
    PortResult<
      {
        spans: PlazaPrivacySpanResult[];
        /** 已写回源角色。 */
        childFeaturesDetected: boolean;
        usageRecordIds: string[];
      },
      'insufficient_balance' | 'check_unavailable' | 'bad_request'
    >
  >;
}

// ---------- importer（提供方 ai-runtime，调用方 importer） ----------

export interface ImportDialogueLine {
  speaker: string;
  text: string;
}

export interface ImportAnalyzerPort {
  /** 预计花费（微元），按价目表估算。 */
  estimate(input: { userId: string; charCount: number; screenshotCount: number }): Promise<number>;
  /** 截图识别对话（D-L6-07）：右侧气泡 = 导入者本人。 */
  recognizeScreenshots(input: {
    userId: string;
    jobId: string;
    mediaIds: string[];
    idempotencyKey: string;
  }): Promise<
    PortResult<
      Array<ImportDialogueLine & { screenshotIndex: number }>,
      'insufficient_balance' | 'vision_unavailable' | 'model_unavailable'
    >
  >;
  /** 规则识别失败时用模型识别格式（runtime-overview.md 第 12 节第 1 条）。 */
  detectSpeakers(input: {
    userId: string;
    jobId: string;
    sample: string;
    idempotencyKey: string;
  }): Promise<
    PortResult<ImportDialogueLine[], 'insufficient_balance' | 'model_unavailable' | 'format_unrecognized'>
  >;
  /** 分析生成草稿或补充设定（分块并行在 ai-runtime 内部）；原文不得进入任何日志。 */
  analyze(input: {
    userId: string;
    jobId: string;
    kind: 'new_character' | 'supplement';
    targetCharacterId: string | null;
    speaker: string;
    lines: ImportDialogueLine[];
    idempotencyKey: string;
    onProgress: (percent: number) => void;
  }): Promise<PortResult<ImportResult, 'insufficient_balance' | 'model_unavailable'>>;
}

// ---------- play（提供方 play，调用方 ai-runtime） ----------

export interface PlayReadPort {
  /** 用户正在专注（PLAY-06 第 3 条：所有角色安静）。 */
  getActiveFocus(userId: string): Promise<FocusSession | null>;
  listWishlist(userId: string, characterId: string): Promise<WishlistItem[]>;
  getReminder(reminderId: string): Promise<Reminder | null>;
  /** 待生成的回信（送达前约 10 分钟取，或余额恢复后补生成）。 */
  listPendingLetterReplies(userId: string): Promise<
    Array<{ letterId: string; characterId: string; inReplyToLetterId: string | null; deliverAt: string }>
  >;
  /** 来信正文（生成回信时作为上下文）。 */
  getLetterBody(letterId: string): Promise<string | null>;
}

/** ai-runtime 回写玩法里「角色说的话」。 */
export interface PlayAgentPort {
  /** 每日一问：TA 的答案（接话由 ai-runtime 自己作为私聊消息发出）。 */
  setDailyCharacterAnswer(input: {
    answerId: string;
    answer: string;
  }): Promise<PortResult<void, 'not_found'>>;
  /** 心愿清单：登记角色提议，返回 proposalId 作为卡片消息 ref（用户点「加进去」后 play 建项并标「TA 提议」）。 */
  createWishlistProposal(input: {
    userId: string;
    characterId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<PortResult<{ proposalId: string }, 'weekly_limit' | 'list_full'>>;
  /** 慢信：送达回信（play 在一个事务里发信件卡片消息、更新状态、推送）。 */
  deliverLetterReply(input: {
    letterId: string;
    body: string;
    idempotencyKey: string;
  }): Promise<PortResult<{ messageId: string }, 'not_found' | 'contact_inactive'>>;
  /** 慢信：角色主动寄信（纪念日，计入 P-03）。 */
  sendCharacterLetter(input: {
    userId: string;
    characterId: string;
    body: string;
    idempotencyKey: string;
  }): Promise<PortResult<{ letterId: string }, 'contact_inactive'>>;
  /** TA 的提醒：5 种说法（每条 ≤ 40 字，可含 {称呼}）。 */
  setReminderPhrasings(input: {
    reminderId: string;
    phrasings: string[];
  }): Promise<PortResult<void, 'not_found'>>;
}

// ---------- ai-runtime 对外只读（P-45 静默） ----------

/** 提供方 ai-runtime；调用方：其他需要显示或判断「不方便」静默的模块（只读）。 */
export interface UserQuietStatePort {
  /** P-45「不方便」静默到何时（对该用户所有角色生效）；没有为 null。 */
  getInconvenientUntil(userId: string): Promise<string | null>;
}
