import { describe, expect, it } from 'vitest';
import {
  buildStickerLabelTags,
  toStickerListOption,
  type StickerLabelRow,
  type StickerListJoinRow,
} from './sticker-labels.js';

const row: StickerLabelRow = {
  primaryTag: 'comfort',
  fullDescription: '一只小猫抱着抱枕',
  imageText: '抱抱',
  literalMeaning: '小猫抱着抱枕',
  usageMeaning: '安慰对方，陪着你',
  suitableContexts: '对方难过时安慰',
};

describe('buildStickerLabelTags', () => {
  it('按主标签、完整描述、图里文字、字面意思、使用意思、适合场合的顺序拼', () => {
    expect(buildStickerLabelTags(row)).toEqual([
      'comfort',
      '一只小猫抱着抱枕',
      '抱抱',
      '小猫抱着抱枕',
      '安慰对方，陪着你',
      '对方难过时安慰',
    ]);
  });

  it('没有标签行时返回 undefined，退回 description 旧逻辑', () => {
    expect(buildStickerLabelTags(null)).toBeUndefined();
    expect(buildStickerLabelTags(undefined)).toBeUndefined();
  });

  it('图里无文字的「无」与空白、重复文本丢掉', () => {
    expect(
      buildStickerLabelTags({
        ...row,
        imageText: '无',
        literalMeaning: '  ',
        usageMeaning: '安慰对方，陪着你',
      }),
    ).toEqual(['comfort', '一只小猫抱着抱枕', '安慰对方，陪着你', '对方难过时安慰']);
    expect(
      buildStickerLabelTags({
        primaryTag: 'happy',
        fullDescription: '无',
        imageText: '无',
        literalMeaning: '',
        usageMeaning: ' ',
        suitableContexts: '无',
      }),
    ).toEqual(['happy']);
    expect(
      buildStickerLabelTags({
        primaryTag: '无',
        fullDescription: '无',
        imageText: '无',
        literalMeaning: '',
        usageMeaning: ' ',
        suitableContexts: '无',
      }),
    ).toBeUndefined();
  });
});

describe('toStickerListOption', () => {
  const base: Omit<StickerListJoinRow, 'label'> = {
    stickerId: 'sticker-1',
    mediaId: 'media-1',
    description: '表情 1',
  };
  const label: StickerLabelRow & { reviewNeeded: boolean; retryExcluded: boolean } = {
    primaryTag: 'comfort',
    fullDescription: '一只小猫抱着抱枕',
    imageText: '抱抱',
    literalMeaning: '小猫抱着抱枕',
    usageMeaning: '安慰对方，陪着你',
    suitableContexts: '对方难过时安慰',
    reviewNeeded: false,
    retryExcluded: false,
  };

  it('有标签且任一标记为 true 的整行排除（review_needed / retry_excluded 各一例）', () => {
    expect(toStickerListOption({ ...base, label: { ...label, reviewNeeded: true } })).toBeNull();
    expect(toStickerListOption({ ...base, label: { ...label, retryExcluded: true } })).toBeNull();
    expect(
      toStickerListOption({
        ...base,
        label: { ...label, reviewNeeded: true, retryExcluded: true },
      }),
    ).toBeNull();
  });

  it('无标签行保留可选、退回 description 旧逻辑（不带 tags）', () => {
    expect(toStickerListOption({ ...base, label: null })).toEqual({
      stickerId: 'sticker-1',
      mediaId: 'media-1',
      description: '表情 1',
    });
  });

  it('两标记清掉后恢复可选且读出 tags', () => {
    expect(toStickerListOption({ ...base, label })).toEqual({
      stickerId: 'sticker-1',
      mediaId: 'media-1',
      description: '表情 1',
      tags: [
        'comfort',
        '一只小猫抱着抱枕',
        '抱抱',
        '小猫抱着抱枕',
        '安慰对方，陪着你',
        '对方难过时安慰',
      ],
    });
  });
});
