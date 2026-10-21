import { expect, it } from 'vitest';
import {
  digestBackoffMs,
  digestIsClean,
  digestMemoryText,
  digestPermanentError,
  digestWaitError,
  parseDigest,
} from './private-digest.js';

it('解析私密模型的整理输出：容忍前后多余文字，格式不对返回 null', () => {
  expect(parseDigest(JSON.stringify({ summary: '  他们很亲密，\n约好周末见。 ' }))).toBe(
    '他们很亲密， 约好周末见。',
  );
  expect(parseDigest('好的：{"summary":"有过亲密行为"} 以上')).toBe('有过亲密行为');
  expect(parseDigest('{"summary":""}')).toBe('');
  expect(parseDigest('不是 JSON')).toBeNull();
  expect(parseDigest('{"text":"x"}')).toBeNull();
});

it('干净检查：概括说法放行，露骨描写拦下', () => {
  expect(digestIsClean('用户和角色在私密模式里很亲密，有过亲密行为，约好下次见面。')).toBe(true);
  expect(digestIsClean('两人亲热了一晚')).toBe(true);
  for (const bad of ['他们做爱了', '描写了胸部', '她呻吟着', '脱光衣服', '抚摸她的身体'])
    expect(digestIsClean(bad)).toBe(false);
});

it('重试节奏与错误分类', () => {
  expect(digestBackoffMs(1)).toBe(5 * 60_000);
  expect(digestBackoffMs(2)).toBe(30 * 60_000);
  expect(digestBackoffMs(99)).toBe(12 * 3600_000);
  expect(digestPermanentError('policy_denied')).toBe(true);
  expect(digestPermanentError('provider_unavailable')).toBe(false);
  expect(digestWaitError('insufficient_balance')).toBe(true);
  expect(digestWaitError('provider_unavailable')).toBe(false);
});

it('写入记忆的正文带来源说明并截断', () => {
  const text = digestMemoryText('很'.repeat(500));
  expect(text.startsWith('（私密模式期间的经历整理）')).toBe(true);
  expect(text.length).toBeLessThanOrEqual('（私密模式期间的经历整理）'.length + 300);
});
