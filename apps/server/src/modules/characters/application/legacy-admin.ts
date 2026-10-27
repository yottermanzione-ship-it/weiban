/**
 * 旧卡后台读写（legacy_card）。
 *
 * 旧卡就是运行格式：这里只读写 `characters.legacy_card` 与两张附属表（世界书 / 示例），
 * 不生成、不读取 WB-Card 密文，不做格式转换，也不动分类、上架状态、角色 ID 与关联数据。
 * 真正的合并 / 校验 / 快照规则在 domain/legacy-admin.ts 与 domain/legacy-revisions.ts（纯函数）；这里负责：
 * - 悲观锁 + expectedRevision 乐观并发保护；
 * - 保存 / 恢复前在**同一事务**里写完整版本快照（characters.legacy_character_revisions，不走审计脱敏）；
 * - 白名单字段与附属表的落库（未提交字段与未识别旧字段原样保留）；
 * - 头像替换（只接受 purpose = character_avatar 的平台素材，用户私有图片不能变公共图）；
 * - 审计只留操作者 / 改了哪些 / 新旧 revision / 快照引用，不把全文塞进通用审计；
 * - 恢复：按同角色快照还原资料，且不还原上架状态与资格标注。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  CharacterDisplay,
  type AdminLegacyCharacterDetail,
  type AdminLegacyCharacterPatch,
  type AdminLegacyRestoreRequest,
  type AdminLegacyRevision,
  type AdminLegacySnapshot,
  type IdentityDirectoryPort,
  type MediaReadPort,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
import { MEDIA_READ_PORT } from '../../media/index.js';
import {
  characters,
  legacyCharacterRevisions,
  legacyExampleDialogues,
  legacyLorebookEntries,
} from '../infra/db/schema.js';
import { parseLegacyCard } from '../domain/legacy-card.js';
import {
  legacyPreservedFields,
  planLegacyAdminUpdate,
  readLegacyAdminFields,
  type LegacyEntryWrite,
} from '../domain/legacy-admin.js';
import {
  buildLegacySnapshot,
  foreignEntryIds as findForeignEntryIds,
  planLegacyRestore,
  type LegacyRestoreState,
  type LegacySnapshotData,
} from '../domain/legacy-revisions.js';
import { legacyAvatarDisplay } from './characters.js';

type Row = typeof characters.$inferSelect;
type RevisionRow = typeof legacyCharacterRevisions.$inferSelect;
/** 附属表写入计划（新建 / 更新 / 删除）。 */
interface EntryWritePlan {
  create: LegacyEntryWrite[];
  update: LegacyEntryWrite[];
  remove: string[];
}
const HISTORY_LIMIT = 20;

