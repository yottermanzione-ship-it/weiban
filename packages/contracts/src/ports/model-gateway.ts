/**
 * 模型网关端口。提供方：model-access。全系统调用模型上游的唯一出口（engineering-standards R4）。
 * 网关统一负责：选模型（按 modelRole 与角色覆盖）、policy 检查（成人生成、无审查模型）、
 * 冻结与结算（经 BillingReservationPort，ADR-0012）、解密上游密钥、重试与错误分类（message-reliability.md 第 6 节）、
 * 用量记账、日志消毒。
 *
 * v0.2（T-009）：BYOK 删除。billingOwner 的含义改为「扣哪个账户」：user = 用户钱包，platform = 平台账户。
 * v1.1（T-020）：新增用途 safety_followup、behavior_planning；安全优先透支（safetyPriority、
 * SAFETY_OVERDRAFT_PURPOSES）；countAsBackground；meta.conversationKind。
 * 请求 / 响应的消息结构仍是草案：AI 系统负责人可提出变更申请（流式输出、多模态、工具调用），架构批准后修改。
 */
import { z } from 'zod';
import type { ModelRole, ModelScenario } from '../http/model-access.js';
import type { PortResult } from './common.js';

/** 调用用途：用于用量页分类和预算判断。新增用途属于次版本变更。 */
export const ModelPurpose = z.enum([
  'chat_reply', // 私聊 / 群聊回复（含首条问候、恢复后合并回复、成人模式回复）
  'safety_check', // 安全关怀识别、边界检查
  'memory', // 记忆提取与长对话整理
  'simulation', // 推演日常、近期主线
  'proactive', // 主动消息、群聊自发、来电开场
  'moments', // 朋友圈生成与互动
  'vision', // 识图
  'voice', // 语音合成 / 识别 / 通话
  'image_generation', // 角色发图
  'web_search', // 联网搜索
  'import_analysis', // 导入聊天记录生成草稿、儿童特征检测
  'admin_distill', // 管理员：蒸馏公开资料生成角色草稿
  'admin_persona_check', // 管理员：人设稳定检查
  'admin_public_update_search', // 管理员：公开动态候选搜索
  'admin_eval', // 管理员：评测集、排行榜自测
  'admin_upstream_test', // 管理员：上游连通测试与恢复探测
  'safety_followup', // v1.1：安全关怀次日跟进（SAFE-06 第 6 条），不受后台预算限制
  'behavior_planning', // v1.1：行为规划决策层（PRD PLAN-03）；是否计入后台预算看 countAsBackground
  'small_v',
  'search_candidates',
]);
export type ModelPurpose = z.infer<typeof ModelPurpose>;

/**
 * 属于「后台功能」的用途：受用户后台每日上限约束；聊天回复不受约束。
 * 范围与 docs/ai/cost-estimate.md 第 6 节一致（用户主动发起的导入不计入）。
 */
export const BACKGROUND_PURPOSES: readonly ModelPurpose[] = [
  'memory',
  'simulation',
  'proactive',
  'moments',
];

/**
 * 不受用户后台每日上限约束的安全用途。3.16由可信平台能力支付，不从用户余额扣费。
 * v1.1：加入 safety_followup（AI 负责人变更申请第 12 条，T-020 批准）。
 */
export const BUDGET_EXEMPT_PURPOSES: readonly ModelPurpose[] = ['safety_check', 'safety_followup'];

/**
 * 旧字段兼容列表。3.16已取消用户透支；此列表不再赋予额度或平台付款权限。
 */
export const SAFETY_OVERDRAFT_PURPOSES: readonly ModelPurpose[] = [
  'chat_reply',
  'safety_check',
  'safety_followup',
];

/** 计费账户：user = 用户钱包；platform仅管理员工具或独立可信平台能力，不能由HTTP客户端自选。 */
export const BillingOwner = z.enum(['user', 'platform']);
export type BillingOwner = z.infer<typeof BillingOwner>;

