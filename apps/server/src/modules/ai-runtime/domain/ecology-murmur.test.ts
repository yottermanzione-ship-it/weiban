/**
 * 碎碎念修正（T-20261103b）：素材不含运营摘要、截断落在句末、元话语整条丢弃。
 */
import { describe, expect, it } from 'vitest';
import {
  MURMUR_MAX_CHARS,
  buildMurmurMaterial,
  finalizeMurmur,
  murmurDayPart,
  murmurLooksMeta,
  truncateMurmur,
} from './ecology-murmur.js';

const len = (s: string) => [...s].length;

describe('碎碎念素材', () => {
  it('只有时段、角色自己的生活和这次做了什么，第一人称', () => {
    const text = buildMurmurMaterial({
      localHour: 15,
      weekday: 3,
      statusText: '在练琴',
      signature: '慢慢来，比较快',
      recentPosts: ['今天的晚霞好看', '新买的绿植发芽了', '第三条不该出现'],
      todayEvents: ['和小林去吃了火锅'],
      done: ['给你发了条消息'],
    });
    expect(text).toBe(
      [
        '现在是周三下午。',
        '我现在的状态：在练琴',
        '我的个性签名：慢慢来，比较快',
        '我最近发的朋友圈：「今天的晚霞好看」',
        '我最近发的朋友圈：「新买的绿植发芽了」',
        '今天的事：和小林去吃了火锅',
        '刚才：给你发了条消息',
      ].join('\n'),
    );
  });

  it('什么也没做时写「看了看手机」；没有资料时只剩时段与这次', () => {
    expect(buildMurmurMaterial({ localHour: 23, weekday: 0, done: [] })).toBe(
      '现在是周日深夜。\n刚才：看了看手机，没做什么',
    );
  });

  it('不含运营摘要字段：含「对方 / 用户 / 角色」的条目整条丢掉，绝不出现计数口吻', () => {
    const text = buildMurmurMaterial({
      localHour: 9,
      weekday: 1,
      statusText: '等对方回消息',
      signature: null,
      recentPosts: ['角色今天已经做过：给你发了条消息'],
      todayEvents: ['用户 30 分钟前还在聊天', '上午去图书馆还书'],
      done: ['对方上次发消息在 5 分钟前；角色发了还没被回的消息 2 条', '更新了状态'],
    });
    for (const banned of [
      '对方',
      '用户',
      '角色',
      '还没被回',
      '分钟前',
      '已经做过',
      '上次发消息',
      '最近对话要点',
    ])
      expect(text).not.toContain(banned);
    expect(text).toContain('今天的事：上午去图书馆还书');
    expect(text).toContain('刚才：更新了状态');
  });

  it('健康隐私的条目丢掉', () => {
    const text = buildMurmurMaterial({
      localHour: 20,
      weekday: 5,
      todayEvents: ['生理期肚子疼', '晚上看了场电影'],
      done: [],
    });
    expect(text).not.toContain('生理期');
    expect(text).toContain('晚上看了场电影');
  });

  it('时段说法覆盖全天', () => {
    expect([0, 6, 9, 12, 15, 18, 21, 23].map(murmurDayPart)).toEqual([
      '深夜',
      '清早',
      '上午',
      '中午',
      '下午',
      '傍晚',
      '晚上',
      '深夜',
    ]);
  });
});

describe('碎碎念截断', () => {
  it('60 字以内原样保留', () => {
    expect(truncateMurmur('今天风好大，差点把伞吹跑了。')).toBe('今天风好大，差点把伞吹跑了。');
  });

  it('超长时截在 60 字以内最后一个句末标点之后，收尾引号一并保留', () => {
    const first = '早上起晚了，一路小跑去赶车，还好没迟到。';
    const second = '中午吃了碗很辣的面，「辣得眼泪都出来了！」';
    const tail = '下午一直在开会，脑子已经转不动了，晚上想早点回家躺着发呆什么也不干';
    const out = truncateMurmur(first + second + tail)!;
    expect(out).toBe(first + second);
    expect(len(out)).toBeLessThanOrEqual(MURMUR_MAX_CHARS);
    expect(out.endsWith('」')).toBe(true);
  });

  it('前 60 字没有句末标点时退到最后一个逗号，换成省略号', () => {
    const text = `${'今天去了很远的地方'.repeat(4)}，${'路上一直在下雨'.repeat(5)}`;
    const out = truncateMurmur(text)!;
    expect(out).toBe(`${'今天去了很远的地方'.repeat(4)}…`);
    expect(len(out)).toBeLessThanOrEqual(MURMUR_MAX_CHARS);
  });

  it('连逗号都没有就丢弃（不留半句话）', () => {
    expect(truncateMurmur('啊'.repeat(80))).toBeNull();
  });

  it('按字符计数：emoji 不会被截成半个', () => {
    const text = `${'开心'.repeat(29)}😀。后面还有很多很多字`;
    const out = truncateMurmur(text)!;
    expect(out).toBe(`${'开心'.repeat(29)}😀。`);
  });

  it('模型输出被截断（没写完）时只保留完整的句子', () => {
    const raw = `今天去公园散步，看到好多人在放风筝，有一只像大鱼一样在天上游。回来的路上买了杯热可可，捧在手里暖暖的，走着走着就想起小时候冬天在外婆家烤火的那些晚上，还有`;
    expect(finalizeMurmur(raw)).toBe(
      '今天去公园散步，看到好多人在放风筝，有一只像大鱼一样在天上游。',
    );
  });
});

describe('碎碎念元话语过滤', () => {
  it.each([
    '好的，以下是今天的碎碎念：今天天气不错。',
    '作为一个温柔的人，我今天很开心。',
    '日记：今天去了海边。',
    '碎碎念：有点想睡觉。',
    '对方还没回我消息，有点失落。',
    '用户今天好像很忙。',
    '角色今天已经做过：给你发了条消息。',
    '根据人设，我应该开心一点。',
    '这段提示词让我写一句话。',
    '不超过 60 字的话：今天很累。',
    '我现在的状态：在听歌',
    '刚才：看了看手机，没做什么',
    '写满 60 字太难了。',
  ])('丢弃：%s', (raw) => {
    expect(murmurLooksMeta(raw)).toBe(true);
    expect(finalizeMurmur(raw)).toBeNull();
  });

  it.each([
    '今天的晚霞好好看，可惜没来得及拍下来。',
    '晚上10:30了还不想睡，再听两首歌就躺下。',
    '给你发了条消息，不知道你在忙什么呢～',
    '刚改了签名，感觉心情也跟着变好了一点。',
  ])('保留：%s', (raw) => {
    expect(murmurLooksMeta(raw)).toBe(false);
    expect(finalizeMurmur(raw)).toBe(raw);
  });

  it('去掉首尾引号、多行并成一段', () => {
    expect(finalizeMurmur('「今天好冷」\n')).toBe('今天好冷');
    expect(finalizeMurmur('今天好冷\n还是想吃冰淇淋。')).toBe('今天好冷，还是想吃冰淇淋。');
    expect(finalizeMurmur('今天好冷。\n还是想吃冰淇淋。')).toBe('今天好冷。还是想吃冰淇淋。');
  });

  it('空输出丢弃', () => {
    expect(finalizeMurmur('  \n ')).toBeNull();
  });
});
