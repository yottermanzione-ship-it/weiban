/** 按光标插入或删除一个完整 emoji；不拆开肤色、变体或组合字符。 */
export function editEmoji(text: string, start: number, end: number, insert?: string) {
  let from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  if (insert === undefined && from === to && from > 0) {
    const before = text.slice(0, from);
    if (typeof Intl.Segmenter === 'function') {
      from =
        Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(before)).at(-1)
          ?.index ?? 0;
    } else {
      from -= Array.from(before).at(-1)?.length ?? 0;
    }
  }
  const value = text.slice(0, from) + (insert ?? '') + text.slice(to);
  return { value, cursor: from + (insert?.length ?? 0) };
}
