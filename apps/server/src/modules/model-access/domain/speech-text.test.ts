import { describe, expect, it } from 'vitest';
import { speechText } from './speech-text.js';

describe('聊天文字转读的停顿', () => {
  it('未加句号的气泡保留全部文字，分隔符变成明确停顿', () => {
    const source = '我刚到家\n先喝口水\n等会儿和你说';
    expect(speechText(source)).toBe('我刚到家。先喝口水。等会儿和你说');
    expect(speechText(source).length).toBe(source.length);
  });
  it('已有标点和引号不被覆盖，段落、数字与英文保持原义', () => {
    expect(speechText('“到家了。”\n今天 3.14 公里，\n还行吗？')).toBe(
      '“到家了。”\n今天 3.14 公里，\n还行吗？',
    );
    expect(speechText('Hello\nHow are you?')).toBe('Hello;How are you?');
    expect(speechText('你好。今晚见！')).toBe('你好。今晚见！');
  });
  it('合并空行与回车不增加文字长度，不改写无换行原文', () => {
    for (const source of ['嗯\r\n\r\n好的', '  我听着\n  慢慢说  ', '', '没有分行的一句话']) {
      expect(speechText(source).length).toBeLessThanOrEqual(source.trim().length);
      expect(speechText(source).replace(/[\p{P}\s]/gu, '')).toBe(source.replace(/[\p{P}\s]/gu, ''));
    }
  });
});
