import { expect, it } from 'vitest';
import { childFeaturesIn } from './child-features.js';

it('识别完整的儿童年龄，不从成人年龄数字中截取儿童后缀', () => {
  for (const text of ['0岁', '8岁', '17岁', '十岁', '十二岁', '十七岁', '两岁']) {
    expect(childFeaturesIn(`角色${text}，喜欢读书`), text).toBe(true);
  }
  for (const text of ['18岁', '27岁', '110岁', '18.5岁', '十八岁', '二十七岁', '一百零七岁']) {
    expect(childFeaturesIn(`角色${text}，平时工作`), text).toBe(false);
  }
  expect(childFeaturesIn(['二十七岁', '在读小学'])).toBe(true);
});
