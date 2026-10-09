/**
 * 关系网（SOC-01、ADM-02，T-063）。
 * - 预设角色之间：管理员录入，公开依据必填；真人与虚构 / 原创之间不能建关系（SOC-01 第 2 条）。
 * - 自定义角色之间：用户自己设定；任一方是预设角色一律拒绝（SOC-01 第 3 条）。
 * - 一条关系双向生效：存储时规范化为 characterAId < characterBId，查询时两个方向都能命中。
 * - 删除后两人不再互动（ai-runtime 订阅 characters.relation_changed），历史聊天不动。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import {
  AdminRelationWrite,
  CharacterRelation,
  Id,
  RelationCloseness,
  RelationType,
  UserRelationWrite,
  type CharacterRelationReadPort,
} from '@weiban/contracts';
import { z } from 'zod';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  OUTBOX,
  AppError,
  newId,
  parseContract,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { characters, relations } from '../infra/db/schema.js';

type RelationRow = typeof relations.$inferSelect;
type CharacterRow = typeof characters.$inferSelect;

const AdminPatch = AdminRelationWrite.omit({ characterAId: true, characterBId: true }).partial();
const UserPatch = UserRelationWrite.omit({ characterAId: true, characterBId: true }).partial();

const dto = (row: RelationRow): CharacterRelation =>
  CharacterRelation.parse({
    relationId: row.id,
    characterAId: row.characterAId,
    characterBId: row.characterBId,
    type: row.type,
    label: row.label,
    closeness: row.closeness,
    evidence: row.evidence,
    ownerUserId: row.ownerUserId,
    updatedAt: row.updatedAt.toISOString(),
  });

const ordered = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

@Injectable()
export class CharacterRelationService implements CharacterRelationReadPort {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
  ) {}

  // ---------- 只读端口（ai-runtime、moments、识图使用） ----------

  /** 该用户可见的关系：预设之间（owner 为空）+ 该用户为自定义角色设定的。 */
  private visibleTo(userId: string): SQL {
    return or(isNull(relations.ownerUserId), eq(relations.ownerUserId, userId))!;
  }
  async getRelation(
    userId: string,
    characterAId: string,
    characterBId: string,
  ): Promise<CharacterRelation | null> {
    parseContract(Id, userId);
    parseContract(Id, characterAId);
    parseContract(Id, characterBId);
    if (characterAId === characterBId) return null;
    const [a, b] = ordered(characterAId, characterBId);
    const [row] = await this.database.db
      .select()
      .from(relations)
      .where(
        and(eq(relations.characterAId, a), eq(relations.characterBId, b), this.visibleTo(userId)),
      );
    return row ? dto(row) : null;
  }
  async listRelations(userId: string, characterId: string): Promise<CharacterRelation[]> {
    parseContract(Id, userId);
    parseContract(Id, characterId);
    const rows = await this.database.db
      .select()
      .from(relations)
      .where(
        and(
          or(eq(relations.characterAId, characterId), eq(relations.characterBId, characterId)),
          this.visibleTo(userId),
        ),
      )
      .orderBy(relations.createdAt, relations.id);
    return rows.map(dto);
  }

  // ---------- 管理端（ADM-02） ----------

  async adminList(characterId?: string): Promise<{ items: CharacterRelation[] }> {
    if (characterId) parseContract(Id, characterId);
    const rows = await this.database.db
      .select()
      .from(relations)
      .where(
        and(
          isNull(relations.ownerUserId),
          characterId
            ? or(eq(relations.characterAId, characterId), eq(relations.characterBId, characterId))
            : undefined,
        ),
      )
      .orderBy(relations.createdAt, relations.id);
    return { items: rows.map(dto) };
  }
  async adminCreate(adminId: string, input: unknown): Promise<CharacterRelation> {
    const body = parseContract(AdminRelationWrite, input);
    const evidence = body.evidence.trim();
    if (!evidence) throw new AppError('bad_request', '请填写公开依据');
    return this.database.transaction(async (tx) => {
      const [a, b] = await this.pair(tx, body.characterAId, body.characterBId);
      for (const c of [a, b])
        if (c.kind !== 'preset')
          throw new AppError('bad_request', '管理端只能维护预设角色之间的关系');
      const realA = a.basis === 'real_person';
      const realB = b.basis === 'real_person';
      if (realA !== realB) throw new AppError('bad_request', '真人与虚构角色之间不能建立关系');
      const row = await this.insert(tx, {
        a: a.id,
        b: b.id,
        type: body.type,
        label: body.label ?? null,
        closeness: body.closeness,
        evidence,
        ownerUserId: null,
        createdBy: adminId,
      });
      await this.audit.record(
        {
          module: 'characters',
          action: 'relation.created',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'relation',
          targetId: row.id,
        },
        tx,
      );
      await this.changed(tx, row, 'created');
      return dto(row);
    });
  }
  async adminUpdate(
    adminId: string,
    relationId: string,
    input: unknown,
  ): Promise<CharacterRelation> {
    parseContract(Id, relationId);
    const patch = parseContract(AdminPatch, input);
    return this.database.transaction(async (tx) => {
      const current = await this.load(tx, relationId);
      if (current.ownerUserId !== null) throw new AppError('not_found', '关系不存在');
      const row = await this.update(tx, current, {
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.closeness !== undefined ? { closeness: patch.closeness } : {}),
        ...(patch.evidence !== undefined ? { evidence: requireEvidence(patch.evidence) } : {}),
      });
      await this.audit.record(
        {
          module: 'characters',
          action: 'relation.updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'relation',
          targetId: row.id,
        },
        tx,
      );
      await this.changed(tx, row, 'updated');
      return dto(row);
    });
  }
  async adminDelete(adminId: string, relationId: string): Promise<void> {
    parseContract(Id, relationId);
    await this.database.transaction(async (tx) => {
      const [current] = await tx.db.select().from(relations).where(eq(relations.id, relationId));
      if (!current || current.ownerUserId !== null) return;
      await tx.db.delete(relations).where(eq(relations.id, current.id));
      await this.audit.record(
        {
          module: 'characters',
          action: 'relation.deleted',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'relation',
          targetId: current.id,
        },
        tx,
      );
      await this.changed(tx, current, 'deleted');
    });
  }

  // ---------- 用户：自定义角色之间（SOC-01 第 3 条） ----------

  async listMine(userId: string): Promise<{ items: CharacterRelation[] }> {
    parseContract(Id, userId);
    const rows = await this.database.db
      .select()
      .from(relations)
      .where(eq(relations.ownerUserId, userId))
      .orderBy(relations.createdAt, relations.id);
    return { items: rows.map(dto) };
  }
  async createMine(userId: string, input: unknown): Promise<CharacterRelation> {
    const body = parseContract(UserRelationWrite, input);
    return this.database.transaction(async (tx) => {
      const [a, b] = await this.pair(tx, body.characterAId, body.characterBId);
      for (const c of [a, b]) {
        if (c.kind !== 'custom')
          throw new AppError('bad_request', '自定义角色不能与预设角色建立关系');
        if (c.ownerId !== userId) throw new AppError('not_found', '找不到角色');
      }
      const row = await this.insert(tx, {
        a: a.id,
        b: b.id,
        type: body.type,
        label: body.label ?? null,
        closeness: body.closeness,
        evidence: null,
        ownerUserId: userId,
        createdBy: userId,
      });
      await this.changed(tx, row, 'created');
      return dto(row);
    });
  }
  async updateMine(userId: string, relationId: string, input: unknown): Promise<CharacterRelation> {
    parseContract(Id, relationId);
    const patch = parseContract(UserPatch, input);
    return this.database.transaction(async (tx) => {
      const current = await this.load(tx, relationId);
      if (current.ownerUserId !== userId) throw new AppError('not_found', '关系不存在');
      const row = await this.update(tx, current, {
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.closeness !== undefined ? { closeness: patch.closeness } : {}),
      });
      await this.changed(tx, row, 'updated');
      return dto(row);
    });
  }
  async deleteMine(userId: string, relationId: string): Promise<void> {
    parseContract(Id, relationId);
    await this.database.transaction(async (tx) => {
      const [current] = await tx.db.select().from(relations).where(eq(relations.id, relationId));
      if (!current || current.ownerUserId !== userId) return;
      await tx.db.delete(relations).where(eq(relations.id, current.id));
      await this.changed(tx, current, 'deleted');
    });
  }

  // ---------- 内部 ----------

  private async pair(
    tx: DbTx,
    first: string,
    second: string,
  ): Promise<[CharacterRow, CharacterRow]> {
    parseContract(Id, first);
    parseContract(Id, second);
    if (first === second) throw new AppError('bad_request', '不能和自己建立关系');
    const [aId, bId] = ordered(first, second);
    const rows = await tx.db
      .select()
      .from(characters)
      .where(or(eq(characters.id, aId), eq(characters.id, bId)));
    const a = rows.find((r) => r.id === aId);
    const b = rows.find((r) => r.id === bId);
    if (!a || !b) throw new AppError('not_found', '找不到角色');
    return [a, b];
  }
  private async load(tx: DbTx, relationId: string): Promise<RelationRow> {
    const [row] = await tx.db
      .select()
      .from(relations)
      .where(eq(relations.id, relationId))
      .for('update');
    if (!row) throw new AppError('not_found', '关系不存在');
    return row;
  }
  private async insert(
    tx: DbTx,
    v: {
      a: string;
      b: string;
      type: z.infer<typeof RelationType>;
      label: string | null;
      closeness: z.infer<typeof RelationCloseness>;
      evidence: string | null;
      ownerUserId: string | null;
      createdBy: string;
    },
  ): Promise<RelationRow> {
    const at = this.clock.now();
    const [row] = await tx.db
      .insert(relations)
      .values({
        id: newId(),
        characterAId: v.a,
        characterBId: v.b,
        type: v.type,
        label: v.label,
        closeness: v.closeness,
        evidence: v.evidence,
        ownerUserId: v.ownerUserId,
        createdBy: v.createdBy,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AppError('conflict', '这两个角色之间已经有关系了');
    return row;
  }
  private async update(
    tx: DbTx,
    current: RelationRow,
    patch: Partial<Pick<RelationRow, 'type' | 'label' | 'closeness' | 'evidence'>>,
  ): Promise<RelationRow> {
    if (!Object.keys(patch).length) return current;
    const [row] = await tx.db
      .update(relations)
      .set({ ...patch, updatedAt: this.clock.now() })
      .where(eq(relations.id, current.id))
      .returning();
    if (!row) throw new AppError('not_found', '关系不存在');
    return row;
  }
  private async changed(
    tx: DbTx,
    row: RelationRow,
    action: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.outbox.publish(tx, 'characters.relation_changed', 'characters', {
      relationId: row.id,
      characterAId: row.characterAId,
      characterBId: row.characterBId,
      ownerUserId: row.ownerUserId,
      action,
    });
  }
}

function requireEvidence(value: string): string {
  const evidence = value.trim();
  if (!evidence) throw new AppError('bad_request', '请填写公开依据');
  return evidence;
}
