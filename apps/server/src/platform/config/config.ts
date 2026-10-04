/**
 * 运行配置：从环境变量读取并校验（engineering-standards.md 第 1 节第 5 条：外部输入必须校验）。
 * 配置不合法时服务器拒绝启动，并列出出错的变量名（不打印变量的值，避免把密码打进日志）。
 *
 * 环境变量只在这里读取；其他代码通过注入令牌 APP_CONFIG 拿到校验后的 AppConfig。
 * 产品参数（PRD 第 5 节 P-xx）不在这里，在 product-params.ts。
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const APP_CONFIG = Symbol('weiban.platform.config');

const booleanFlag = z
  .enum(['0', '1', 'true', 'false'])
  .optional()
  .transform((value) => value === '1' || value === 'true');

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** 进程角色（overview.md 第 6 节）：web 只开 HTTP；worker 只跑事件分发和任务；all 两者都做。 */
  APP_ROLE: z.enum(['web', 'worker', 'all']).default('all'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, '必须是 postgres:// 开头的连接串'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** 主密钥（KEK）文件路径（security-and-privacy.md 第 3 节）。生产必填；开发可不填，此时加密功能不可用。 */
  PLATFORM_KEK_FILE: z.string().min(1).optional(),
  /** 主密钥版本号；轮换主密钥时加一。 */
  PLATFORM_KEK_VERSION: z.coerce.number().int().min(1).default(1),
  /** 事件分发器轮询发件箱的间隔（毫秒）。 */
  EVENTS_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(500),
  /** 开发调试：日志里打印模型请求全文。生产环境强制关闭（engineering-standards.md 第 6 节）。 */
  DEBUG_LLM_PAYLOAD: booleanFlag,
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly role: 'web' | 'worker' | 'all';
  readonly http: { readonly host: string; readonly port: number };
  readonly database: { readonly url: string; readonly poolMax: number };
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly crypto: { readonly kekFile: string | null; readonly kekVersion: number };
  readonly events: { readonly pollIntervalMs: number };
  readonly debugLlmPayload: boolean;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`服务器配置不合法：\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

/** 校验环境变量并转成 AppConfig。只报变量名和原因，不回显值。 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(根)'}：${issue.message}`),
    );
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  if (production && !e.PLATFORM_KEK_FILE) {
    throw new ConfigError(['PLATFORM_KEK_FILE：生产环境必须配置主密钥文件']);
  }
  return {
    nodeEnv: e.NODE_ENV,
    role: e.APP_ROLE,
    http: { host: e.HOST, port: e.PORT },
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    logLevel: e.LOG_LEVEL,
    crypto: { kekFile: e.PLATFORM_KEK_FILE ?? null, kekVersion: e.PLATFORM_KEK_VERSION },
    events: { pollIntervalMs: e.EVENTS_POLL_INTERVAL_MS },
    // 生产环境无论怎么配置都关闭
    debugLlmPayload: production ? false : e.DEBUG_LLM_PAYLOAD,
  };
}

/** 读主密钥文件：内容为 32 字节的 base64（44 个字符）或十六进制（64 个字符），首尾空白忽略。 */
export function readKekFile(path: string): Buffer {
  const text = readFileSync(path, 'utf8').trim();
  const key = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (key.length !== 32) {
    throw new ConfigError([`PLATFORM_KEK_FILE：主密钥必须是 32 字节（base64 或十六进制），实际 ${key.length} 字节`]);
  }
  return key;
}
