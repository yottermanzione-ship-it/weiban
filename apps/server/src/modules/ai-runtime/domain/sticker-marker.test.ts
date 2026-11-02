import { describe, expect, it } from 'vitest';
import { moodFromLabel, stickerPromptText, takeStickerMarker } from './sticker-marker.js';

describe('T-20261103d 表情标记：从正文剥掉并取出情绪', () => {
  it('正文最后单独一行的标记整行去掉，情绪按中文名对上主标签', () => {
    expect(takeStickerMarker('哈哈，考过了！\n真替你高兴\n[表情:开心]')).toEqual({
      text: '哈哈，考过了！\n真替你高兴',
      mood: 'happy',
    });
  });
  it('全角括号、中文冒号、「表情包」写法、句中标记都剥掉，正文不残留', () => {
    expect(takeStickerMarker('晚安啦【表情：晚安】')).toEqual({
      text: '晚安啦',
      mood: 'goodnight',
    });
    expect(takeStickerMarker('辛苦了 ［表情包:谢谢］ 早点休息')).toEqual({
      text: '辛苦了 早点休息',
      mood: 'thanks',
    });
    expect(takeStickerMarker('好呀\n[sticker:agreement]')).toEqual({
      text: '好呀',
      mood: 'agreement',
    });
  });
  it('清单外的情绪、没写情绪的标记：只剥掉，不发表情，也不报错', () => {
    expect(takeStickerMarker('哼\n[表情:生气]')).toEqual({ text: '哼', mood: null });
    expect(takeStickerMarker('嗯嗯\n[表情]')).toEqual({ text: '嗯嗯', mood: null });
  });
  it('照着聊天记录学写的「[你发了一个表情包：…]」也剥掉', () => {
    const out = takeStickerMarker('抱抱你\n[你发了一个表情包：表情 12]');
    expect(out.text).toBe('抱抱你');
    expect(out.text).not.toContain('表情');
  });
  it('多个标记取最后一个有效的情绪', () => {
    expect(takeStickerMarker('[表情:开心]哈哈\n[表情:喜欢]').mood).toBe('affection');
  });
  it('没有标记时一个字不改', () => {
    const raw = '  今天也辛苦啦\n\n明天见  ';
    expect(takeStickerMarker(raw)).toEqual({ text: raw, mood: null });
  });
  it('正文只剩标记时补一句很短的话，绝不发空；没有有效情绪时返回空串交给上游兜底', () => {
    expect(takeStickerMarker('[表情:晚安]')).toEqual({ text: '晚安', mood: 'goodnight' });
    expect(takeStickerMarker('[表情:生气]')).toEqual({ text: '', mood: null });
  });
  it('情绪名：中文名、英文主标签、常见近义词都认，清单外不认', () => {
    expect(moodFromLabel('安慰')).toBe('comfort');
    expect(moodFromLabel(' 抱抱 ')).toBe('comfort');
    expect(moodFromLabel('「再见」')).toBe('farewell');
    expect(moodFromLabel('Tired')).toBe('tired');
    expect(moodFromLabel('惊讶')).toBeNull();
  });
});

describe('T-20261103d 提示词里的表情包说明', () => {
  it('只列给出的情绪，按固定顺序写中文名，并说明标记写法与「不用每轮都配」', () => {
    const text = stickerPromptText({
      moods: ['goodnight', 'happy', 'comfort'],
      nudge: false,
      serious: false,
    });
    expect(text).toContain('情绪只能从这几个里选一个：开心、安慰、晚安。');
    expect(text).toContain('[表情:情绪]');
    expect(text).toContain('不用每轮都配');
    expect(text).not.toContain('好几条没配');
  });
  it('保底：连续多条没配时提醒一句；严肃场景只允许安慰', () => {
    expect(stickerPromptText({ moods: ['happy'], nudge: true, serious: false })).toContain(
      '你已经连着好几条没配表情了',
    );
    expect(stickerPromptText({ moods: ['comfort'], nudge: false, serious: true })).toContain(
      '只能配安慰类的表情',
    );
  });
  it('没有可用情绪时不给说明', () => {
    expect(stickerPromptText({ moods: [], nudge: true, serious: false })).toBe('');
  });
});
