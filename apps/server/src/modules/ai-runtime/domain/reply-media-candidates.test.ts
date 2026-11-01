import { describe, expect, it } from 'vitest';
import { selectReplySticker, voiceSpacingOk } from './reply-media-candidates.js';

describe('完整标签选图：有标签以标签为准，没标签退回 description 含义', () => {
  it('description 是「表情 N」但标签完整时，照标签选', () => {
    const tagged = {
      stickerId: 't1',
      mediaId: 'm1',
      description: '表情 12',
      tags: ['朋友很开心时用的表情，图里写着“太棒了”，适合庆祝场合'],
    };
    expect(selectReplySticker([tagged], '哈哈，太开心了', '', 0.1)?.sticker.stickerId).toBe('t1');
  });
  it('标签与回复不合时不选，不随机兜底', () => {
    const tagged = {
      stickerId: 't1',
      mediaId: 'm1',
      description: '表情 12',
      tags: ['安慰人的抱抱，适合对方难过时用'],
    };
    expect(selectReplySticker([tagged], '哈哈，太开心了', '', 0.1)).toBeNull();
  });
  it('没标签时数字说明一律排除', () => {
    expect(
      selectReplySticker(
        [{ stickerId: 't1', mediaId: 'm1', description: '开心鸭 038' }],
        '哈哈，开心',
        '',
        0.1,
      ),
    ).toBeNull();
  });
});

describe('语音间距：上次语音后至少 5 条文字', () => {
  it('从没发过语音不受限；5 条文字后可发；不足 5 条不行', () => {
    expect(voiceSpacingOk(['text', 'text'])).toBe(true);
    expect(voiceSpacingOk(['text', 'text', 'text', 'text', 'text', 'voice'])).toBe(true);
    expect(voiceSpacingOk(['text', 'text', 'text', 'voice'])).toBe(false);
    expect(voiceSpacingOk(['voice'])).toBe(false);
  });
  it('只数最近一条语音之后的文字（更早的语音不算）', () => {
    expect(voiceSpacingOk(['text', 'text', 'text', 'text', 'text', 'voice', 'text', 'voice'])).toBe(
      true,
    );
  });
});
