/**
 * 聊天气泡用换行分隔，但语音上游可能把换行吞掉。
 * 仅把没有结尾标点的行间分隔符换成句号；保留原字词和已有语气标点，
 * 不逐气泡调用、不增加合成字符数，不改变前端文字或音频播放速度。
 */
export function speechText(text: string): string {
  const lines = text
    .trim()
    .split(/\r?\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .map((line, index) => {
      if (index === lines.length - 1) return line;
      if (/[，,。.!！?？;；:：…—][”’」』）)\]】]*$/u.test(line)) return `${line}\n`;
      return `${line}${/[\p{Script=Han}]/u.test(line) ? '。' : ';'}`;
    })
    .join('');
}

export const NATURAL_SPEECH_INSTRUCTION =
  '按日常交谈的自然语速朗读下一条内容，不赶时间、不抢拍。按逗号短停、句号和问号停顿，段落之间留出自然换气；语气连贯，句尾收住，不把多句话挤成一句。不添加、删改或重复字词，不读出任何说明。';
