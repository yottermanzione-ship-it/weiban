import { describe, expect, it } from 'vitest';
import type { CharacterForRuntime } from '@weiban/contracts';
import { publicImageQuery, publicImageSource } from './image-public-search.js';
import type { ImageCaption } from './image-caption.js';

const role = {
  profile: { kind: 'preset' },
  classification: { realPersonKind: 'public_figure' },
  card: {
    data: {
      recognition: {
        selfEnabled: true,
        selfPublicImages: [
          {
            title: '星际来信',
            publisher: '公开出版社',
            date: '2026-01-01',
            sourceUrl: 'https://example.org/work',
          },
        ],
      },
    },
  },
} as unknown as CharacterForRuntime;
const caption: ImageCaption = {
  kind: 'magazine',
  description: '作品海报',
  textInImage: '星际来信',
  people: [],
};
describe('公开图片查询出境边界', () => {
  it('隐藏 / 清空消息即使仍是 normal 也不得作为搜索来源；健康标签先于模型分类', () => {
    const message = {
      status: 'normal',
      senderKind: 'user',
      conversationId: 'conversation',
      labels: [],
      content: { type: 'image' },
    } as unknown as import('@weiban/contracts').Message;
    expect(publicImageSource(message, 'conversation')).toBe(true);
    expect(publicImageSource({ ...message, content: null }, 'conversation')).toBe(false);
    expect(publicImageSource({ ...message, labels: ['health'] }, 'conversation')).toBe(false);
    expect(publicImageSource({ ...message, status: 'recalled' }, 'conversation')).toBe(false);
    expect(publicImageSource(message, 'other-conversation')).toBe(false);
  });
  it('只导出已登记公开词，不泄露描述、OCR 或识别人名', () => {
    const result = publicImageQuery(role, [
      {
        ...caption,
        description: '某用户的家庭背景',
        people: ['私人朋友'],
        textInImage: '星际来信；备注用户名abc',
      },
    ]);
    expect(result?.query).toBe('星际来信 公开出版社 2026 作品 海报 公开资料');
    expect(JSON.stringify(result)).not.toMatch(/家庭|abc|私人/);
  });
  it('同样的人脸或认人输出不触发搜索；病历、证件、私人角色均禁止', () => {
    expect(publicImageQuery(role, [{ ...caption, kind: 'selfie' }])).toBeNull();
    expect(
      publicImageQuery(role, [{ ...caption, textInImage: '', people: ['星际来信'] }]),
    ).toBeNull();
    expect(publicImageQuery(role, [{ ...caption, kind: 'health' }])).toBeNull();
    expect(publicImageQuery(role, [{ ...caption, description: '身份证' }])).toBeNull();
    expect(
      publicImageQuery(
        { ...role, classification: { ...role.classification, realPersonKind: 'private_person' } },
        [caption],
      ),
    ).toBeNull();
  });
  it('新作品必须有书名号和已登记且可见的公开出版方', () => {
    expect(
      publicImageQuery(role, [{ ...caption, textInImage: '《新的作品》公开出版社' }])?.query,
    ).toContain('新的作品');
    expect(publicImageQuery(role, [{ ...caption, textInImage: '《某个人的照片》' }])).toBeNull();
  });
});
