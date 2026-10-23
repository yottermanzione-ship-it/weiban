import { describe, expect, it } from 'vitest';
import { parseDecision } from './ecology.js';

describe('ecology decision parsing', () => {
  it('parses a clean json object', () => {
    expect(parseDecision('{"action":"none","murmur":"随便想想"}')).toMatchObject({
      action: 'none',
      murmur: '随便想想',
    });
  });

  it('ignores prose and code fences around the json', () => {
    const raw =
      '好的，我决定如下：\n```json\n{"action":"moment_post","murmur":"今天风很大"}\n```\n以上。';
    expect(parseDecision(raw)).toMatchObject({ action: 'moment_post' });
  });

  it('stops at the first balanced object instead of splicing two of them', () => {
    const raw =
      '{"action":"none","murmur":"第一段"}\n{"action":"moment_post","murmur":"不该被采用"}';
    expect(parseDecision(raw)).toMatchObject({ action: 'none' });
  });

  it('tolerates trailing commas', () => {
    expect(parseDecision('{"action":"nudge","murmur":"拍拍你",}')).toMatchObject({
      action: 'nudge',
    });
  });

  it('does not treat braces inside strings as structure', () => {
    expect(parseDecision('{"action":"status","murmur":"他说了个 } 符号"}')).toMatchObject({
      action: 'status',
    });
  });

  it('returns null for unusable output instead of guessing', () => {
    expect(parseDecision('我不确定该不该发朋友圈。')).toBeNull();
    expect(parseDecision('{"action":')).toBeNull();
    expect(parseDecision('{"action":"none"}')).toBeNull();
  });
});
