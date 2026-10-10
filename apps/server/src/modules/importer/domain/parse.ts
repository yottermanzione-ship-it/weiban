/**
 * 聊天记录格式识别（CHR-08 第 1 条，prd-answers.md 第 6 节）。纯函数，不碰数据库。
 * 支持：
 *   1. CSV：时间, 发言人, 内容（可有表头；支持双引号转义）；
 *   2. 第三方工具导出的微信文本，几种常见行格式：
 *      a. 「2024-01-01 12:00:00 张三」一行，下一行起是内容（WeChatMsg / 留痕等）；
 *      b. 「张三 2024-01-01 12:00:00」一行，下一行起是内容；
 *      c. 「[2024-01-01 12:00:00] 张三: 内容」或「2024-01-01 12:00 张三：内容」同一行；
 *   3. 简单对话：「张三：内容」「张三: 内容」。
 * 识别不出两个以上发言人时返回空（调用方再交给模型识别或提示格式说明）。不直接解析微信数据库。
 */
import type { ImportDialogueLine } from '@weiban/contracts';

const DATE = String.raw`\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?(?:\s+|T)\d{1,2}:\d{2}(?::\d{2})?`;
const NAME = String.raw`[^\s:：\[\]【】]{1,40}`;
const HEADER_DATE_NAME = new RegExp(String.raw`^\[?(${DATE})\]?\s+(${NAME}(?:\s${NAME})?)\s*$`);
const HEADER_NAME_DATE = new RegExp(
  String.raw`^(${NAME}(?:\s${NAME})?)\s+\(?\[?(${DATE})\]?\)?\s*$`,
);
const INLINE_DATE_NAME = new RegExp(String.raw`^\[?(${DATE})\]?\s+(${NAME})\s*[:：]\s?(.+)$`);
const SIMPLE = new RegExp(String.raw`^(${NAME})\s*[:：]\s?(.+)$`);

export interface ParsedDialogue {
  lines: ImportDialogueLine[];
  format: 'csv' | 'header_date_name' | 'header_name_date' | 'inline' | 'simple' | null;
}

export function normalizeText(raw: string): string {
  return raw.replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '').replace(/\r\n?/g, '\n');
}

/** 发言人统计（按出现次数倒序）。 */
export function speakerStats(
  lines: ImportDialogueLine[],
): Array<{ name: string; messageCount: number }> {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, messageCount]) => ({ name: name.slice(0, 40), messageCount }));
}

/** 只取最近的部分，总字数不超过 maxChars（CHR-08 边界情况）。 */
export function keepRecent(
  lines: ImportDialogueLine[],
  maxChars: number,
): { lines: ImportDialogueLine[]; truncated: boolean; charCount: number } {
  let total = 0;
  let start = lines.length;
  while (start > 0) {
    const len = lines[start - 1]!.text.length;
    if (total + len > maxChars) break;
    total += len;
    start -= 1;
  }
  return { lines: lines.slice(start), truncated: start > 0, charCount: total };
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '，' || ch === '\t') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** CSV 记录可能跨行（引号内换行）：按引号配对切分记录。 */
function csvRecords(text: string): string[] {
  const records: string[] = [];
  let cur = '';
  let quotes = 0;
  for (const line of text.split('\n')) {
    cur = cur ? `${cur}\n${line}` : line;
    quotes += (line.match(/"/g) ?? []).length;
    if (quotes % 2 === 0) {
      records.push(cur);
      cur = '';
      quotes = 0;
    }
  }
  if (cur) records.push(cur);
  return records;
}

function parseCsv(text: string): ImportDialogueLine[] {
  const lines: ImportDialogueLine[] = [];
  const records = csvRecords(text).filter((r) => r.trim());
  for (const [i, record] of records.entries()) {
    const cols = parseCsvRow(record);
    if (cols.length < 3) return [];
    if (
      i === 0 &&
      /时间|time|date/i.test(cols[0]!) &&
      /发言|speaker|name|sender|人/i.test(cols[1]!)
    )
      continue;
    const [, speaker, ...rest] = cols;
    const content = rest.join(',').trim();
    if (!speaker || !content) continue;
    lines.push({ speaker: speaker.slice(0, 40), text: content });
  }
  return lines;
}

function parseHeaderStyle(text: string, pattern: RegExp, nameGroup: number): ImportDialogueLine[] {
  const lines: ImportDialogueLine[] = [];
  let speaker: string | null = null;
  let buffer: string[] = [];
  let headers = 0;
  const flush = () => {
    const content = buffer.join('\n').trim();
    if (speaker && content) lines.push({ speaker, text: content });
    buffer = [];
  };
  for (const raw of text.split('\n')) {
    const m = pattern.exec(raw.trim());
    if (m) {
      flush();
      speaker = m[nameGroup]!.trim().slice(0, 40);
      headers += 1;
    } else if (speaker) buffer.push(raw);
  }
  flush();
  return headers >= 2 ? lines : [];
}

function parseInline(text: string, pattern: RegExp, nameGroup: number, textGroup: number) {
  const lines: ImportDialogueLine[] = [];
  let matched = 0;
  let nonEmpty = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    nonEmpty += 1;
    const m = pattern.exec(line);
    if (m) {
      matched += 1;
      lines.push({ speaker: m[nameGroup]!.trim().slice(0, 40), text: m[textGroup]!.trim() });
    } else if (lines.length) {
      // 续行：并入上一条。
      const last = lines[lines.length - 1]!;
      last.text = `${last.text}\n${line}`;
    }
  }
  // 至少一半的非空行符合格式才认。
  return matched >= 2 && matched * 2 >= nonEmpty ? lines : [];
}

const atLeastTwoSpeakers = (lines: ImportDialogueLine[]) =>
  new Set(lines.map((l) => l.speaker)).size >= 2;

/** 依次尝试各格式，取第一个识别出两个以上发言人的结果。 */
export function parseDialogue(raw: string, fileName?: string | null): ParsedDialogue {
  const text = normalizeText(raw);
  const tries: Array<[ParsedDialogue['format'], () => ImportDialogueLine[]]> = [
    ['header_date_name', () => parseHeaderStyle(text, HEADER_DATE_NAME, 2)],
    ['header_name_date', () => parseHeaderStyle(text, HEADER_NAME_DATE, 1)],
    ['inline', () => parseInline(text, INLINE_DATE_NAME, 2, 3)],
    ['simple', () => parseInline(text, SIMPLE, 1, 2)],
  ];
  const isCsv = fileName?.toLowerCase().endsWith('.csv') ?? false;
  if (isCsv) tries.unshift(['csv', () => parseCsv(text)]);
  else tries.push(['csv', () => parseCsv(text)]);
  for (const [format, run] of tries) {
    const lines = run();
    if (lines.length && atLeastTwoSpeakers(lines)) return { lines, format };
  }
  return { lines: [], format: null };
}
