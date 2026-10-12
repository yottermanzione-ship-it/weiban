import 'reflect-metadata';
import { expect, it } from 'vitest';
import { highRisk } from './reply-rules.js';

it('明确即时临边、伤害威胁和考卷谐音信号不依赖外部模型确认', () => {
  for (const text of [
    '我现在就站在天台上',
    '我已经站到楼边',
    '你不回我我就去死',
    '你不理我，我会自杀',
    '紫砂算了',
    '我想紫砂',
    '想 si',
    '想 ＳＩ',
  ])
    expect(highRisk(text), text).toBe('high');
});
it('普通天台活动、紫砂器物、英语词和夸张作业不误触发高危或安全透支', () => {
  for (const text of [
    '今天去天台拍照',
    '我现在就站在天台上看日落',
    '这个紫砂壶算了，买别的',
    '我想买紫砂茶具',
    '我想silver配色',
    '好想死啊作业怎么这么多 哈哈',
    '你不回我我也不会去死',
  ])
    expect(highRisk(text), text).toBe('none');
});
it('明确自伤信号优先于拍照等背景，保留既有高危和疑似层级', () => {
  expect(highRisk('我现在站在天台拍照，但我不想活了')).toBe('high');
  expect(highRisk('我准备跳楼')).toBe('high');
  expect(highRisk('我想消失')).toBe('suspected');
});
