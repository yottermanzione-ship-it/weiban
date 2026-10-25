/**
 * 旧卡版本快照与恢复（纯函数）。
 *
 * 快照是「保存 / 恢复前」的完整状态，落在 `characters.legacy_character_revisions`，
 * **不经过 platform.audit_log 的通用脱敏**（长字母数字、URL、未识别旧字段都按原样保存）；
 * 审计里只留操作者、改了哪些字段、新旧 revision 与快照引用。
 *
 * 快照覆盖：完整 `legacy_card`、主表显示字段（name / search_text）、别名与签名、
 * 头像 media id 与展示参数、世界书 / 示例的原 id 与 payload。不存头像短效签名 URL，
 * 不存上架状态与资格标注（恢复不还原它们），也不改角色 ID / 联系人 / 消息。
 */
import type { AdminLegacyDialogueExample, AdminLegacyLorebookEntry } from '@weiban/contracts';
import { parseLegacyCard } from './legacy-card.js';
import { legacyDisplayName, legacySearchText, readLegacyAdminFields } from './legacy-admin.js';

/** 一份可写入 legacy_character_revisions 的完整快照。 */
export interface LegacySnapshotData {
  characterId: string;
  /** 快照代表的那一版 revision（保存 / 恢复之前的状态）。 */
  revision: number;
  source: 'save' | 'restore';
  operatorUserId: string | null;
  note: string | null;
  name: string;
  searchText: string;
  aliases: string[];
  signature: string;
  legacyCard: Record<string, unknown>;
  avatarMediaId: string | null;
  avatarDisplay: Record<string, unknown>;
  lorebook: AdminLegacyLorebookEntry[];
  examples: AdminLegacyDialogueExample[];
  createdAt: Date;
}

/** 恢复后要写回角色主表与附属表的内容（不含上架状态 / 资格）。 */
export interface LegacyRestoreState {
  legacyCard: Record<string, unknown>;
  name: string;
  searchText: string;
  avatarMediaId: string | null;
  avatarDisplay: Record<string, unknown>;
  lorebook: AdminLegacyLorebookEntry[];
  examples: AdminLegacyDialogueExample[];
}

/** 当前角色状态（恢复前）。 */
export interface LegacyCurrentState extends LegacyRestoreState {
  characterId: string;
  revision: number;
}

export type LegacyRestorePlan =
  | {
      ok: true;
      value: { revision: number; state: LegacyRestoreState; before: LegacySnapshotData };
    }
  | { ok: false; kind: 'conflict'; message: string; currentRevision: number }
  | { ok: false; kind: 'invalid'; message: string };

function invalid(message: string): Extract<LegacyRestorePlan, { ok: false; kind: 'invalid' }> {
  return { ok: false, kind: 'invalid', message };
}

/**
 * 生成一份完整快照（深拷贝，之后数据库里再改原对象也不会影响它）。
 * 这里刻意不调用任何脱敏 / 截断：长令牌、URL、未知字段都按原样保存，恢复才谈得上完整。
 */
export function buildLegacySnapshot(input: {
  characterId: string;
  revision: number;
  source: 'save' | 'restore';
  operatorUserId: string | null;
  note: string | null;
  name: string;
  searchText: string;
  legacyCard: Record<string, unknown>;
  avatarMediaId: string | null;
  avatarDisplay: Record<string, unknown>;
  lorebook: readonly AdminLegacyLorebookEntry[];
  examples: readonly AdminLegacyDialogueExample[];
  now: Date;
}): LegacySnapshotData {
  const fields = readLegacyAdminFields(input.legacyCard);
  return {
    characterId: input.characterId,
    revision: input.revision,
    source: input.source,
    operatorUserId: input.operatorUserId,
    note: input.note,
    name: input.name,
    searchText: input.searchText,
    aliases: [...fields.aliases],
    signature: fields.signature,
    legacyCard: structuredClone(input.legacyCard),
    avatarMediaId: input.avatarMediaId,
    avatarDisplay: structuredClone(input.avatarDisplay),
    lorebook: input.lorebook.map((entry) => ({
      id: entry.id,
      payload: structuredClone(entry.payload),
    })),
    examples: input.examples.map((entry) => ({
      id: entry.id,
      sortOrder: entry.sortOrder,
      payload: structuredClone(entry.payload),
    })),
    createdAt: input.now,
  };
}

