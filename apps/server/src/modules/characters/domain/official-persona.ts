/**
 * 3.5 角色广场「微伴角色」详情的公开人设摘要（契约 PlazaOfficialPersona；T-20261103c）。
 *
 * 只摘公开的几项并截断，新卡、旧卡同等克制：不返回世界书、示例对话、避免词、开场白、背景细节、熟悉度成长等完整提示词内容。
 * - 新卡（WeibanCardData）：简介 / 性格 / 说话语气 / 前 5 个口头禅；
 * - 旧卡（legacy_card）：简介取资料页 intro，性格取 soul_personality，说话方式取 speaking_style（没有再取 style_chat_style），
 *   旧卡没有口头禅字段，给空数组。
 */
import {
  CharacterCard,
  type AdminCharacterWrite,
  type PlazaOfficialPersona,
} from '@weiban/contracts';
import type { LegacyCharacterCard } from './legacy-card.js';

/** 已上架预设角色的人设原文来源：旧卡给访问器，新卡给发布版内容。 */
export type OfficialPersonaSource =
  { kind: 'legacy'; legacy: LegacyCharacterCard } | { kind: 'card'; body: AdminCharacterWrite };

/** 按 UTF-16 长度截断（与契约 z.string().max 口径一致），不留半个代理对。 */
function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** intro = 资料页里已经公开的简介（CharacterProfile.intro）。 */
export function officialPersona(
  source: OfficialPersonaSource,
  intro: string,
): PlazaOfficialPersona {
  if (source.kind === 'legacy') {
    const legacy = source.legacy;
    return {
      summary: clip(intro, 300),
      personality: clip(legacy.soulPersonality, 300),
      speechStyle: clip(legacy.speakingStyle.trim() || legacy.styleChatStyle, 200),
      catchphrases: [],
    };
  }
  const card = CharacterCard.safeParse(source.body.card);
  const d = card.success ? card.data.data : null;
  return {
    summary: clip(d?.persona.summary || intro, 300),
    personality: clip(d?.persona.personality ?? '', 300),
    speechStyle: clip(d?.speech.tone ?? '', 200),
    catchphrases: (d?.speech.catchphrases ?? [])
      .map((c) => clip(c, 50))
      .filter(Boolean)
      .slice(0, 5),
  };
}
