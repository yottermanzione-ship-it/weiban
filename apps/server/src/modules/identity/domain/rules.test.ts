import { describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_TTL_MS,
  APP_SESSION_TTL_MS,
  formatInviteCode,
  generateInviteCode,
  generateSessionToken,
  hashToken,
  isLocked,
  isValidTimeZone,
  LOGIN_LOCK_MS,
  nextFailureState,
  normalizeInviteCode,
  passwordWeakness,
  sessionExpiresAt,
  shouldTouchSession,
  throttleKey,
  type FailureState,
} from './rules.js';

const T0 = new Date('2026-10-05T00:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('会话期限', () => {
  it('普通会话 90 天、管理会话 12 小时', () => {
    expect(sessionExpiresAt('app', T0).getTime() - T0.getTime()).toBe(APP_SESSION_TTL_MS);
    expect(APP_SESSION_TTL_MS).toBe(90 * 24 * 3600 * 1000);
    expect(sessionExpiresAt('admin', T0).getTime() - T0.getTime()).toBe(ADMIN_SESSION_TTL_MS);
    expect(ADMIN_SESSION_TTL_MS).toBe(12 * 3600 * 1000);
  });

  it('最近使用时间最多每分钟写一次', () => {
    expect(shouldTouchSession(T0, at(59_999))).toBe(false);
    expect(shouldTouchSession(T0, at(60_000))).toBe(true);
  });

  it('令牌 256 位随机、每次不同；哈希固定 32 字节且不含原文', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^wbs_[A-Za-z0-9_-]{43}$/);
    expect(hashToken(a)).toHaveLength(32);
    expect(hashToken(a).equals(hashToken(a))).toBe(true);
    expect(hashToken(a).toString('latin1')).not.toContain(a);
  });
});

describe('登录锁定（连续 5 次失败锁 15 分钟）', () => {
  function fail(times: number, start: FailureState | null = null, stepMs = 1000) {
    let state = start;
    for (let i = 0; i < times; i += 1) state = nextFailureState(state, at(i * stepMs));
    return state as FailureState;
  }

  it('前 4 次不锁，第 5 次锁 15 分钟，到期自动解锁', () => {
    const four = fail(4);
    expect(four.failures).toBe(4);
    expect(isLocked(four, at(4000))).toBe(false);
    const five = nextFailureState(four, at(4000));
    expect(five.lockedUntil?.getTime()).toBe(at(4000).getTime() + LOGIN_LOCK_MS);
    expect(isLocked(five, at(4000 + LOGIN_LOCK_MS - 1))).toBe(true);
    expect(isLocked(five, at(4000 + LOGIN_LOCK_MS))).toBe(false);
  });

  it('锁定到期后从 0 重新计数', () => {
    const locked = fail(5);
    const after = nextFailureState(locked, at(4000 + LOGIN_LOCK_MS));
    expect(after).toMatchObject({ failures: 1, lockedUntil: null });
  });

  it('距上次失败超过 15 分钟，旧计数作废（「连续」才算）', () => {
    const four = fail(4);
    expect(nextFailureState(four, at(3000 + LOGIN_LOCK_MS)).failures).toBe(1);
  });

  it('锁定键：用户名不区分大小写；用户名和 IP 不会撞键', () => {
    expect(throttleKey('username', 'Alice').equals(throttleKey('username', 'alice'))).toBe(true);
    expect(throttleKey('username', '1.2.3.4').equals(throttleKey('ip', '1.2.3.4'))).toBe(false);
  });
});

describe('密码强度', () => {
  it('包含用户名、字符太单一、常见密码 → 弱', () => {
    expect(passwordWeakness('xxAlice_01xx', 'alice_01')).toMatch(/用户名/);
    expect(passwordWeakness('ababababab', 'someone')).toMatch(/5 个不同/);
    expect(passwordWeakness('Password123', 'someone')).toMatch(/常见/);
  });

  it('正常密码通过', () => {
    expect(passwordWeakness('correct horse battery', 'someone')).toBeNull();
  });
});

describe('邀请码', () => {
  it('16 位分 4 组，不含易混字符；输入大小写、空格、连字符都能识别', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}(-[2-9A-HJKMNP-TV-Z]{4}){3}$/);
    const normalized = normalizeInviteCode(` ${code.toLowerCase()} `);
    expect(normalized).toBe(code.replaceAll('-', ''));
    expect(formatInviteCode(normalized)).toBe(code);
  });
});

describe('时区', () => {
  it('认识 IANA 时区，不认识乱写的', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
