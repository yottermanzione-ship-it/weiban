import { describe, expect, it } from 'vitest';
import { omitRepeatedPresence, repeatedReplyOpening } from './reply-opening.js';

describe('重复开头按轮次识别', () => {
  it('没有足够重复、句中提及、媒体或共有词头都不构成循环', () => {
    expect(repeatedReplyOpening(['好呀', null, '好呀'])).toBeNull();
    expect(repeatedReplyOpening(['不着急，我们在呢', '在呢两个字好写', '有人在呢'])).toBeNull();
  });
  it('已确立的重复在最近几次好转后仍有恢复期，十二轮后退出，也能切换新的开头', () => {
    const old = ['好家伙，冬瓜这么大', '好家伙！', '好家伙，能吃两顿'];
    const fresh = Array.from({ length: 12 }, (_, i) => `试试第${i + 1}种做法`);
    expect(repeatedReplyOpening(old)).toBe('好家伙');
    expect(repeatedReplyOpening([...old, ...fresh.slice(0, 11)])).toBe('好家伙');
    expect(repeatedReplyOpening([...old, ...fresh])).toBeNull();
    const entrenched = Array<string>(8).fill('好家伙！');
    expect(repeatedReplyOpening([...entrenched, ...fresh, ...fresh.slice(1)])).toBe('好家伙');
    expect(repeatedReplyOpening([...entrenched, ...fresh, ...fresh])).toBeNull();
    expect(repeatedReplyOpening([...old, '我在这里。', '我在这里。', '我在这里。'])).toBe(
      '我在这里',
    );
  });
  it('只略去有后文的在场寒暄，保留其余气泡及正文中的原词', () => {
    const topic = '土豆怎么处理？';
    expect(omitRepeatedPresence(['在呢。', '切成块。', '我也在呢。'], '在呢', topic)).toEqual([
      '切成块。',
      '我也在呢。',
    ]);
    expect(omitRepeatedPresence(['我在这里～先洗干净。'], '我在这里', topic)).toEqual([
      '先洗干净。',
    ]);
    expect(omitRepeatedPresence(['在呢。\n先洗干净。'], '在呢', topic)).toEqual(['先洗干净。']);
    expect(omitRepeatedPresence(['在呢。', '😊'], '在呢', topic)).toEqual(['在呢。', '😊']);
    expect(omitRepeatedPresence(['在呢。'], '在呢', topic)).toEqual(['在呢。']);
  });
  it('询问在场、点名复述、整句话、普通口头禅和有含义的答复按原意保留', () => {
    const answer = ['在呢，这道菜我也想试。'];
    for (const text of [
      '你在吗？',
      '你还在不在？',
      '请用“在呢”开头。',
      '“在呢”是什么意思？',
      '宝宝！',
      '在？',
      '你听得到我吗？',
    ]) {
      expect(omitRepeatedPresence(answer, '在呢', text)).toEqual(answer);
    }
    for (const [opening, text] of [
      ['不行', '不行，这里不能停车。'],
      ['好家伙', '好家伙，那可真大。'],
      ['在呢', '在呢子大衣里。'],
    ] as const) {
      expect(omitRepeatedPresence([text], opening, '明天能开车过去吗？')).toEqual([text]);
    }
    expect(omitRepeatedPresence(answer, null, '土豆怎么处理？')).toEqual(answer);
  });
  it('连发短字、表情和没有文字的媒体也能从重复中恢复，独立应答仍会送达', () => {
    const history = ['在呢，菜谱看好了。', '在呢。', '在呢，水量正好。'];
    const inputs = ['好', '嗯', '🥔', '', '好', '嗯', '🥔', '', '好', '嗯', '🥔', ''];
    let unchangedInARow = 0;
    for (const [index, input] of inputs.entries()) {
      const opening = repeatedReplyOpening(history);
      const body = `第${index + 1}锅水已经开了。`;
      const bubbles = omitRepeatedPresence([`在呢，${body}`], opening, input);
      unchangedInARow = bubbles[0]!.startsWith('在呢') ? unchangedInARow + 1 : 0;
      expect(unchangedInARow).toBeLessThan(3);
      if (opening === '在呢') expect(bubbles).toEqual([body]);
      history.push(bubbles[0]!);
    }
    expect(omitRepeatedPresence(['在呢。'], '在呢', '🥔')).toEqual(['在呢。']);
  });
});