/** 3.0：随消息附带的图片（识图，MED-04、MED-01 第 3 条）。网关经 MediaSystemPort 读取后交给上游，调用方不传字节。 */
export interface ModelImageRef {
  mediaId: string;
  ownerUserId: string;
}

export interface ChatMessageForModel {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /**
   * 3.0：附带图片（只允许 role = user）。3.24 起有图片时要求本次解析出的模型具备 vision 能力，否则 capability_missing。
   * 3.29（H3）：私聊 / 群聊回复、朋友圈评论把本轮新图直接附在回复调用里（一步看图），回复顺带输出图片描述尾标供存档。
   */
  images?: ModelImageRef[];
}

export interface GenerateTextInput {
  /** 发起调用的真实用户；可信平台用途也按此ID归属、限频和审计。 */
  userId: string;
  purpose: ModelPurpose;
  billingOwner: BillingOwner;
  /** 用哪一类模型；网关按用户的选择解析出具体模型（后台未设置时沿用聊天模型）。 */
  modelRole: ModelRole;
  /**
   * 涉及具体角色时必填：用于角色模型覆盖和 policy 检查。
   * 解析出的模型带 adult_content 能力时，缺少 characterId 一律拒绝（model_not_allowed）。
   */
  characterId?: string;
  /** 涉及具体会话时必填。 */
  conversationId?: string;
  messages: ChatMessageForModel[];
  /** 最大输出token；不传按用途取默认值，须处于核准供应商总输出边界内。冻结不用经验估算。 */
  maxOutputTokens?: number;
  /** 可选调用方绝对截止时间（ISO），预算包含网关重试；AI用它保证首气泡期限。 */
  deadlineAt?: string;
  temperature?: number;
  /** 要求模型输出 JSON 时提供（网关不解释 schema，只透传给支持的上游）。 */
  responseFormat?: 'text' | 'json';
  /** 幂等键：同一键在 24 小时内重复调用，返回第一次的结果，不再冻结、不再扣费。 */
  idempotencyKey: string;
  /**
   * 旧安全优先标记兼容字段，3.16不再允许用户透支，也不凭此标记获得平台付款权限。
   */
  safetyPriority?: boolean;
  /**
   * 按「后台功能」计入用户后台每日上限（v1.1，billing.md 第 7 节第 1 条）。用于用途本身不在
   * BACKGROUND_PURPOSES、但这次是系统主动发起的调用，例如为主动行为做的行为规划（PLAN-03）、朋友圈配图。
   * 只能让调用更受限：BACKGROUND_PURPOSES 中的用途不传也照样计入；BUDGET_EXEMPT_PURPOSES 中的用途忽略此项。
   */
  countAsBackground?: boolean;
  /** 服务端逐入口确认的角色自主生态任务；不从purpose/background自动推断。 */
  ecologyTask?: boolean;
  /**
   * 记入用量记录，追查「变脸」用（AI 负责人申请，T-009 批准）。
   * v1.1：conversationKind（私聊 / 群聊）供管理后台用量明细显示（ADM-08）。
   */
  /**
   * 3.0（CR-17）：只允许与 purpose = behavior_planning 同时出现（否则 bad_request）；模型须在目录中 defaultFor 含 planner
   * 或由行为规划配置指定。照常按用户余额扣费。
   */
  modelKeyOverride?: string;
  /**
   * 3.22：按哪个场景的模型配置解析（只对 modelRole = chat 有意义，目前只有通话用 voice_call）。
   * 不传时：chat → 文本聊天（purpose = vision 时 → 图片识别）；adult → 私密模式；background → 文本聊天（同一角色的设置）。
   */
  scenario?: ModelScenario;
  meta?: {
    personaVersion?: number;
    promptTemplateVersion?: string;
    scenarioMode?: string;
    conversationKind?: 'direct' | 'group';
    /**
     * v3.6：messages 开头「稳定部分」的字符数（两次请求之间不变、可命中前缀缓存的部分）。
     * 网关折算成估算 token 写入用量记录，供「理论可缓存占比」统计（docs/refactor/09-chat-pipeline.md 第 6 节）。
     */
    stablePrefixChars?: number;
  };
}