@Injectable()
export class CharacterLegacyAdminService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(MEDIA_READ_PORT) private readonly media: MediaReadPort,
    @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory: IdentityDirectoryPort,
  ) {}

  /** 旧卡详情：旧字段 + 未识别字段 + 世界书 + 示例 + 版本历史。 */
  async detail(adminId: string, characterId: string): Promise<AdminLegacyCharacterDetail> {
    const row = await this.load(characterId);
    return this.buildDetail(adminId, row, this.database);
  }

  /** 旧卡局部保存；返回保存后的详情（后台据此读回）。 */
  async patch(
    adminId: string,
    characterId: string,
    body: AdminLegacyCharacterPatch,
  ): Promise<AdminLegacyCharacterDetail> {
    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(characters)
        .where(eq(characters.id, characterId))
        .for('update');
      if (!row) throw new AppError('not_found', '角色不存在');
      const raw = row.legacyCard;
      if (!raw || !parseLegacyCard(raw)) throw this.notLegacy();
      await this.assertAvatar(adminId, body);
      const lorebook = await this.lorebookRows(characterId, tx);
      const examples = await this.exampleRows(characterId, tx);
      const plan = planLegacyAdminUpdate({
        raw,
        currentRevision: row.revision,
        expectedRevision: body.expectedRevision,
        patch: body,
        lorebook,
        examples,
        avatarMediaId: row.avatarMediaId,
        idFactory: newId,
      });
      if (!plan.ok) {
        if (plan.kind === 'conflict')
          throw new AppError('conflict', plan.message, {
            details: { revision: plan.currentRevision },
          });
        throw new AppError('bad_request', plan.message, { status: 422 });
      }
      const update = plan.value;
      if (update.noop) return;
      const now = this.clock.now();
      // 先存「保存前」的完整快照，再改内容：审计里只留快照引用，不再重复存正文。
      await this.insertSnapshot(
        tx,
        buildLegacySnapshot({
          characterId,
          revision: row.revision,
          source: 'save',
          operatorUserId: adminId,
          note: body.note ?? null,
          name: row.name,
          searchText: row.searchText,
          legacyCard: raw,
          avatarMediaId: row.avatarMediaId,
          avatarDisplay: legacyAvatarDisplay(),
          lorebook,
          examples,
          now,
        }),
      );
      const [saved] = await tx.db
        .update(characters)
        .set({
          legacyCard: update.next,
          name: update.name,
          searchText: update.searchText,
          revision: update.revision,
          updatedAt: now,
          avatarMediaId:
            update.avatarMediaId === undefined ? row.avatarMediaId : update.avatarMediaId,
          checks: {
            ...row.checks,
            revision: update.revision,
            hasFallbackGreeting: update.hasFallbackGreeting,
          },
        })
        .where(and(eq(characters.id, characterId), eq(characters.revision, body.expectedRevision)))
        .returning();
      if (!saved) throw new AppError('conflict', '角色已被其他人修改，请刷新后重试');
      await this.writeLorebook(tx, characterId, update.lorebook, now);
      await this.writeExamples(tx, characterId, update.examples, now);
      await this.audit.record(
        {
          module: 'characters',
          action: 'preset.legacy_updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: characterId,
          details: {
            previousRevision: row.revision,
            revision: update.revision,
            changed: update.changedFields,
            snapshotRevision: row.revision,
            note: body.note ?? null,
          },
        },
        tx,
      );
    });
    return this.detail(adminId, characterId);
  }

  /**
   * 恢复到某个旧卡快照版本：写新 revision，恢复前再存一份快照。
   * 不还原上架状态与资格标注，不改角色 ID、联系人、消息；目标快照必须属于本角色。
   */
  async restore(
    adminId: string,
    characterId: string,
    body: AdminLegacyRestoreRequest,
  ): Promise<AdminLegacyCharacterDetail> {
    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(characters)
        .where(eq(characters.id, characterId))
        .for('update');
      if (!row) throw new AppError('not_found', '角色不存在');
      const raw = row.legacyCard;
      if (!raw || !parseLegacyCard(raw)) throw this.notLegacy();
      const [targetRow] = await tx.db
        .select()
        .from(legacyCharacterRevisions)
        .where(
          and(
            eq(legacyCharacterRevisions.characterId, characterId),
            eq(legacyCharacterRevisions.revision, body.revision),
          ),
        );
      if (!targetRow) throw new AppError('not_found', '找不到该版本快照');
      const lorebook = await this.lorebookRows(characterId, tx);
      const examples = await this.exampleRows(characterId, tx);
      const now = this.clock.now();
      const plan = planLegacyRestore({
        current: {
          characterId,
          revision: row.revision,
          name: row.name,
          searchText: row.searchText,
          legacyCard: raw,
          avatarMediaId: row.avatarMediaId,
          avatarDisplay: legacyAvatarDisplay(),
          lorebook,
          examples,
        },
        expectedRevision: body.expectedRevision,
        target: this.snapshotFromRow(targetRow),
        operatorUserId: adminId,
        note: body.note ?? null,
        now,
      });
      if (!plan.ok) {
        if (plan.kind === 'conflict')
          throw new AppError('conflict', plan.message, {
            details: { revision: plan.currentRevision },
          });
        throw new AppError('bad_request', plan.message, { status: 422 });
      }
      // 快照里的条目 id 如果现在挂在别的角色上，宁可不恢复，也不覆盖别人的世界书 / 示例。
      const foreign = await this.foreignEntryOwners(tx, characterId, plan.value.state);
      if (foreign.length)
        throw new AppError(
          'conflict',
          `版本里的世界书 / 示例条目现在属于其它角色，已拒绝恢复：${foreign.join('、')}`,
          { status: 422 },
        );
      await this.insertSnapshot(tx, plan.value.before);
      const [saved] = await tx.db
        .update(characters)
        .set({
          legacyCard: plan.value.state.legacyCard,
          name: plan.value.state.name,
          searchText: plan.value.state.searchText,
          avatarMediaId: plan.value.state.avatarMediaId,
          revision: plan.value.revision,
          updatedAt: now,
          checks: {
            ...row.checks,
            revision: plan.value.revision,
            hasFallbackGreeting:
              (parseLegacyCard(plan.value.state.legacyCard)?.openingMessages.length ?? 0) > 0,
          },
        })
        .where(and(eq(characters.id, characterId), eq(characters.revision, body.expectedRevision)))
        .returning();
      if (!saved) throw new AppError('conflict', '角色已被其他人修改，请刷新后重试');
      await this.replaceEntries(tx, characterId, plan.value.state, now);
      await this.audit.record(
        {
          module: 'characters',
          action: 'preset.legacy_restored',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: characterId,
          details: {
            previousRevision: row.revision,
            revision: plan.value.revision,
            restoredFromRevision: body.revision,
            snapshotRevision: row.revision,
            note: body.note ?? null,
          },
        },
        tx,
      );
    });
    return this.detail(adminId, characterId);
  }

  /** 某个版本快照的完整内容（查看 / 恢复确认）；只查本角色的快照，不含签名 URL。 */
  async revision(
    adminId: string,
    characterId: string,
    revision: number,
  ): Promise<AdminLegacySnapshot> {
    const [row] = await this.database.db
      .select()
      .from(legacyCharacterRevisions)
      .where(
        and(
          eq(legacyCharacterRevisions.characterId, characterId),
          eq(legacyCharacterRevisions.revision, revision),
        ),
      );
    if (!row) throw new AppError('not_found', '找不到该版本快照');
    const operatorName = row.operatorUserId
      ? ((
          await this.directory
            .getUsernames([row.operatorUserId])
            .catch(() => ({}) as Record<string, string>)
        )[row.operatorUserId] ?? '')
      : '';
    const display = CharacterDisplay.safeParse(row.avatarDisplay);
    return {
      characterId,
      revision: row.revision,
      at: row.createdAt.toISOString(),
      source: row.source,
      operatorUserId: row.operatorUserId,
      operatorName,
      note: row.note,
      name: row.name,
      aliases: row.aliases,
      signature: row.signature,
      fields: readLegacyAdminFields(row.legacyCard),
      avatar: {
        mediaId: row.avatarMediaId,
        display: display.success ? display.data : legacyAvatarDisplay(),
      },
      lorebook: row.lorebook,
      examples: row.examples,
    };
  }

  private notLegacy() {
    return new AppError('bad_request', '该角色不是旧卡角色，请用新卡编辑器', { status: 422 });
  }

  private async load(characterId: string): Promise<Row> {
    const [row] = await this.database.db
      .select()
      .from(characters)
      .where(eq(characters.id, characterId));
    if (!row) throw new AppError('not_found', '角色不存在');
    if (!row.legacyCard || !parseLegacyCard(row.legacyCard)) throw this.notLegacy();
    return row;
  }

  /** 头像只接受平台素材（purpose = character_avatar）；用户私有图片不能变成公共角色头像。 */
  private async assertAvatar(adminId: string, body: AdminLegacyCharacterPatch): Promise<void> {
    if (body.avatarMediaId === undefined || body.avatarMediaId === null) return;
    let purpose: string;
    try {
      purpose = (await this.media.getMedia(adminId, body.avatarMediaId)).purpose;
    } catch {
      throw new AppError('bad_request', '头像文件不存在或尚未就绪', { status: 422 });
    }
    if (purpose !== 'character_avatar')
      throw new AppError('bad_request', '请先以角色头像用途上传图片', { status: 422 });
  }

  private lorebookRows(characterId: string, tx?: DbTx) {
    return (tx?.db ?? this.database.db)
      .select()
      .from(legacyLorebookEntries)
      .where(eq(legacyLorebookEntries.characterId, characterId))
      .orderBy(asc(legacyLorebookEntries.id));
  }

  private exampleRows(characterId: string, tx?: DbTx) {
    return (tx?.db ?? this.database.db)
      .select()
      .from(legacyExampleDialogues)
      .where(eq(legacyExampleDialogues.characterId, characterId))
      .orderBy(asc(legacyExampleDialogues.sortOrder), asc(legacyExampleDialogues.id));
  }

  private async buildDetail(
    adminId: string,
    row: Row,
    db: Database,
  ): Promise<AdminLegacyCharacterDetail> {
    const raw = row.legacyCard!;
    const [lorebook, examples, history] = await Promise.all([
      db.db
        .select()
        .from(legacyLorebookEntries)
        .where(eq(legacyLorebookEntries.characterId, row.id))
        .orderBy(asc(legacyLorebookEntries.id)),
      db.db
        .select()
        .from(legacyExampleDialogues)
        .where(eq(legacyExampleDialogues.characterId, row.id))
        .orderBy(asc(legacyExampleDialogues.sortOrder), asc(legacyExampleDialogues.id)),
      this.history(row.id),
    ]);
    return {
      characterId: row.id,
      status: row.status as AdminLegacyCharacterDetail['status'],
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
      name: row.name,
      avatar: {
        image: await this.avatarImage(adminId, row.avatarMediaId),
        display: legacyAvatarDisplay(),
      },
      fields: readLegacyAdminFields(raw),
      preserved: legacyPreservedFields(raw),
      lorebook: lorebook.map((entry) => ({ id: entry.id, payload: entry.payload })),
      examples: examples.map((entry) => ({
        id: entry.id,
        sortOrder: entry.sortOrder,
        payload: entry.payload,
      })),
      history,
    };
  }

  /** 旧卡头像：读不到（媒体缺失 / 已删除）就按默认文字头像处理，不影响详情。 */
  private async avatarImage(
    adminId: string,
    mediaId: string | null,
  ): Promise<AdminLegacyCharacterDetail['avatar']['image']> {
    if (!mediaId) return null;
    try {
      const media = await this.media.getMedia(adminId, mediaId);
      return { mediaId: media.mediaId, url: media.url };
    } catch {
      return null;
    }
  }

  /**
   * 版本历史：元数据来自完整快照表，「改了哪些」从审计里按 previousRevision 对回来。
   * 审计只存字段名与版本号，不存正文，因此这里不会把脱敏后的内容当备份。
   */
  private async history(characterId: string): Promise<AdminLegacyRevision[]> {
    const rows = await this.database.db
      .select({
        revision: legacyCharacterRevisions.revision,
        createdAt: legacyCharacterRevisions.createdAt,
        source: legacyCharacterRevisions.source,
        operatorUserId: legacyCharacterRevisions.operatorUserId,
        note: legacyCharacterRevisions.note,
        name: legacyCharacterRevisions.name,
        aliases: legacyCharacterRevisions.aliases,
        signature: legacyCharacterRevisions.signature,
      })
      .from(legacyCharacterRevisions)
      .where(eq(legacyCharacterRevisions.characterId, characterId))
      .orderBy(desc(legacyCharacterRevisions.revision))
      .limit(HISTORY_LIMIT);
    const changedBy = new Map<number, string[]>();
    const audit = await this.database.query<{ details: Record<string, unknown> | null }>(
      // eslint-disable-next-line weiban/own-schema-only -- 只读审计日志取修改人（既有技术债，应改走 platform 审计端口）
      `SELECT details
         FROM platform.audit_log
        WHERE module = 'characters'
          AND action IN ('preset.legacy_updated', 'preset.legacy_restored')
          AND target_id = $1
        ORDER BY occurred_at DESC
        LIMIT 100`,
      [characterId],
    );
    for (const entry of audit.rows) {
      const details = entry.details ?? {};
      const previous =
        typeof details.previousRevision === 'number' ? details.previousRevision : null;
      if (previous === null || changedBy.has(previous)) continue;
      changedBy.set(
        previous,
        Array.isArray(details.changed)
          ? details.changed.filter((item): item is string => typeof item === 'string')
          : [],
      );
    }
    const operatorIds = [
      ...new Set(rows.flatMap((entry) => (entry.operatorUserId ? [entry.operatorUserId] : []))),
    ];
    const names = operatorIds.length
      ? await this.directory.getUsernames(operatorIds).catch(() => ({}) as Record<string, string>)
      : {};
    return rows.map((entry) => ({
      revision: entry.revision,
      at: entry.createdAt.toISOString(),
      source: entry.source,
      operatorUserId: entry.operatorUserId,
      operatorName: (entry.operatorUserId && names[entry.operatorUserId]) || '',
      name: entry.name,
      aliases: entry.aliases,
      signature: entry.signature,
      changedFields: changedBy.get(entry.revision) ?? [],
      note: entry.note,
    }));
  }

  private snapshotFromRow(row: RevisionRow): LegacySnapshotData {
    return {
      characterId: row.characterId,
      revision: row.revision,
      source: row.source,
      operatorUserId: row.operatorUserId,
      note: row.note,
      name: row.name,
      searchText: row.searchText,
      aliases: row.aliases,
      signature: row.signature,
      legacyCard: row.legacyCard,
      avatarMediaId: row.avatarMediaId,
      avatarDisplay: row.avatarDisplay,
      lorebook: row.lorebook,
      examples: row.examples,
      createdAt: row.createdAt,
    };
  }

  /** 同一事务里先落快照；同一 revision 已有快照说明有人抢先改了，按冲突处理。 */
  private async insertSnapshot(tx: DbTx, snapshot: LegacySnapshotData): Promise<void> {
    const inserted = await tx.db
      .insert(legacyCharacterRevisions)
      .values({
        characterId: snapshot.characterId,
        revision: snapshot.revision,
        source: snapshot.source,
        operatorUserId: snapshot.operatorUserId,
        note: snapshot.note,
        name: snapshot.name,
        searchText: snapshot.searchText,
        aliases: snapshot.aliases,
        signature: snapshot.signature,
        legacyCard: snapshot.legacyCard,
        avatarMediaId: snapshot.avatarMediaId,
        avatarDisplay: snapshot.avatarDisplay,
        lorebook: snapshot.lorebook,
        examples: snapshot.examples,
        createdAt: snapshot.createdAt,
      })
      .onConflictDoNothing()
      .returning({ revision: legacyCharacterRevisions.revision });
    if (!inserted.length)
      throw new AppError('conflict', '该版本已有快照，可能被其他人同时修改，请刷新后重试');
  }

  /** 恢复：整组替换本角色的世界书 / 示例（删除也按 character_id 限定，不碰别的角色）。 */
  private async replaceEntries(
    tx: DbTx,
    characterId: string,
    state: LegacyRestoreState,
    now: Date,
  ): Promise<void> {
    await tx.db
      .delete(legacyLorebookEntries)
      .where(eq(legacyLorebookEntries.characterId, characterId));
    await tx.db
      .delete(legacyExampleDialogues)
      .where(eq(legacyExampleDialogues.characterId, characterId));
    for (const entry of state.lorebook)
      await tx.db.insert(legacyLorebookEntries).values({
        id: entry.id,
        characterId,
        payload: entry.payload,
        importedAt: now,
      });
    for (const entry of state.examples)
      await tx.db.insert(legacyExampleDialogues).values({
        id: entry.id,
        characterId,
        payload: entry.payload,
        sortOrder: entry.sortOrder,
        importedAt: now,
      });
  }

  /** 快照里的条目 id 现在是否挂在别的角色上（恢复前最后一道保险）。 */
  private async foreignEntryOwners(
    tx: DbTx,
    characterId: string,
    state: LegacyRestoreState,
  ): Promise<string[]> {
    const lorebookIds = state.lorebook.map((entry) => entry.id);
    const exampleIds = state.examples.map((entry) => entry.id);
    const rows: Array<{ id: string; characterId: string }> = [];
    if (lorebookIds.length)
      rows.push(
        ...(await tx.db
          .select({ id: legacyLorebookEntries.id, characterId: legacyLorebookEntries.characterId })
          .from(legacyLorebookEntries)
          .where(inArray(legacyLorebookEntries.id, lorebookIds))),
      );
    if (exampleIds.length)
      rows.push(
        ...(await tx.db
          .select({
            id: legacyExampleDialogues.id,
            characterId: legacyExampleDialogues.characterId,
          })
          .from(legacyExampleDialogues)
          .where(inArray(legacyExampleDialogues.id, exampleIds))),
      );
    return findForeignEntryIds(rows, characterId);
  }

  private async writeLorebook(
    tx: DbTx,
    characterId: string,
    plan: EntryWritePlan,
    now: Date,
  ): Promise<void> {
    for (const entry of plan.create)
      await tx.db.insert(legacyLorebookEntries).values({
        id: entry.id,
        characterId,
        payload: entry.payload,
        importedAt: now,
      });
    for (const entry of plan.update)
      await tx.db
        .update(legacyLorebookEntries)
        .set({ payload: entry.payload })
        .where(
          and(
            eq(legacyLorebookEntries.id, entry.id),
            eq(legacyLorebookEntries.characterId, characterId),
          ),
        );
    for (const id of plan.remove)
      await tx.db
        .delete(legacyLorebookEntries)
        .where(
          and(eq(legacyLorebookEntries.id, id), eq(legacyLorebookEntries.characterId, characterId)),
        );
  }

  private async writeExamples(
    tx: DbTx,
    characterId: string,
    plan: EntryWritePlan,
    now: Date,
  ): Promise<void> {
    for (const entry of plan.create)
      await tx.db.insert(legacyExampleDialogues).values({
        id: entry.id,
        characterId,
        payload: entry.payload,
        sortOrder: entry.sortOrder ?? 0,
        importedAt: now,
      });
    for (const entry of plan.update)
      await tx.db
        .update(legacyExampleDialogues)
        .set({ payload: entry.payload, sortOrder: entry.sortOrder ?? 0 })
        .where(
          and(
            eq(legacyExampleDialogues.id, entry.id),
            eq(legacyExampleDialogues.characterId, characterId),
          ),
        );
    for (const id of plan.remove)
      await tx.db
        .delete(legacyExampleDialogues)
        .where(
          and(
            eq(legacyExampleDialogues.id, id),
            eq(legacyExampleDialogues.characterId, characterId),
          ),
        );
  }
}
