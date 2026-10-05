import { describe, expect, it } from 'vitest';
import {
  checkBaseUrl,
  classifyTestStatus,
  decodeCursor,
  encodeCursor,
  formatMask,
  hasAdultContent,
  maskParts,
  normalizeApiKey,
  priceTier,
  standardReplyMicros,
  statusAfterTest,
  unavailableReason,
} from './rules.js';

describe('密钥与掩码', () => {
  it('去除首尾空白，长度不合法返回 null', () => {
    expect(normalizeApiKey('  sk-abcdefgh  ')).toBe('sk-abcdefgh');
    expect(normalizeApiKey('   short  ')).toBeNull();
    expect(normalizeApiKey('x'.repeat(513))).toBeNull();
  });

  it('长密钥前 4 后 4，短密钥缩短，至少一半看不见', () => {
    const long = 'sk-a1234567890abcdef9xQz';
    const m = maskParts(long);
    expect(formatMask(m.prefix, m.suffix)).toBe('sk-a…9xQz');
    expect(formatMask(m.prefix, m.suffix).length).toBeLessThanOrEqual(16);
    for (const key of ['abcdefgh', 'abcdefghijkl', 'abcdefghijklmno']) {
      const p = maskParts(key);
      expect((p.prefix.length + p.suffix.length) * 2).toBeLessThanOrEqual(key.length);
    }
  });
});

describe('连通测试分类', () => {
  it('状态码 → 失败类别 → 上游状态', () => {
    expect(classifyTestStatus(200)).toBeNull();
    expect(classifyTestStatus(401)).toBe('invalid_key');
    expect(classifyTestStatus(403)).toBe('invalid_key');
    expect(classifyTestStatus(402)).toBe('insufficient_balance');
    expect(classifyTestStatus(500)).toBe('provider_error');
    expect(classifyTestStatus(302)).toBe('provider_error');
    expect(statusAfterTest(null)).toBe('active');
    expect(statusAfterTest('invalid_key')).toBe('invalid');
    expect(statusAfterTest('insufficient_balance')).toBe('quota_exhausted');
    expect(statusAfterTest('network_error')).toBe('unavailable');
    expect(statusAfterTest('provider_error')).toBe('unavailable');
  });

  it('接口地址：生产只允许 https，不许带账号密码或查询串', () => {
    expect(checkBaseUrl('https://api.deepseek.com/v1/', true)).toBe('https://api.deepseek.com/v1');
    expect(checkBaseUrl('http://127.0.0.1:9/v1', true)).toBeNull();
    expect(checkBaseUrl('http://127.0.0.1:9/v1', false)).toBe('http://127.0.0.1:9/v1');
    expect(checkBaseUrl('https://user:pw@x.com/v1', false)).toBeNull();
    expect(checkBaseUrl('https://x.com/v1?key=1', false)).toBeNull();
    expect(checkBaseUrl('ftp://x.com', false)).toBeNull();
    expect(checkBaseUrl('not a url', false)).toBeNull();
  });
});

describe('可用性与无审查标记', () => {
  it('下架优先于上游故障', () => {
    expect(unavailableReason(null, 'active')).toBe('model_removed');
    expect(unavailableReason({ enabled: false, capabilities: [] }, 'active')).toBe('model_removed');
    expect(unavailableReason({ enabled: true, capabilities: [] }, 'invalid')).toBe(
      'provider_unavailable',
    );
    expect(unavailableReason({ enabled: true, capabilities: [] }, null)).toBe(
      'provider_unavailable',
    );
    expect(unavailableReason({ enabled: true, capabilities: [] }, 'active')).toBeNull();
    expect(hasAdultContent(['vision', 'adult_content'])).toBe(true);
    expect(hasAdultContent(['vision'])).toBe(false);
  });
});

describe('价格档位（cost-estimate.md 7.3 首批模型）', () => {
  // 单价：元 / 百万 token → 微元 / 百万 token
  const yuan = (v: number) => Math.round(v * 1_000_000);
  it('与 AI 负责人的估算表一致', () => {
    // 输入 2、缓存 0.04、输出 3 元/百万 → 约 0.0106 元 → 便宜
    expect(
      priceTier({
        inputPerMillionMicros: yuan(2),
        cachedInputPerMillionMicros: yuan(0.04),
        outputPerMillionMicros: yuan(3),
      }),
    ).toBe('cheap');
    // qwen3.8-max 一档：约 0.10 元 → 较贵
    expect(
      priceTier({
        inputPerMillionMicros: yuan(12),
        cachedInputPerMillionMicros: null,
        outputPerMillionMicros: yuan(48),
      }),
    ).toBe('expensive');
    // 约 0.05 元 → 中等
    expect(
      priceTier({
        inputPerMillionMicros: yuan(8),
        cachedInputPerMillionMicros: yuan(2),
        outputPerMillionMicros: yuan(16),
      }),
    ).toBe('medium');
    expect(priceTier(undefined)).toBe('medium');
  });

  it('没有缓存价时命中部分按未命中价算，向上取整', () => {
    expect(
      standardReplyMicros({
        inputPerMillionMicros: 1_000_000,
        cachedInputPerMillionMicros: null,
        outputPerMillionMicros: 1_000_000,
      }),
    ).toBe(8150);
    expect(
      standardReplyMicros({
        inputPerMillionMicros: 1,
        cachedInputPerMillionMicros: 0,
        outputPerMillionMicros: 0,
      }),
    ).toBe(1);
  });
});

describe('游标', () => {
  it('往返一致，非法游标返回 null', () => {
    const at = new Date('2026-10-05T12:00:00.000Z');
    const id = '0192f000-0000-7000-8000-000000000001';
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ createdAt: at, id });
    expect(decodeCursor('not-base64')).toBeNull();
    expect(decodeCursor(Buffer.from('["x","y"]').toString('base64url'))).toBeNull();
  });
});
