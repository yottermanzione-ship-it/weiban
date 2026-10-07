/** 零费用预筛只让资格更严格；规则未命中仍要模型复核，不把没命中当作成年人。 */
export function childFeaturesIn(text: string): boolean {
  if (
    /(?:幼儿园|在读小学|在读初中|在读高中|小学生|未成年|萝莉|正太|奶声奶气|肉嘟嘟的小手)/u.test(
      text,
    )
  )
    return true;
  if (/(?:[0-9]+|[零一二三四五六七八九十]+)\s*岁/u.test(text)) {
    for (const match of text.matchAll(/([0-9]+|[零一二三四五六七八九十]+)\s*岁/gu)) {
      const raw = match[1]!;
      const chinese = '零一二三四五六七八九';
      const number = /^\d+$/.test(raw)
        ? Number(raw)
        : raw.includes('十')
          ? (raw.startsWith('十') ? 10 : chinese.indexOf(raw[0]!) * 10) +
            (raw.endsWith('十') ? 0 : chinese.indexOf(raw.at(-1)!))
          : chinese.indexOf(raw);
      if (number >= 0 && number < 18) return true;
    }
  }
  return false;
}
