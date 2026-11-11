import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { assemblePrompt, type ChatTurnMessage } from './prompt-assembly.js';
import {
  detectHabits,
  historyForReplyModel,
  splitReply,
  stripHabits,
  takeAfterFinalMarker,
} from './reply-rules.js';

describe('保留线上回复修复：正文标记与动态习惯词', () => {
  it('有正文标记时只保留后面的回复；行内提及不当作分隔符', () => {
    expect(takeAfterFinalMarker('内部草稿\n【正文】\n你好呀\n今天怎么样')).toBe(
      '你好呀\n今天怎么样',
    );
    expect(takeAfterFinalMarker('内部草稿\n【正文】：你好呀')).toBe('你好呀');
    expect(takeAfterFinalMarker('他说的【正文】是文章标题')).toBe('他说的【正文】是文章标题');
    expect(splitReply('草稿\n【正文】\n第一句\n第二句', true)).toEqual(['第一句', '第二句']);
  });
  it('最近20条中过半才识别，角色卡已有的口头禅与表情豁免', () => {
    const repeated = Array.from({ length: 11 }, () => '今天我们一起去散步 OK 😊');
    expect(detectHabits(repeated.slice(0, 10), '')).toEqual([]);
    expect(detectHabits(repeated, '')).toEqual(['ok', '😊']);
    expect(detectHabits(repeated, '说话习惯：OK 😊')).toEqual([]);
    expect(
      detectHabits([...repeated, ...Array.from({ length: 20 }, () => '一起散步吧')], ''),
    ).toEqual([]);
  });
  it('纯英文和中文词语内的语气字不被当作习惯清掉', () => {
    expect(
      detectHabits(
        Array.from({ length: 20 }, () => 'We love the good life'),
        '',
      ),
    ).toEqual([]);
    expect(stripHabits('哈哈大笑之后，一起散步。', ['哈'])).toBe('哈哈大笑之后，一起散步。');
  });
  it('只清命中的词，清空时保留原文，不更改传入的历史记录', () => {
    const history = Array.from({ length: 11 }, () => '今天我们一起去散步 OK 😊');
    const copy = [...history];
    const habits = detectHabits(history, '');
    expect(stripHabits('OK 一起散步 😊', habits).trim()).toBe('一起散步');
    expect(stripHabits('😊', ['😊'])).toBe('😊');
    expect(history).toEqual(copy);
  });
  it('新识别到重复口头禅时，文字聊天的旧请求前缀仍可复用', () => {
    const turns: ChatTurnMessage[] = Array.from({ length: 11 }, (_, i) => [
      { role: 'user' as const, content: `合成话题第 ${i + 1} 轮` },
      { role: 'assistant' as const, content: '今天我们一起去散步 OK 😊' },
    ]).flat();
    const earlier = turns.slice(0, -2);
    const beforeHabits = detectHabits(
      earlier.filter((m) => m.role === 'assistant').map((m) => m.content),
      '',
    );
    const laterHabits = detectHabits(
      turns.filter((m) => m.role === 'assistant').map((m) => m.content),
      '',
    );
    expect(beforeHabits).toEqual([]);
    expect(laterHabits).toEqual(['ok', '😊']);
    const head = [{ title: '', text: '固定角色说明' }];
    const before = assemblePrompt({
      head,
      history: historyForReplyModel(earlier, beforeHabits, false),
      tail: [],
    });
    const after = assemblePrompt({
      head,
      history: historyForReplyModel(turns, laterHabits, false),
      tail: [],
    });
    expect(after.messages.slice(0, before.messages.length)).toEqual(before.messages);
    expect(stripHabits('OK 一起散步 😊', laterHabits).trim()).toBe('一起散步');
    expect(historyForReplyModel(turns, laterHabits, true)[1]?.content.trim()).toBe(
      '今天我们一起去散步',
    );
  });
});
