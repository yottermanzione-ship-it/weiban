/**
 * 角色卡（预留位置）。
 *
 * 角色卡的字段由 AI 系统负责人在 T-005 中设计（docs/ai/character-card-spec.md）。
 * T-005 交付后，由架构负责人把规范转写为这里的 Zod schema（dev-plan 任务 D-L0-10），
 * 届时 cardSchemaVersion 升为 1，并替换下面的占位定义。
 *
 * 系统层约束（AI 负责人设计时必须遵守，见 docs/architecture/hard-boundaries.md 第 2 节）：
 * 1. 角色分类（basis / realPersonKind / ageSetting / childAppearance）不放在角色卡里，
 *    而是 characters 模块的结构化字段 CharacterClassification；角色卡中不得出现可覆盖它们的字段。
 * 2. 「成人模式资格」等推导值不得出现在角色卡里。
 * 3. 角色卡里的自由文本永远不作为硬性边界的判定依据。
 * 4. 音色只能引用音色库 ID，不能内嵌音频或克隆参数。
 */
import { z } from 'zod';

/** 占位：0 表示尚未定稿。 */
export const CHARACTER_CARD_SCHEMA_VERSION = 0 as const;

export const CharacterCard = z.object({
  cardSchemaVersion: z.number().int().nonnegative(),
  /** 定稿前以松散对象存储，服务器只做 JSON 校验，不解释内容。 */
  data: z.record(z.string(), z.unknown()),
});
export type CharacterCard = z.infer<typeof CharacterCard>;
