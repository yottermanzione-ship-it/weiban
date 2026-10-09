/**
 * 服务器模块的分层与数据库 schema 对照表 —— 模块边界规则 R1～R10 的数据来源。
 *
 * 这份表是 ADR-0004 第 3 节（分层图）和 docs/architecture/overview.md 第 4 节（schema 名）
 * 在代码里的映射。规则内容由架构负责人定，本文件由运维负责人维护：
 * 文档改了分层或新增模块，就同步改这里（并补一条测试）。
 */

/** 层级从低到高。下层永远不能 import 上层（R2）。数字越大层级越高。 */
export const LAYER_RANK = {
  platform: 0, // apps/server/src/platform：平台内核，所有模块都可使用
  lower: 1, // 底层（基础）
  middle: 2, // 中层（领域）
  upper: 3, // 上层（玩法与智能）
  composition: 4, // main.ts、app.module.ts：唯一允许装配所有模块的地方
};

/**
 * 模块目录名 → 所在层级与自己的 PostgreSQL schema。
 * schema 为 null 表示该模块没有自己的表（policy 只写 platform.audit_log，经平台内核写入）。
 * library 在 ADR-0004 分层图中未列出，暂按「上层」处理（待架构负责人确认）。
 */
export const SERVER_MODULES = {
  identity: { layer: 'lower', schema: 'identity' },
  realtime: { layer: 'lower', schema: 'realtime' },
  push: { layer: 'lower', schema: 'push' },
  media: { layer: 'lower', schema: 'media' },
  chat: { layer: 'middle', schema: 'chat' },
  contacts: { layer: 'middle', schema: 'contacts' },
  characters: { layer: 'middle', schema: 'characters' },
  'model-access': { layer: 'middle', schema: 'model_access' },
  billing: { layer: 'middle', schema: 'billing' },
  policy: { layer: 'middle', schema: null },
  health: { layer: 'middle', schema: 'health' },
  'ai-runtime': { layer: 'upper', schema: 'ai_runtime' },
  proactive: { layer: 'upper', schema: 'proactive' },
  moments: { layer: 'upper', schema: 'moments' },
  growth: { layer: 'upper', schema: 'growth' },
  importer: { layer: 'upper', schema: 'importer' },
  library: { layer: 'upper', schema: 'library' },
};

/** 不属于任何业务模块、业务模块也不能直接读写的 schema（R8）。 */
export const NON_MODULE_SCHEMAS = ['platform', 'pgboss'];

/** R4：只有 model-access 模块能用的模型供应商 SDK 和接口域名。 */
export const MODEL_PROVIDER_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  '@google/genai',
  '@google/generative-ai',
  '@mistralai/mistralai',
  'groq-sdk',
  'cohere-ai',
  'ollama',
  'ai',
  '@ai-sdk/*',
  '@openrouter/*',
  '@langchain/*',
  'langchain',
  '@aws-sdk/client-bedrock-runtime',
  '@alicloud/*',
  '@volcengine/*',
  'zhipuai',
  'dashscope',
];

export const MODEL_PROVIDER_DOMAINS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.deepseek.com',
  'dashscope.aliyuncs.com',
  'ark.cn-beijing.volces.com',
  'api.moonshot.cn',
  'open.bigmodel.cn',
  'api.minimax.chat',
  'api.minimaxi.com',
  'openrouter.ai',
  'api.mistral.ai',
  'api.groq.com',
];

/** R5：只有 push 模块能用的推送 SDK。 */
export const PUSH_PROVIDER_PACKAGES = [
  'web-push',
  'firebase-admin',
  'firebase-admin/*',
  '@parse/node-apn',
  'apn',
  'node-pushnotifications',
  'jpush-async',
  'jpush-sdk',
  'getui-rest-sdk',
  '@getui/*',
];