export interface GenerateTextOutput {
  text: string;
  /** 实际使用（并计费）的模型。 */
  modelKey: string;
  /** 3.17：带图而聊天模型无识图能力，本次改用平台默认识图模型（modelKey 即该模型）；供界面提示一次。 */
  usedVisionDefault?: boolean;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    /** 3.24：缓存写入 token（只有 Anthropic 原生协议报告）。 */
    cacheWrite5mTokens?: number;
    cacheWrite1hTokens?: number;
    outputTokens: number;
    estimated: boolean;
  };
  /** 本次从账户扣的金额（微元）。 */
  chargedMicros: number;
  latencyMs: number;
  usageRecordId: string;
}

export type GenerateError =
  | 'not_configured' // 没有可用的模型（用户未选且平台无默认）
  | 'insufficient_balance' // 余额不足（未调用上游）
  | 'budget_exceeded' // 后台每日上限或平台每日总上限（未调用上游）
  | 'model_unavailable' // 模型下架、没有价格
  | 'provider_unavailable' // 上游重试后仍失败（不扣费）
  | 'capability_missing' // 所选模型不具备所需能力（如识图）
  | 'model_not_allowed' // 无审查模型用于无成人资格的角色或无角色调用
  | 'policy_denied' // 硬性边界拒绝（如为无资格角色做成人生成）
  | 'content_rejected' // 被上游内容审核拦截（不扣费）
  | 'bad_request';

export interface ModelGatewayPort {
  generateText(input: GenerateTextInput): Promise<PortResult<GenerateTextOutput, GenerateError>>;
  /**
   * 用户当前能否和某角色聊天（模型已选且可用、余额充足）。ai-runtime 安排后台任务前、
   * 界面横条（GET /model/status）都用它；上游恢复由网关自己探测并发布 model_access.model_status_changed。
   */
  getModelStatus(
    userId: string,
    characterId: string | null,
  ): Promise<{
    available: boolean;
    reason:
      'not_configured' | 'insufficient_balance' | 'provider_unavailable' | 'model_removed' | null;
  }>;
}

/**
 * 3.16：仅服务器可信业务注入，不作为HTTP请求字段；普通聊天不能借用平台账户。
 * 3.29（H3，13 号 §6「安全把关、关怀跟进由平台承担」）：modelRole = 'adult' 只允许与 purpose = safety_check /
 * safety_followup 同时出现，表示私密模式里的安全关怀（风险判断、关怀回合、次日跟进）——平台付费（不扣用户积分，
 * 余额 ≤ 0 也照常执行），但模型仍按该用户为这个角色配置的「私密模式」场景解析，私密内容不出私密范围；
 * 必须带 characterId 与 conversationId，照常经私密资格检查，否则 bad_request / policy_denied。其余 modelRole 一律按平台内部模型。
 */
export interface ModelGatewayPlatformPort {
  generatePlatformText(
    input: Omit<GenerateTextInput, 'billingOwner' | 'safetyPriority' | 'purpose'> & {
      /** 3.19：moments = 官方角色公共朋友圈（每角色每天一份、所有用户共用，平台承担，16 号 §4）。 */
      purpose: 'safety_check' | 'safety_followup' | 'small_v' | 'search_candidates' | 'moments';
    },
  ): Promise<PortResult<GenerateTextOutput, GenerateError>>;
}

/**
 * 3.1（积压 ㉖）：按用户所选模型报价。提供方 model-access（网关先按用途 / 角色覆盖 / 平台默认解析模型，
 * 再经 BillingQuotePort 按当前价目表计价）；调用方 ai-runtime（导入估价、行为规划成本闸等）。不调用上游、不冻结、不扣费。
 * 单独成接口，新增它不影响已有网关实现。
 */
