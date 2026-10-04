/**
 * identity 的纯规则：会话期限、登录锁定、密码强度、邀请码格式、时区校验、令牌生成与哈希。
 * 数字来源：docs/architecture/security-and-privacy.md 第 2 节（不是 PRD 的 P-xx 产品参数，所以不放 product-params.ts）。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 普通会话：90 天内有使用就自动续期（滑动过期）。security-and-privacy.md 第 2 节「会话令牌」。 */
export const APP_SESSION_TTL_MS = 90 * DAY_MS;
/** 管理会话：12 小时过期，不续期。security-and-privacy.md 第 2 节「管理员」。 */
export const ADMIN_SESSION_TTL_MS = 12 * HOUR_MS;
/** 会话「最近使用时间」最多每分钟写一次库（减少写入；续期精度够用）。 */
export const SESSION_TOUCH_INTERVAL_MS = MINUTE_MS;

/** 同一用户名或同一 IP 连续 5 次失败，锁定 15 分钟。security-and-privacy.md 第 2 节「防暴力破解」。 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * MINUTE_MS;

// ---------- 会话 ----------

/** 新会话的过期时间。 */
export function sessionExpiresAt(kind: 'app' | 'admin', now: Date): Date {
  return new Date(now.getTime() + (kind === 'admin' ? ADMIN_SESSION_TTL_MS : APP_SESSION_TTL_MS));
}

/** 使用会话时是否需要写库（更新最近使用时间；普通会话同时续期）。 */
export function shouldTouchSession(lastActiveAt: Date, now: Date): boolean {
  return now.getTime() - lastActiveAt.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}

/** 生成会话令牌原文：wbs_ + 256 位随机数（base64url）。原文只在登录 / 注册响应里出现一次。 */
export function generateSessionToken(): string {
  return `wbs_${randomBytes(32).toString('base64url')}`;
}

/** 令牌哈希：数据库只存 SHA-256，不存原文（ADR-0006）。 */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

// ---------- 登录锁定 ----------

export interface FailureState {
  failures: number;
  lastFailedAt: Date;
  lockedUntil: Date | null;
}

/** 是否处于锁定中。 */
export function isLocked(state: FailureState | null, now: Date): boolean {
  return !!state?.lockedUntil && state.lockedUntil.getTime() > now.getTime();
}

/**
 * 记一次失败后的新状态。「连续」失败：距上次失败超过锁定时长的旧计数作废；锁定到期后从 0 重新计数。
 * 第 5 次失败时锁定 15 分钟，计数清零。
 */
export function nextFailureState(state: FailureState | null, now: Date): FailureState {
  const stale =
    !state ||
    now.getTime() - state.lastFailedAt.getTime() >= LOGIN_LOCK_MS ||
    (state.lockedUntil !== null && state.lockedUntil.getTime() <= now.getTime());
  const failures = (stale ? 0 : state.failures) + 1;
  if (failures >= LOGIN_MAX_FAILURES) {
    return { failures: 0, lastFailedAt: now, lockedUntil: new Date(now.getTime() + LOGIN_LOCK_MS) };
  }
  return { failures, lastFailedAt: now, lockedUntil: null };
}

/** 锁定记录的键：用户名（不区分大小写）或 IP，存哈希，库里不留 IP 原文。 */
export function throttleKey(kind: 'username' | 'ip', value: string): Buffer {
  const normalized = kind === 'username' ? value.toLowerCase() : value;
  return createHash('sha256').update(`${kind}:${normalized}`, 'utf8').digest();
}

// ---------- 密码强度 ----------

const COMMON_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  '12345678910',
  'qwertyuiop',
  'password123',
  'password1234',
  'iloveyou123',
  'abcdefghij',
  'abc1234567',
  'qwerty123456',
  'aaaaaaaaaa',
  '1qaz2wsx3edc',
  'woaini1314',
  'woaini520',
]);

/**
 * 契约已保证长度 10–128；这里再拦住明显弱的密码（返回 password_too_weak）：
 * 包含用户名、不同字符少于 5 个、常见弱密码。
 */
export function passwordWeakness(password: string, username: string): string | null {
  const lower = password.toLowerCase();
  if (lower.includes(username.toLowerCase())) return '密码不能包含用户名';
  if (new Set(password).size < 5) return '密码太简单：至少要有 5 个不同的字符';
  if (COMMON_PASSWORDS.has(lower)) return '密码太常见，请换一个';
  return null;
}

// ---------- 邀请码 ----------

/** 数字和大写字母去掉容易看错的 0 O 1 I L U，共 30 个字符。 */
const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const INVITE_LENGTH = 16;

/** 生成邀请码：16 位（约 78 位随机），展示为 XXXX-XXXX-XXXX-XXXX。 */
export function generateInviteCode(): string {
  let raw = '';
  for (let i = 0; i < INVITE_LENGTH; i += 1) raw += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return formatInviteCode(raw);
}

/** 输入归一化：去掉空格和连字符、转大写。库里存归一化后的值。 */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function formatInviteCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

// ---------- 时区 ----------

/** 是否是运行环境认识的 IANA 时区名。 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
