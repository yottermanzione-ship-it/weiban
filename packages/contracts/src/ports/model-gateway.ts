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
import type { ModelRole } from '../http/model-access.js';
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
 * 不受用户后台每日上限约束、但仍从余额扣费的用途（安全优先）。对它们传 countAsBackground 无效。
 * v1.1：加入 safety_followup（AI 负责人变更申请第 12 条，T-020 批准）。
 */
export const BUDGET_EXEMPT_PURPOSES: readonly ModelPurpose[] = ['safety_check', 'safety_followup'];

/**
 * 可以使用「安全优先透支」的用途（PRD MDL-10 第 6 条、pm-rulings-2 B4，billing.md 6.6 节）。
 * 只有 GenerateTextInput.safetyPriority = true、用途在此列表、billingOwner = user 三者同时满足时才生效；
 * 其他组合带 safetyPriority = true 一律返回 bad_request。
 */
export const SAFETY_OVERDRAFT_PURPOSES: readonly ModelPurpose[] = [
  'chat_reply',
  'safety_check',
  'safety_followup',
];

/** 计费账户：user = 用户钱包；platform = 平台账户（只用于 admin_* 用途）。 */
export const BillingOwner = z.enum(['user', 'platform']);
export type BillingOwner = z.infer<typeof BillingOwner>;

export interface ChatMessageForModel {
  role: 'system' | 'user' | 'assistant';
  /** v0 只支持纯文本；多模态由 AI 负责人提出扩展。 */
  content: string;
}

export interface GenerateTextInput {
  /** 发起调用的用户；billingOwner = platform 时为发起操作的管理员。 */
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
  /** 最大输出 token；不传时网关按用途取默认值。冻结金额按它估算。 */
  maxOutputTokens?: number;
  /** 可选调用方绝对截止时间（ISO），预算包含网关重试；AI用它保证首气泡期限。 */
  deadlineAt?: string;
  temperature?: number;
  /** 要求模型输出 JSON 时提供（网关不解释 schema，只透传给支持的上游）。 */
  responseFormat?: 'text' | 'json';
  /** 幂等键：同一键在 24 小时内重复调用，返回第一次的结果，不再冻结、不再扣费。 */
  idempotencyKey: string;
  /**
   * 安全优先（v1.1，billing.md 6.6 节）：只有 ai-runtime 在安全关怀规则预筛命中高危信号（SAFE-06）时可以传 true。
   * 效果：可用余额不足时允许透支到单独的小额上限；不突破平台每日总上限；每次实际透支写审计日志。
   */
  safetyPriority?: boolean;
  /**
   * 按「后台功能」计入用户后台每日上限（v1.1，billing.md 第 7 节第 1 条）。用于用途本身不在
   * BACKGROUND_PURPOSES、但这次是系统主动发起的调用，例如为主动行为做的行为规划（PLAN-03）、朋友圈配图。
   * 只能让调用更受限：BACKGROUND_PURPOSES 中的用途不传也照样计入；BUDGET_EXEMPT_PURPOSES 中的用途忽略此项。
   */
  countAsBackground?: boolean;
  /**
   * 记入用量记录，追查「变脸」用（AI 负责人申请，T-009 批准）。
   * v1.1：conversationKind（私聊 / 群聊）供管理后台用量明细显示（ADM-08）。
   */
  meta?: {
    personaVersion?: number;
    promptTemplateVersion?: string;
    scenarioMode?: string;
    conversationKind?: 'direct' | 'group';
  };
}

export interface GenerateTextOutput {
  text: string;
  modelKey: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
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

/** 模型故障提醒的只读受影响用户筛选；仅检查选择/默认/覆盖及当前故障，不调用上游。 */
export interface ModelNotificationReadPort {
  affectedUsers(
    userIds: readonly string[],
    modelKey: string,
    tx?: import('./common.js').Tx,
    previousDefaultFor?: readonly ('chat' | 'background' | 'vision')[],
  ): Promise<string[]>;
}
