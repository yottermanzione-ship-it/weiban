/**
 * 日志脱敏（security-and-privacy.md 第 4 节第 2 道防线）。
 * 第 1 道防线是「源头不写」：写日志时就不要传密钥、令牌、密码、聊天正文等，这里只是兜底。
 *
 * 两种打码：
 * 1. 按字段名：字段名像密钥 / 令牌 / 密码 / 正文的，整个值换成 [REDACTED]；
 * 2. 按内容：任何字符串里出现常见密钥形态（sk- 开头的长串、Bearer 令牌、连续 32 位以上字母数字），只把那一段换掉。
 */

export const REDACTED = '[REDACTED]';

/** 字段名规范化（小写、去掉 _ 和 -）后，命中即整值打码。 */
const SENSITIVE_KEY_EXACT = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'xapikey',
  'password',
  'passwd',
  'passphrase',
  'content',
  'text',
  'prompt',
  'messages',
  'kek',
  'dek',
  'plaintext',
  'privatekey',
  'credential',
  'credentials',
]);
const SENSITIVE_KEY_PATTERNS = [/^secret/, /secret$/, /^token/, /token$/, /password/];

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  return (
    SENSITIVE_KEY_EXACT.has(normalized) ||
    SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

/** 按内容打码的规则。顺序有意义：先处理带前缀的形态，再处理泛化的长串。 */
const VALUE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\bsk-[A-Za-z0-9_-]{6,}/g, REDACTED],
  [/[A-Za-z0-9]{32,}/g, REDACTED],
];

/** 对一段文本做按内容打码。 */
export function redactString(text: string): string {
  let result = text;
  for (const [pattern, replacement] of VALUE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

const MAX_DEPTH = 8;

/**
 * 深度复制并打码任意值，返回可以安全写进日志的结构。
 * Error 转成 { type, message, stack }（都打码）；Buffer 等二进制一律不输出内容。
 */
export function sanitize(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? String(value) : value;
  }
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      type: value.name,
      message: redactString(value.message),
    };
    if (value.stack) out.stack = redactString(value.stack);
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') out.code = code;
    if (value.cause !== undefined) out.cause = walk(value.cause, depth + 1, seen);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return '[Binary]';
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, seen));
  if (value instanceof Map) {
    return walk(Object.fromEntries(value), depth, seen);
  }

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : walk(inner, depth + 1, seen);
  }
  return out;
}