export interface ModelQuotePort {
  quote(input: {
    userId: string;
    characterId?: string;
    purpose: ModelPurpose;
    /** 3.17：带图片时与网关执行同口径（聊天模型无识图能力 → 平台默认识图模型）。 */
    hasImages?: boolean;
    /** 3.17：只允许 behavior_planning，与网关 modelKeyOverride 同口径（后台指定的规划模型）。 */
    modelKeyOverride?: string;
    /** 3.22：与 GenerateTextInput.scenario 同口径。 */
    scenario?: ModelScenario;
    /** 估算用量（输入 token 估算值 + maxOutputTokens 等），单位同 billing 的 UsageQuantities。 */
    estimate: import('./billing.js').UsageQuantities;
  }): Promise<
    PortResult<
      { modelKey: string; amountMicros: number; priceVersionId: string },
      'not_configured' | 'model_removed' | 'price_missing'
    >
  >;
}

/** 模式设置用只读解析端口，不调用模型、不扣费、不返回上游配置。 */
export interface AdultModelReadPort {
  getAdultModelStatus(
    userId: string,
    characterId: string,
  ): Promise<{
    available: boolean;
    reason:
      'not_configured' | 'model_removed' | 'provider_unavailable' | 'model_not_allowed' | null;
  }>;
}

/** 模型故障提醒的只读受影响用户筛选；仅检查选择/默认/覆盖及当前故障，不调用上游。 */
export interface ModelNotificationReadPort {
  affectedUsers(
    userIds: readonly string[],
    modelKey: string,
    tx?: import('./common.js').Tx,
    previousDefaultFor?: readonly ('chat' | 'background' | 'vision')[],
  ): Promise<string[]>;
}

// ---------- 3.0：多媒体与搜索、决策（L5、L7，AI 变更申请第 14、18 条，ADR-0025） ----------
// 下列方法同样走 policy 检查、冻结 / 结算、用量记录；平台未设置对应 defaultFor 时返回 not_configured（= 平台未开通）。

/** 公共计费字段。 */
export interface MediaCallBase {
  userId: string;
  purpose: ModelPurpose;
  billingOwner: BillingOwner;
  characterId?: string;
  conversationId?: string;
  idempotencyKey: string;
  countAsBackground?: boolean;
  ecologyTask?: boolean;
}

export interface MediaCallResult {
  modelKey: string;
  chargedMicros: number;
  latencyMs: number;
  usageRecordId: string;
}

/** 语音合成（角色语音消息、通话中整句合成；按 tts_10k_chars 计价）。 */
export interface SynthesizeSpeechInput extends MediaCallBase {
  text: string;
  /** 音色库 voiceId（media）；网关解析成上游音色代号。 */
  voiceId: string;
  format: 'ogg_opus' | 'pcm16_24k';
}

/** 语音识别（用户语音消息；按 asr_minute 计价）。 */
export interface TranscribeSpeechInput extends MediaCallBase {
  mediaId: string;
  ownerUserId: string;
}

/** 图片生成（按 image 计价）。调用前必须已过 PolicyPort.checkImageGeneration；生成后人脸复检由 AI 负责。 */
export interface GenerateImageInput extends MediaCallBase {
  prompt: string;
  /** 画风（历史人物古风插画须为 classical_illustration）。 */
  style: 'classical_illustration' | 'unspecified';
  size: '1024x1024' | '768x1024' | '1024x768';
  /** 结果作为哪个用户的媒体保存（purpose = generated_image）。 */
  ownerUserId: string;
}

/** 联网搜索（按 search_call 计价）。 */
export interface GatewayWebSearchInput extends MediaCallBase {
  /** P3：图片当轮检索的绝对截止时间；过期后不得再发送供应商请求。 */
  deadlineAt?: string;
  query: string;
  maxResults: number;
  needContent?: boolean;
  originalQuestion?: string;
}

/** 3.30：由搜索供应商抓取公开网页；按 search_call 计价。 */
export interface GatewayWebFetchInput extends MediaCallBase {
  url: string;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source: string | null;
  publishedAt: string | null;
  authority?: number;
  relevance?: number;
  content?: string;
}

