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
  MEDIA_STORAGE: z.enum(['disk', 's3']).default('disk'),
  MEDIA_DISK_ROOT: z.string().min(1).default('.data/media'),
  MEDIA_PUBLIC_BASE_URL: z
    .url()
    .refine((value) => {
      const u = new URL(value);
      return (
        ['http:', 'https:'].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    }, '必须是无认证、查询或片段的 HTTP(S) 地址')
    .default('http://127.0.0.1:3000'),
  MEDIA_S3_BUCKET: z.string().min(1).optional(),
  MEDIA_S3_REGION: z.string().min(1).default('auto'),
  MEDIA_S3_ENDPOINT: z.url().optional(),
  MEDIA_S3_CREDENTIALS_FILE: z.string().min(1).optional(),
  MEDIA_S3_FORCE_PATH_STYLE: booleanFlag,
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** 进程角色（overview.md 第 6 节）：web 只开 HTTP；worker 只跑事件分发和任务；all 两者都做。 */
  APP_ROLE: z.enum(['web', 'worker', 'all']).default('all'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * 是否信任反向代理（Caddy）转发的 X-Forwarded-For 来取客户端 IP（登录失败按 IP 锁定要用）。
   * 不设或 0 / false：不信任（直连）；正整数：信任的代理层数（Caddy 在前面一层就填 1）；
   * 其他：交给 Express 的 trust proxy（例如 loopback、172.16.0.0/12）。
   */
  HTTP_TRUST_PROXY: z.string().min(1).optional(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, '必须是 postgres:// 开头的连接串'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** 主密钥（KEK）文件路径（security-and-privacy.md 第 3 节）。生产必填；开发可不填，此时加密功能不可用。 */
  PLATFORM_KEK_FILE: z.string().min(1).optional(),
  PLATFORM_KEK_RING_FILE: z.string().min(1).optional(),
  /** 主密钥版本号；轮换主密钥时加一。 */
  PLATFORM_KEK_VERSION: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
  /** 事件分发器轮询发件箱的间隔（毫秒）。 */
  EVENTS_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(500),
  /** 开发调试：日志里打印模型请求全文。生产环境强制关闭（engineering-standards.md 第 6 节）。 */
  DEBUG_LLM_PAYLOAD: booleanFlag,
  /**
   * 平台每日总上限（按成本价，微元；billing.md 第 7 节第 2 条，紧急刹车）。生产必填（数值由运维定，D-L0-14）；
   * 开发 / 测试不填时用 DEV_PLATFORM_DAILY_CAP_MICROS。
   */
  BILLING_PLATFORM_DAILY_CAP_MICROS: z.coerce.number().int().min(0).optional(),
  /** 安全优先透支上限（微元）覆盖值；不填用 billing.md 6.6 第 2 条的默认值（运维不需要设置）。 */
  BILLING_SAFETY_OVERDRAFT_LIMIT_MICROS: z.coerce.number().int().min(0).optional(),
  /** 对账第 ③ 层：上游账单与按成本价汇总的偏差超过此比例标红（billing.md 8.2，默认 0.03 = 3%）。 */
  BILLING_UPSTREAM_DIFF_RATIO: z.coerce.number().min(0).max(10).default(0.03),
});

/** 开发 / 测试环境没配置平台每日上限时的取值：20 元。生产环境必须显式配置。 */
export const DEV_PLATFORM_DAILY_CAP_MICROS = 20_000_000;

export interface AppConfig {
  readonly media: {
    readonly driver: 'disk' | 's3';
    readonly diskRoot: string;
    readonly publicBaseUrl: string;
    readonly s3Bucket: string | null;
    readonly s3Region: string;
    readonly s3Endpoint: string | null;
    readonly s3CredentialsFile: string | null;
    readonly s3ForcePathStyle: boolean;
  };
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly role: 'web' | 'worker' | 'all';
  readonly http: {
    readonly host: string;
    readonly port: number;
    /** Express 的 trust proxy 设置；false 表示不信任代理头。 */
    readonly trustProxy: boolean | number | string;
  };
  readonly database: { readonly url: string; readonly poolMax: number };
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly crypto: {
    readonly kekFile: string | null;
    readonly kekVersion: number;
    readonly kekRingFile: string | null;
  };
  readonly events: { readonly pollIntervalMs: number };
  readonly debugLlmPayload: boolean;
  readonly billing: {
    readonly platformDailyCapMicros: number;
    /** null = 使用 billing 模块的默认值（billing.md 6.6 第 2 条）。 */
    readonly safetyOverdraftLimitMicros: number | null;
    readonly upstreamDiffRatio: number;
  };
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`服务器配置不合法：\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value === '0' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^[1-9]\d*$/.test(value)) return Number(value);
  return value;
}

/** 校验环境变量并转成 AppConfig。只报变量名和原因，不回显值。 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  let resolved = env;
  if (!env['DATABASE_URL'] && env['DATABASE_URL_FILE']) {
    try {
      resolved = { ...env, DATABASE_URL: readFileSync(env['DATABASE_URL_FILE'], 'utf8').trim() };
    } catch {
      throw new ConfigError(['DATABASE_URL_FILE：数据库连接秘密文件不可读取']);
    }
  }
  const parsed = EnvSchema.safeParse(resolved);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(根)'}：${issue.message}`),
    );
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  if (production && !e.PLATFORM_KEK_FILE && !e.PLATFORM_KEK_RING_FILE) {
    throw new ConfigError(['PLATFORM_KEK_FILE：生产环境必须配置主密钥文件']);
  }
  if (production && e.BILLING_PLATFORM_DAILY_CAP_MICROS === undefined) {
    throw new ConfigError(['BILLING_PLATFORM_DAILY_CAP_MICROS：生产环境必须配置平台每日总上限']);
  }
  if (e.MEDIA_STORAGE === 's3' && (!e.MEDIA_S3_BUCKET || !e.MEDIA_S3_CREDENTIALS_FILE)) {
    throw new ConfigError([
      'MEDIA_S3_BUCKET / MEDIA_S3_CREDENTIALS_FILE：S3 存储必须配置桶和凭据文件',
    ]);
  }
  if (
    production &&
    !e.MEDIA_PUBLIC_BASE_URL.startsWith('https://') &&
    env['MEDIA_PUBLIC_BASE_URL']
  ) {
    throw new ConfigError(['MEDIA_PUBLIC_BASE_URL：生产环境必须使用 HTTPS']);
  }
  return {
    media: {
      driver: e.MEDIA_STORAGE,
      diskRoot: e.MEDIA_DISK_ROOT,
      publicBaseUrl: e.MEDIA_PUBLIC_BASE_URL,
      s3Bucket: e.MEDIA_S3_BUCKET ?? null,
      s3Region: e.MEDIA_S3_REGION,
      s3Endpoint: e.MEDIA_S3_ENDPOINT ?? null,
      s3CredentialsFile: e.MEDIA_S3_CREDENTIALS_FILE ?? null,
      s3ForcePathStyle: e.MEDIA_S3_FORCE_PATH_STYLE,
    },
    nodeEnv: e.NODE_ENV,
    role: e.APP_ROLE,
    http: { host: e.HOST, port: e.PORT, trustProxy: parseTrustProxy(e.HTTP_TRUST_PROXY) },
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    logLevel: e.LOG_LEVEL,
    crypto: {
      kekFile: e.PLATFORM_KEK_FILE ?? null,
      kekVersion: e.PLATFORM_KEK_VERSION,
      kekRingFile: e.PLATFORM_KEK_RING_FILE ?? null,
    },
    events: { pollIntervalMs: e.EVENTS_POLL_INTERVAL_MS },
    // 生产环境无论怎么配置都关闭
    debugLlmPayload: production ? false : e.DEBUG_LLM_PAYLOAD,
    billing: {
      platformDailyCapMicros: e.BILLING_PLATFORM_DAILY_CAP_MICROS ?? DEV_PLATFORM_DAILY_CAP_MICROS,
      safetyOverdraftLimitMicros: e.BILLING_SAFETY_OVERDRAFT_LIMIT_MICROS ?? null,
      upstreamDiffRatio: e.BILLING_UPSTREAM_DIFF_RATIO,
    },
  };
}

/** 读主密钥文件：内容为 32 字节的 base64（44 个字符）或十六进制（64 个字符），首尾空白忽略。 */
export function readKekFile(path: string): Buffer {
  const text = readFileSync(path, 'utf8').trim();
  const key = /^[0-9a-fA-F]{64}$/.test(text)
    ? Buffer.from(text, 'hex')
    : Buffer.from(text, 'base64');
  if (key.length !== 32) {
    throw new ConfigError([
      `PLATFORM_KEK_FILE：主密钥必须是 32 字节（base64 或十六进制），实际 ${key.length} 字节`,
    ]);
  }
  return key;
}
