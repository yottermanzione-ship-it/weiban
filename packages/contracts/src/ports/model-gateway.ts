/**
 * 模型网关端口。提供方：model-access。全系统调用模型供应商的唯一出口（engineering-standards R4）。
 * 网关统一负责：选模型（按 modelRole 与角色覆盖）、解密密钥、预算检查、policy 二次检查（成人生成）、
 * 重试与错误分类（message-reliability.md 第 6 节）、用量记账、日志消毒。
 *
 * 请求 / 响应的消息结构是 v0 草案：AI 系统负责人在 T-005 / D-L0-09 中可提出变更申请调整
 * （例如工具调用、流式输出、多模态内容），由架构负责人批准后修改本文件。
 */
import { z } from 'zod';
import type { ModelRole } from '../http/model-access.js';
import type { PortResult } from './common.js';

/** 调用用途：用于用量页分类（MDL-05）和预算判断。新增用途属于次版本变更。 */
export const ModelPurpose = z.enum([
  'chat_reply', // 私聊 / 群聊回复（含首条问候、恢复后合并回复）
  'safety_check', // 安全关怀识别
  'memory', // 记忆提取与长对话整理
  'simulation', // 推演日常、近期主线
  'proactive', // 主动消息生成
  'moments', // 朋友圈生成与互动
  'vision', // 识图
  'voice', // 语音合成 / 识别 / 通话
  'image_generation', // 角色发图
  'web_search', // 联网搜索
  'import_analysis', // 导入聊天记录生成草稿
  'connectivity_test', // 保存密钥时的连通测试
  'admin_distill', // 管理员：蒸馏公开资料生成角色草稿
  'admin_persona_check', // 管理员：人设稳定检查
  'admin_public_update_search', // 管理员：公开动态候选搜索
]);
export type ModelPurpose = z.infer<typeof ModelPurpose>;

/** 属于「后台功能」的用途：受用户后台每日预算约束（MDL-05 第 2 条）；聊天回复不受约束。 */
export const BACKGROUND_PURPOSES: readonly ModelPurpose[] = [
  'memory',
  'simulation',
  'proactive',
  'moments',
  'import_analysis',
];

/** 计费归属：user = 用户自己的密钥；platform = 管理员配置的平台密钥（prd-answers.md 第 4 节）。 */
export const BillingOwner = z.enum(['user', 'platform']);
export type BillingOwner = z.infer<typeof BillingOwner>;

export interface ChatMessageForModel {
  role: 'system' | 'user' | 'assistant';
  /** v0 只支持纯文本；多模态由 AI 负责人提出扩展。 */
  content: string;
}

export interface GenerateTextInput {
  /** 计费与用量归属的用户；billingOwner = platform 时为发起操作的管理员。 */
  userId: string;
  purpose: ModelPurpose;
  billingOwner: BillingOwner;
  /** 用哪一类模型；网关按用户的选择解析出具体模型（后台未设置时沿用聊天模型）。 */
  modelRole: ModelRole;
  /** 涉及具体角色时必填：用于角色模型覆盖（MDL-02 第 2 条）和 policy 检查。 */
  characterId?: string;
  /** 涉及具体会话时必填：成人生成时网关会检查会话类型与资格。 */
  conversationId?: string;
  messages: ChatMessageForModel[];
  maxOutputTokens?: number;
  temperature?: number;
  /** 要求模型输出 JSON 时提供（网关不解释 schema，只透传给支持的供应商）。 */
  responseFormat?: 'text' | 'json';
  /** 幂等键：同一键在 24 小时内重复调用，返回第一次的结果而不再次计费。 */
  idempotencyKey: string;
}

export interface GenerateTextOutput {
  text: string;
  providerId: string;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number; estimatedCostCny: number | null };
  latencyMs: number;
  usageRecordId: string;
}

export type GenerateError =
  | 'not_configured' // 用户还没有配置对应模型
  | 'invalid_key'
  | 'quota_exhausted'
  | 'provider_unavailable' // 重试后仍失败
  | 'budget_exceeded' // 后台预算或平台预算用完
  | 'capability_missing' // 所选模型不具备所需能力（如识图）
  | 'policy_denied' // 硬性边界拒绝（如为无资格角色做成人生成）
  | 'bad_request';

export interface ModelGatewayPort {
  generateText(input: GenerateTextInput): Promise<PortResult<GenerateTextOutput, GenerateError>>;
  /** 低成本探测某把密钥是否已恢复（MDL-04 恢复检查），成功时网关会发布 credential_status_changed。 */
  probeCredential(userId: string, credentialId: string): Promise<'active' | 'invalid' | 'quota_exhausted' | 'provider_unavailable'>;
}
