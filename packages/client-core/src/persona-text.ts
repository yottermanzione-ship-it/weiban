/**
 * 平台角色人设原文的无损分段（2026-10-27 批 U4 从 apps/admin/src/components/persona-text-sections.ts 挪来，
 * 网页人设卡与后台共用）。不从原始 ZIP 重新生成、不改字段格式。
 *
 * 能识别的中文分段标签不在这里写死：由 persona-sections.ts 里各子板块的 legacyLabels 汇总而来
 * （PERSONA_TEXT_LABELS），新增一个标签 = 在对应子板块的 legacyLabels 里加一项。
 */
export interface PersonaTextPart {
  label: string;
  prefix: string;
  text: string;
}
export interface PersonaTextDocument {
  leading: string;
  parts: PersonaTextPart[];
}

/** 按给定标签表把原文切段（标签单独起一行，后面跟「：」或「:」）。 */
export function splitPersonaTextWith(
  source: string,
  labels: ReadonlySet<string>,
): PersonaTextDocument {
  const matches = [...source.matchAll(/(^|\n)([^\n:：]{1,22})([:：][ \t]*)/gu)].filter((m) =>
    labels.has(m[2]!.trim()),
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
