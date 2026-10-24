/**
 * 旧角色卡导入计划 → 数据库写入（characters 模块内部）。
 *
 * 只由 CLI 调用；按批提交，失败时已提交批次保留、重跑按旧 id 跳过，做到可续跑。
 * 旧卡整行进 `legacy_card`，世界书 / 示例整行进两张附属表，不做字段转换。
 */
import type { Database } from '../../../platform/index.js';
import { characters, legacyExampleDialogues, legacyLorebookEntries } from '../infra/db/schema.js';
import type { LegacyImportExisting, LegacyImportPlan } from '../domain/legacy-import.js';

function batches<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export interface LegacyImportProgress {
  stage: 'characters' | 'lorebook' | 'examples';
  done: number;
  total: number;
}

/** 读现有 id（dry-run 也走这里，只读）。导入前一次性读入，计划阶段不再查库。 */
export async function readLegacyImportExisting(db: Database): Promise<LegacyImportExisting> {
  const characterRows = await db.query<{ id: string }>(
    'SELECT id::text id FROM characters.characters',
  );
  const lorebookRows = await db.query<{ id: string }>(
    'SELECT id FROM characters.legacy_lorebook_entries',
  );
  const exampleRows = await db.query<{ id: string }>(
    'SELECT id FROM characters.legacy_example_dialogues',
  );
  return {
    characterIds: new Set(characterRows.rows.map((row) => row.id)),
    lorebookIds: new Set(lorebookRows.rows.map((row) => row.id)),
    exampleIds: new Set(exampleRows.rows.map((row) => row.id)),
  };
}

export async function applyLegacyImportPlan(
  db: Database,
  plan: LegacyImportPlan,
  input: { batchSize: number; now: Date; progress?: (event: LegacyImportProgress) => void },
): Promise<void> {
  const { batchSize, now, progress } = input;
  const totalCharacters = plan.characters.toCreate.length;
  let done = 0;
  for (const batch of batches(plan.characters.toCreate, batchSize)) {
    await db.transaction(async (tx) => {
      await tx.db
        .insert(characters)
        .values(
          batch.map((row) => ({
            id: row.id,
            kind: 'preset' as const,
            ownerId: null,
            status: 'published',
            name: row.name,
            searchText: row.searchText,
            categoryId: row.categoryId,
            ...row.classification,
            childFeaturesDetected: row.childFeaturesDetected,
            publishedChildFeaturesDetected: row.childFeaturesDetected,
            everPrivatePerson: false,
            draftCiphertext: null,
            publishedCiphertext: null,
            publishedRevision: null,
            revision: 1,
            personaVersion: 1,
            checks: {
              revision: 1,
              requiredFieldsComplete: false,
              personaStabilityPassed: false,
              hardBoundaryCasesPassed: false,
              hasFallbackGreeting: row.openingMessages.length > 0,
              checked: false,
            },
            legacyCard: row.row,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing({ target: characters.id });
    });
    done += batch.length;
    progress?.({ stage: 'characters', done, total: totalCharacters });
  }

  const totalLorebook = plan.lorebook.toCreate.length;
  done = 0;
  for (const batch of batches(plan.lorebook.toCreate, batchSize)) {
    await db.transaction(async (tx) => {
      await tx.db
        .insert(legacyLorebookEntries)
        .values(
          batch.map((row) => ({
            id: row.id,
            characterId: row.characterId,
            payload: row.payload,
            importedAt: now,
          })),
        )
        .onConflictDoNothing({ target: legacyLorebookEntries.id });
    });
    done += batch.length;
    progress?.({ stage: 'lorebook', done, total: totalLorebook });
  }

  const totalExamples = plan.examples.toCreate.length;
  done = 0;
  for (const batch of batches(plan.examples.toCreate, batchSize)) {
    await db.transaction(async (tx) => {
      await tx.db
        .insert(legacyExampleDialogues)
        .values(
          batch.map((row) => ({
            id: row.id,
            characterId: row.characterId,
            payload: row.payload,
            sortOrder: row.sortOrder,
            importedAt: now,
          })),
        )
        .onConflictDoNothing({ target: legacyExampleDialogues.id });
    });
    done += batch.length;
    progress?.({ stage: 'examples', done, total: totalExamples });
  }
}
