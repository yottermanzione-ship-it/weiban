/**
 * 症状标签字典（ADM-04 第 5 条，契约 3.0 HealthTagEndpoints / HealthTagAdminEndpoints）。
 * 管理员只维护标签，看不到任何用户记录；用户记日记时只能选启用中的标签
 * （已存在于该日记里的旧标签允许保留，停用 / 删除的标签在旧记录中照常显示）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { HealthTagAdminEndpoints, SymptomTag } from '@weiban/contracts';
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
import { symptomTags } from '../infra/db/schema.js';

type Tag = z.infer<typeof SymptomTag>;
type PutBody = z.output<NonNullable<typeof HealthTagAdminEndpoints.putSymptomTags.body>>;

@Injectable()
export class SymptomTagService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  async list(onlyEnabled: boolean, tx?: DbTx): Promise<Tag[]> {
    const rows = await (tx ?? this.db).db
      .select()
      .from(symptomTags)
      .where(onlyEnabled ? eq(symptomTags.enabled, true) : undefined)
      .orderBy(asc(symptomTags.sortOrder), asc(symptomTags.name));
    return rows.map((r) => ({ tagId: r.id, name: r.name, order: r.sortOrder, enabled: r.enabled }));
  }

  /** 启用中的标签名集合（记录日记时校验用）。 */
  async enabledNames(tx?: DbTx): Promise<Set<string>> {
    return new Set((await this.list(true, tx)).map((t) => t.name));
  }

  /** 整体保存：带 tagId 的更新，不带的新增，列表外的删除。名字不能重复。 */
  async put(adminId: string, body: PutBody): Promise<{ items: Tag[] }> {
    const names = body.items.map((i) => i.name.trim());
    if (names.some((n) => !n || n.length > 10))
      throw new AppError('bad_request', '标签名为 1～10 个字');
    if (new Set(names).size !== names.length) throw new AppError('bad_request', '标签名不能重复');
    const ids = body.items.map((i) => i.tagId).filter((id): id is string => !!id);
    if (new Set(ids).size !== ids.length) throw new AppError('bad_request', '标签 ID 重复');
    await this.db.transaction(async (tx) => {
      // 锁定整张字典，避免两个管理员同时整体保存互相覆盖出重名。
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('health:symptom_tags',0))");
      const existing = await tx.db.select({ id: symptomTags.id }).from(symptomTags);
      const known = new Set(existing.map((r) => r.id));
      for (const id of ids)
        if (!known.has(id)) throw new AppError('not_found', '标签不存在，请刷新后重试');
      // 先删列表外的，再把保留行改成临时名，避免改名互换时撞唯一索引。
      if (ids.length) await tx.db.delete(symptomTags).where(notInArray(symptomTags.id, ids));
      else await tx.db.delete(symptomTags);
      for (const id of ids)
        await tx.db
          .update(symptomTags)
          .set({ name: `~${id.slice(0, 8)}` })
          .where(eq(symptomTags.id, id));
      const now = this.clock.now();
      for (const [i, item] of body.items.entries()) {
        const values = {
          name: names[i]!,
          sortOrder: item.order,
          enabled: item.enabled,
          updatedAt: now,
        };
        if (item.tagId)
          await tx.db.update(symptomTags).set(values).where(eq(symptomTags.id, item.tagId));
        else await tx.db.insert(symptomTags).values({ id: newId(), createdAt: now, ...values });
      }
      await this.audit.record(
        {
          module: 'health',
          action: 'health.symptom_tags_saved',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'symptom_tags',
          targetId: null,
          details: { count: body.items.length },
        },
        tx,
      );
    });
    return { items: await this.list(false) };
  }
}
