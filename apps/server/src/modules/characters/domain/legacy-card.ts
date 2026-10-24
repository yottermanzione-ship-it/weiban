/**
 * 旧角色卡读取模块（characters 侧）。
 *
 * **旧卡就是运行格式。** `characters_v2` 的一整行原样存在 `characters.legacy_card`，
 * 这里只把 jsonb 交给强类型访问器；不把旧卡转成 `WeibanCardData`，也不改字段名。
 * 访问器与旧库两张附属表（世界书 / 示例对话）的解析放在 `@weiban/contracts`
 * 的 `legacy-character-card.ts`，因为 ai-runtime 也要读同一份旧格式。
 */
import type { LegacyRuntimeContext } from '@weiban/contracts';
import { legacyDialogueExamples, legacyKnowledgeEntries } from '@weiban/contracts';

export {
  LegacyCharacterCard,
  parseLegacyCard,
  legacyKnowledgeEntries,
  legacyDialogueExamples,
  type LegacyCardRow,
  type LegacyKnowledgeEntry,
  type LegacyDialogueExample,
  type LegacyGroupProfile,
  type LegacyMomentProfile,
} from '@weiban/contracts';

/** 没有旧卡 / 没有附属数据时的空上下文。 */
export const EMPTY_LEGACY_CONTEXT: LegacyRuntimeContext = { lorebook: [], examples: [] };

/**
 * 旧库 `character_lorebook_entries` / `character_example_dialogues` 的 jsonb 行 → 运行时上下文。
 * 行是旧库原样 JSON（`payload` 列），解析只做类型收敛，不重排字段、不归并分类。
 */
export function legacyRuntimeContext(
  lorebookRows: readonly unknown[],
  exampleRows: readonly unknown[],
): LegacyRuntimeContext {
  return {
    lorebook: legacyKnowledgeEntries(lorebookRows),
    examples: legacyDialogueExamples(exampleRows),
  };
}
