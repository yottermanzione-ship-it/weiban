/**
 * T-20261103g：私聊分享照片的标记与提示词（纯函数）。
 */
import { describe, expect, it } from 'vitest';
import {
  photoCaption,
  photoExcerpt,
  photoMaterialAllowed,
  photoPromptText,
  takePhotoMarker,
  type PhotoOffer,
} from './photo-marker.js';
import { takeStickerMarker } from './sticker-marker.js';

const offer: PhotoOffer = {
  mediaId: 'media-1',
  updateId: 'update-1',
  excerpt: '今天去海边拍了日落',
  publishedOn: '2026-10-30',
};
const policy = { isMinor: false, isRealPerson: false, romanceAllowed: false };

describe('takePhotoMarker：剥掉照片标记，用户正文不残留', () => {
  it('正文最后一行的「[照片]」整行去掉，并记下想分享', () => {
    expect(takePhotoMarker('给你看看\n[照片]')).toEqual({ text: '给你看看', photo: true });
  });

  it('各种写法都认：全角括号、[图片]、[分享照片]、[照片:说明]、[photo]', () => {
    for (const raw of [
      '好看吧【照片】',
      '好看吧 [图片]',
      '好看吧\n［分享照片］',
      '好看吧\n[照片：海边]',
      '好看吧\n[发张照片]',
      '好看吧\n[Photo]',
    ]) {
      const result = takePhotoMarker(raw);
      expect(result.photo).toBe(true);
      expect(result.text).toBe('好看吧');
    }
  });

  it('照着聊天记录学写的「[你发了一张图片：…]」只剥不发', () => {
    expect(takePhotoMarker('[你发了一张图片：微博配图（10月30日的微博：「日落」）]\n好看吗')).toEqual(
      { text: '好看吗', photo: false },
    );
  });

  it('没有标记时原样返回，一个字不改', () => {
    const raw = '  今天的照片\n还没整理  ';
    expect(takePhotoMarker(raw)).toEqual({ text: raw, photo: false });
  });

  it('正文只剩标记时补一句很短的话，绝不发空回复', () => {
    expect(takePhotoMarker('[照片]')).toEqual({ text: '给你看看这张', photo: true });
  });

  it('和表情标记一起写时两个都剥掉', () => {
    const photo = takePhotoMarker('哈哈\n[照片]\n[表情:开心]');
    const sticker = takeStickerMarker(photo.text);
    expect(photo.photo).toBe(true);
    expect(sticker).toEqual({ text: '哈哈', mood: 'happy' });
  });

  it('看图存档里的「[图片〔图1〕]」写法不当成照片标记', () => {
    expect(takePhotoMarker('你发的[图片〔图1〕]真好看').photo).toBe(false);
  });
});

describe('photoPromptText：告诉模型可以分享哪张、图出自哪条微博', () => {
  it('写明日期、微博原文、标记写法，以及不编造照片细节', () => {
    const text = photoPromptText({ offer, withSticker: false });
    expect(text).toContain('10月30日发的微博里的配图');
    expect(text).toContain('「今天去海边拍了日落」');
    expect(text).toContain('[照片]');
    expect(text).toContain('不编造照片里的细节');
    expect(text).not.toContain('表情包最多选一样');
  });

  it('这轮也能配表情时提醒只选一样；日期不明写「最近」', () => {
    const text = photoPromptText({ offer: { ...offer, publishedOn: null }, withSticker: true });
    expect(text).toContain('你最近发的微博');
    expect(text).toContain('这轮照片和表情包最多选一样');
  });
});

describe('素材摘录、存档描述与安全规则', () => {
  it('摘录压掉换行、超长截断', () => {
    expect(photoExcerpt('第一行\n\n第二行   第三行')).toBe('第一行 第二行 第三行');
    expect([...photoExcerpt('啊'.repeat(100))].length).toBe(81);
  });

  it('存档描述不带「你」，聊天记录、摘要里都能用', () => {
    expect(photoCaption(offer)).toEqual({
      kind: 'other',
      description: '微博配图（10月30日的微博：「今天去海边拍了日落」）',
      textInImage: '',
      people: [],
    });
  });

  it('涉及健康隐私、过短的素材不拿来分享', () => {
    expect(photoMaterialAllowed('今天去海边拍了日落', policy)).toBe(true);
    expect(photoMaterialAllowed('好', policy)).toBe(false);
    expect(photoMaterialAllowed('最近生理期肚子好痛', policy)).toBe(false);
  });
});
