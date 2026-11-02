import { describe, expect, it } from 'vitest';
import {
  availableStickerMoods,
  pickStickerForMood,
  replyTone,
  textMoods,
  voiceSpacingOk,
} from './reply-media-candidates.js';

/** 回填后的标签行拼成的 tags：第一项是主标签，其后是完整意思。 */
const labelled = (stickerId: string, primary: string, ...meaning: string[]) => ({
  stickerId,
  mediaId: `${stickerId}-media`,
  description: '表情 12',
  tags: [primary, ...meaning],
});

describe('T-20261103d 按情绪挑图：主标签匹配，回复内容决定挑哪一张', () => {
  it('只在主标签匹配的图里挑；description 是「表情 N」也照标签用', () => {
    const list = [
      labelled('hug', 'comfort', '小熊抱抱', '适合对方难过时安慰'),
      labelled('laugh', 'happy', '小猫捧腹大笑', '适合朋友讲笑话时'),
    ];
    expect(pickStickerForMood(list, 'happy', '哈哈', 0.1)?.stickerId).toBe('laugh');
    expect(pickStickerForMood(list, 'comfort', '别难过', 0.1)?.stickerId).toBe('hug');
    expect(pickStickerForMood(list, 'goodnight', '晚安', 0.1)).toBeNull();
  });
  it('同一情绪里按回复和使用意思、适合场合的本地相似度挑最贴切的', () => {
    const list = [
      labelled('a', 'happy', '小狗转圈', '适合收到礼物时表达开心'),
      labelled('b', 'happy', '小猫举着奖杯', '图里写着考试通过', '适合考试通过、拿到好成绩时庆祝'),
      labelled('c', 'happy', '兔子跳舞', '适合周末出去玩时'),
    ];
    for (const seed of [0, 0.5, 0.99])
      expect(pickStickerForMood(list, 'happy', '恭喜你考试通过！成绩真好', seed)?.stickerId).toBe(
        'b',
      );
  });
  it('都不沾边时在全部同情绪图里按 seed 轮换，不总是同一张', () => {
    const list = [labelled('a', 'happy', '甲'), labelled('b', 'happy', '乙')];
    const picked = new Set(
      [0, 0.6].map((seed) => pickStickerForMood(list, 'happy', '嗯', seed)?.stickerId),
    );
    expect(picked).toEqual(new Set(['a', 'b']));
  });
  it('20 条内发过的不重复；主标签不在 10 个之内的图不参与', () => {
    const list = [labelled('used', 'happy', '大笑'), labelled('odd', 'angry', '生气')];
    expect(pickStickerForMood(list, 'happy', '哈哈', 0.1, new Set(['used']))).toBeNull();
    expect(availableStickerMoods(list)).toEqual(['happy']);
  });
  it('严肃场景只允许安慰；没标签的旧图写着别的情绪也不用', () => {
    const list = [
      { stickerId: 'mixed', mediaId: 'm1', description: '哈哈大笑抱抱' },
      { stickerId: 'pure', mediaId: 'm2', description: '抱抱安慰' },
    ];
    expect(pickStickerForMood(list, 'happy', '', 0.1, new Set(), true)).toBeNull();
    expect(pickStickerForMood(list, 'comfort', '', 0.1, new Set(), true)?.stickerId).toBe('pure');
    expect(availableStickerMoods(list, new Set(), true)).toEqual(['comfort']);
  });
  it('没标签时退回 description：数字说明（「开心鸭 038」）一律排除，无含义的系列名不冒充情绪', () => {
    expect(
      pickStickerForMood(
        [{ stickerId: 't1', mediaId: 'm1', description: '开心鸭 038' }],
        'happy',
        '哈哈',
        0.1,
      ),
    ).toBeNull();
    expect(
      availableStickerMoods([{ stickerId: 't2', mediaId: 'm2', description: '猫咪日常' }]),
    ).toEqual([]);
  });
});

describe('关键词情绪与语气（只剩旧图判断、严肃场景与生态动作在用）', () => {
  it('“不开心”不会被当成开心；严肃话题判为 serious', () => {
    expect(textMoods('今天不开心')).toEqual(['comfort']);
    expect(textMoods('哈哈，开心')).toEqual(['happy']);
    expect(replyTone('我失业了很难过', '哈哈')).toBe('serious');
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