function duplicateIds(rows: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) duplicated.add(row.id);
    else seen.add(row.id);
  }
  return [...duplicated];
}

/**
 * 计算一次恢复：只允许恢复到更早的快照；写新 revision，并在恢复前存一份「恢复前」快照。
 * 目标快照必须属于同一个角色（外来角色的版本直接拒绝）。
 */
export function planLegacyRestore(input: {
  current: LegacyCurrentState;
  expectedRevision: number;
  target: LegacySnapshotData;
  operatorUserId: string | null;
  note: string | null;
  now: Date;
}): LegacyRestorePlan {
  const { current, target } = input;
  if (current.revision !== input.expectedRevision)
    return {
      ok: false,
      kind: 'conflict',
      message: `角色已被其他人修改（当前版本 ${current.revision}），请刷新后重试`,
      currentRevision: current.revision,
    };
  if (target.characterId !== current.characterId)
    return invalid('这版快照不属于当前角色，已拒绝恢复');
  if (target.revision >= current.revision) return invalid('只能恢复到当前版本之前的快照');
  if (
    !target.legacyCard ||
    typeof target.legacyCard !== 'object' ||
    Array.isArray(target.legacyCard)
  )
    return invalid('快照内容缺失，无法恢复');
  if (!parseLegacyCard(target.legacyCard)) return invalid('快照不是可用的旧卡内容');
  const lorebookDuplicates = duplicateIds(target.lorebook);
  if (lorebookDuplicates.length)
    return invalid(`快照里的世界书条目 id 重复：${lorebookDuplicates.join('、')}`);
  const exampleDuplicates = duplicateIds(target.examples);
  if (exampleDuplicates.length)
    return invalid(`快照里的对话示例 id 重复：${exampleDuplicates.join('、')}`);

  const before = buildLegacySnapshot({
    characterId: current.characterId,
    revision: current.revision,
    source: 'restore',
    operatorUserId: input.operatorUserId,
    note: input.note,
    name: current.name,
    searchText: current.searchText,
    legacyCard: current.legacyCard,
    avatarMediaId: current.avatarMediaId,
    avatarDisplay: current.avatarDisplay,
    lorebook: current.lorebook,
    examples: current.examples,
    now: input.now,
  });
  return {
    ok: true,
    value: {
      revision: current.revision + 1,
      before,
      state: {
        legacyCard: structuredClone(target.legacyCard),
        name: target.name || legacyDisplayName(target.legacyCard),
        searchText: target.searchText || legacySearchText(target.legacyCard),
        avatarMediaId: target.avatarMediaId,
        avatarDisplay: structuredClone(target.avatarDisplay),
        lorebook: target.lorebook.map((entry) => ({
          id: entry.id,
          payload: structuredClone(entry.payload),
        })),
        examples: target.examples.map((entry) => ({
          id: entry.id,
          sortOrder: entry.sortOrder,
          payload: structuredClone(entry.payload),
        })),
      },
    },
  };
}

/**
 * 快照里的条目 id 如果当前属于别的角色，恢复会覆盖别人的数据 —— 返回这些 id 让调用方拒绝。
 * 正常情况下快照只含本角色条目，这里是恢复前的最后一道保险。
 */
export function foreignEntryIds(
  rows: readonly { id: string; characterId: string }[],
  characterId: string,
): string[] {
  return rows.filter((row) => row.characterId !== characterId).map((row) => row.id);
}
