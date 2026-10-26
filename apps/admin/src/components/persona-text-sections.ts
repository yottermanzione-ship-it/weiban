/** 有效人设文本的无损分段；不从原始ZIP重新生成、不改字段格式。 */
export interface PersonaTextPart {
  label: string;
  prefix: string;
  text: string;
}
export interface PersonaTextDocument {
  leading: string;
  parts: PersonaTextPart[];
}
const LABELS = new Set([
  '身份',
  '简介',
  '公众人设',
  '公众形象',
  '舞台形象',
  '代表作品',
  '人格核心',
  '性格核心',
  '私下感',
  '人设张力',
  '价值观',
  '必须保留',
  '必须避免',
  '粉丝互动',
  '互动距离',
  '关系距离',
  '关系模式',
  '默认回复',
  '冷淡回复',
  '温和回复',
  '调侃模式',
  '越界回复',
  '情绪基线',
  '情绪基调',
  '情绪质感',
  '安慰模式',
  '句式规则',
  '回复长度',
  '反通用 AI 规则',
  '反通用AI规则',
  '样例语气',
  '边界处理',
  '隐私问题',
  '绯闻问题',
  '行程问题',
  '官方立场',
  '吃醋模式',
  '亲近方式',
]);
export function splitPersonaText(source: string): PersonaTextDocument {
  const matches = [...source.matchAll(/(^|\n)([^\n:：]{1,22})([:：][ \t]*)/gu)].filter((m) =>
    LABELS.has(m[2]!.trim()),
  );
  if (!matches.length) return { leading: source, parts: [] };
  return {
    leading: source.slice(0, matches[0]!.index),
    parts: matches.map((m, i) => ({
      label: m[2]!.trim(),
      prefix: m[0],
      text: source.slice(m.index! + m[0].length, matches[i + 1]?.index ?? source.length),
    })),
  };
}
export function joinPersonaText(document: PersonaTextDocument): string {
  return document.leading + document.parts.map((part) => part.prefix + part.text).join('');
}