/** 实时语音识别流（通话中听用户，ADR-0025）：网关按分钟分段冻结与结算（长通话分段冻结）。 */
export interface RealtimeAsrSession {
  pushAudio(chunk: Uint8Array): void;
  /** 识别结果（中间结果 final = false）。 */
  results(): AsyncIterable<{ text: string; final: boolean }>;
  /** 结束并按实际分钟结算。可重复调用。 */
  close(): Promise<MediaCallResult>;
}

/** 流式语音合成（通话中角色说话）。abort 用于打断（MED-06 第 2 条），只结算已合成的字数。 */
export interface StreamingTtsResult {
  audio: AsyncIterable<Uint8Array>;
  abort(): void;
  done: Promise<PortResult<MediaCallResult, GenerateError>>;
}

/** 决策问题（CR-18：Jev 风格的类型化问题；默认实现也用同一形状）。 */
export interface DecideQuestion {
  questionId: string;
  kind: 'yes_no' | 'choice' | 'scale';
  prompt: string;
  /** choice 的选项（≤ 255）；scale 的级数 2～10 用 scaleSize。 */
  options?: string[];
  scaleSize?: number;
}

export interface DecideInput extends MediaCallBase {
  purpose: 'behavior_planning';
  modelKey: string;
  /** 经出境净化后的情境（behavior-planning.md 5.4）。 */
  state: Record<string, unknown>;
  questions: DecideQuestion[];
  deadlineAt?: string;
}

export interface DecideOutput extends MediaCallResult {
  answers: Array<{
    questionId: string;
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
  }>;
}

/** 3.0：模型网关的多媒体扩展。提供方 model-access；调用方 ai-runtime、calls 不直接调用（经 CallAgentPort 由 ai-runtime 调）。 */
export interface ModelGatewayMediaPort {
  synthesizeSpeech(
    input: SynthesizeSpeechInput,
  ): Promise<PortResult<MediaCallResult & { mediaId: string; durationMs: number }, GenerateError>>;
  transcribeSpeech(
    input: TranscribeSpeechInput,
  ): Promise<PortResult<MediaCallResult & { text: string }, GenerateError>>;
  generateImage(
    input: GenerateImageInput,
  ): Promise<PortResult<MediaCallResult & { mediaId: string }, GenerateError>>;
  webSearch(
    input: GatewayWebSearchInput,
  ): Promise<PortResult<MediaCallResult & { items: WebSearchResultItem[] }, GenerateError>>;
  /** 旧的媒体端口实现可不支持抓取；调用方须检查是否存在。 */
  webFetch?(
    input: GatewayWebFetchInput,
  ): Promise<PortResult<MediaCallResult & { title: string; content: string }, GenerateError>>;
  openRealtimeAsr(
    input: MediaCallBase & { sampleRate: 16000 },
  ): Promise<PortResult<RealtimeAsrSession, GenerateError>>;
  streamSpeech(
    input: Omit<SynthesizeSpeechInput, 'format'> & { format: 'pcm16_24k' },
  ): Promise<PortResult<StreamingTtsResult, GenerateError>>;
  /** 行为规划决策（CR-18）。 */
  decide(input: DecideInput): Promise<PortResult<DecideOutput, GenerateError>>;
  /** P3：可信服务器能力。只允许计数 / 布尔值，绝不接收图、OCR、描述或聊天原文；平台承担决策费用。 */
  decidePublicImage?(input: {
    userId: string;
    idempotencyKey: string;
    deadlineAt: string;
    clueCount: number;
    needsFacts: boolean;
  }): Promise<PortResult<DecideOutput, GenerateError>>;
  /** 某项平台服务是否已开通（入口显隐）。 */
  isServiceEnabled(
    service:
      'speech_synthesis' | 'speech_recognition' | 'image_generation' | 'web_search' | 'vision',
  ): Promise<boolean>;
}
