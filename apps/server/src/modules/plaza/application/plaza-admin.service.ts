/**
 * 人设广场管理端（契约 PlazaAdminEndpoints，ADM-09），T-087。所有操作原因必填并写审计（ADM-09 第 7 条）。
 *
 * 更严更正（ADM-09 第 6 条、hard-boundaries.md 第 6 节第 6 条）：
 *   目标分类先经 policy 判定「不比当前宽」，否则 422 plaza_classification_loosened；
 *   作品追加一个新版本（版本只增不改，更新说明「管理员更正分类」），然后顺着 adoptions 与改编链（origin_work_id）
 *   找到全部下游：改编作品同样追加更正版本，复制得到的角色逐个调用 CharacterPlazaPort.tightenClassification；
 *   characters 照常发 characters.character_classification_changed，ai-runtime 立即退出成人模式并提示。
 *   应用改版的预设角色不在此列（补充设定不影响分类，预设分类由管理员在角色库维护）。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  AdminPlazaReport,
  AdminPlazaWork,
  AgeSetting,
  CharacterBasis,
  PlazaWorkKind,
  PlazaWorkStatus,
  RealPersonKind,
  Timestamp,
  type PlazaSnapshotClassification,
} from '@weiban/contracts';
import { z } from 'zod';
import {
  AUDIT_LOG,
  AppError,
  OUTBOX,
  parseContract,
  type AuditLog,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import {
  decodeOffset,
  encodeOffset,
  mergeStricter,
  toClassificationInput,
  toFacts,
} from '../domain/rules.js';
import {
  adoptions,
  bans,
  comments,
  reports,
  workVersions,
  works,
  type ReportRow,
  type WorkRow,
} from '../infra/db/schema.js';
import {
  PLAZA_CHARACTERS,
  PLAZA_CLASSIFICATION_POLICY,
  type PlazaCharacters,
  type PlazaClassificationPolicy,
} from '../tokens.js';
import { PlazaService } from './plaza.service.js';
import { PlazaStore } from './plaza-store.js';

type AdminWorkDto = z.infer<typeof AdminPlazaWork>;
type AdminReportDto = z.infer<typeof AdminPlazaReport>;

const PAGE = 20;

const ListQuery = z.object({
  authorUserId: z.uuid().optional(),
  kind: PlazaWorkKind.optional(),
  basis: CharacterBasis.optional(),
  status: PlazaWorkStatus.optional(),
  minReports: z.coerce.number().int().nonnegative().optional(),
  cursor: z.string().optional(),
});
const Reason = z.object({ reason: z.string().trim().min(1).max(200) });
const TightenBody = z.object({
  basis: CharacterBasis,
  realPersonKind: RealPersonKind.nullable(),
  ageSetting: AgeSetting,
  childAppearance: z.boolean(),
  reason: z.string().trim().min(1).max(200),
});
const ResolveBody = z.object({
  action: z.enum(['dismiss', 'remove_work', 'delete_comment']),
  reason: z.string().trim().min(1).max(200),
});
const BanBody = z.object({
  until: z.union([Timestamp, z.literal('permanent')]),
  reason: z.string().trim().min(1).max(200),
});

const TIGHTEN_NOTE = '管理员更正分类';

@Injectable()
export class PlazaAdminService {
  constructor(
    @Inject(PlazaStore) private readonly store: PlazaStore,
    @Inject(PlazaService) private readonly plaza: PlazaService,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Optional() @Inject(PLAZA_CHARACTERS) private readonly characters?: PlazaCharacters,
    @Optional()
    @Inject(PLAZA_CLASSIFICATION_POLICY)
    private readonly policy?: PlazaClassificationPolicy,
  ) {}

  private get db() {
    return this.store.db;
  }
  private get clock() {
    return this.store.clock;
  }

  // ---------- 作品 ----------

  private reportCountSql() {
    return sql<number>`(select count(*)::int from ${reports} where ${reports.workId} = ${works.id})`;
  }

  async listWorks(adminId: string, input: unknown) {
    const q = parseContract(ListQuery, input);
    const offset = decodeOffset(q.cursor);
    const conds = [];
    if (q.authorUserId) conds.push(eq(works.authorUserId, q.authorUserId));
    if (q.kind) conds.push(eq(works.kind, q.kind));
    if (q.basis) conds.push(eq(works.basis, q.basis));
    if (q.status === 'author_banned') conds.push(sql`not (${this.store.notBannedCond()})`);
    else if (q.status) conds.push(eq(works.status, q.status));
    if (q.minReports !== undefined) conds.push(gte(this.reportCountSql(), q.minReports));
    const rows = await this.db.db
      .select()
      .from(works)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(works.publishedAt), desc(works.id))
      .limit(PAGE + 1)
      .offset(offset);
    return {
      items: await this.adminDtos(adminId, rows.slice(0, PAGE)),
      nextCursor: rows.length > PAGE ? encodeOffset(offset + PAGE) : null,
    };
  }

  private async adminDtos(adminId: string, rows: WorkRow[]): Promise<AdminWorkDto[]> {
    if (!rows.length) return [];
    const details = await this.store.details(adminId, rows);
    const counts = await this.db.db
      .select({ workId: reports.workId, n: sql<number>`count(*)::int` })
      .from(reports)
      .where(
        inArray(
          reports.workId,
          rows.map((r) => r.id),
        ),
      )
      .groupBy(reports.workId);
    const countMap = new Map(counts.map((c) => [c.workId, c.n]));
    return rows.map((w, i) => ({
      ...details[i]!,
      authorUserId: w.authorUserId,
      reportCount: countMap.get(w.id) ?? 0,
      removedReason: w.removedReason,
    }));
  }

  private async adminDto(adminId: string, workId: string): Promise<AdminWorkDto> {
    const w = await this.store.work(workId);
    if (!w) throw new AppError('not_found', '作品不存在');
    return (await this.adminDtos(adminId, [w]))[0]!;
  }

  async getWorkVersion(workId: string, version: number) {
    const v = await this.store.version(workId, version);
    if (!v) throw new AppError('not_found', '版本不存在');
    return { snapshot: v.snapshot, settings: v.settings, createdAt: v.createdAt.toISOString() };
  }

  async removeWork(adminId: string, workId: string, input: unknown): Promise<AdminWorkDto> {
    const { reason } = parseContract(Reason, input);
    await this.db.transaction((tx) => this.removeWorkTx(tx, adminId, workId, reason));
    return this.adminDto(adminId, workId);
  }

  private async removeWorkTx(tx: DbTx, adminId: string, workId: string, reason: string) {
    const w = await this.store.lockWork(tx, workId);
    if (!w) throw new AppError('not_found', '作品不存在');
    if (w.status === 'removed_by_admin') return;
    await tx.db
      .update(works)
      .set({ status: 'removed_by_admin', removedReason: reason, updatedAt: this.clock.now() })
      .where(eq(works.id, workId));
    await this.store.notify(
      tx,
      w.authorUserId,
      'work_removed_by_admin',
      workId,
      `你的作品《${w.name}》已被下架，原因：${reason}`,
    );
    await this.outbox.publish(tx, 'plaza.work_removed', 'plaza', {
      workId,
      authorUserId: w.authorUserId,
      reason: 'admin_removed',
    });
    await this.audit.record(
      {
        module: 'plaza',
        action: 'plaza.work_removed',
        actorType: 'admin',
        actorId: adminId,
        targetType: 'plaza_work',
        targetId: workId,
        details: { reason },
      },
      tx,
    );
  }

  async restoreWork(adminId: string, workId: string, input: unknown): Promise<AdminWorkDto> {
    const { reason } = parseContract(Reason, input);
    await this.db.transaction(async (tx) => {
      const w = await this.store.lockWork(tx, workId);
      if (!w) throw new AppError('not_found', '作品不存在');
      if (w.status !== 'removed_by_admin') return;
      await tx.db
        .update(works)
        .set({ status: 'listed', removedReason: null, updatedAt: this.clock.now() })
        .where(eq(works.id, workId));
      await this.store.badgeChanged(tx, w.authorUserId, workId);
      await this.audit.record(
        {
          module: 'plaza',
          action: 'plaza.work_restored',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'plaza_work',
          targetId: workId,
          details: { reason },
        },
        tx,
      );
    });
    return this.adminDto(adminId, workId);
  }

  // ---------- 更严更正 ----------

  async tightenClassification(adminId: string, workId: string, input: unknown) {
    const body = parseContract(TightenBody, input);
    if ((body.basis === 'real_person') !== (body.realPersonKind !== null))
      throw new AppError('bad_request', '真人角色必须选择真人类型，其他分类不能设置真人类型');
    if (!this.policy || !this.characters)
      throw new AppError('service_unavailable', '暂时无法更正分类');
    const w = await this.store.work(workId);
    if (!w) throw new AppError('not_found', '作品不存在');
    if (w.kind !== 'custom_character')
      throw new AppError('bad_request', '预设改版没有自己的分类，请在角色库修改预设角色');
    const current = await this.store.version(w.id, w.currentVersion);
    if (!current?.classification) throw new AppError('internal_error', '作品分类缺失');
    const target: PlazaSnapshotClassification = {
      basis: body.basis,
      realPersonKind: body.realPersonKind,
      ageSetting: body.ageSetting,
      childAppearance: body.childAppearance,
      childFeaturesDetected: current.classification.childFeaturesDetected,
      everPrivatePerson:
        current.classification.everPrivatePerson || body.realPersonKind === 'private_person',
    };
    if (
      this.policy.compareClassification(toFacts(current.classification), toFacts(target)) ===
      'looser'
    )
      throw new AppError('plaza_classification_loosened', '只能往更严的方向更正分类');
    const affected = await this.tightenTree(adminId, w.id, target, body.reason, new Set());
    await this.audit.record({
      module: 'plaza',
      action: 'plaza.classification_tightened',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'plaza_work',
      targetId: workId,
      details: {
        reason: body.reason,
        from: current.classification,
        to: target,
        affectedCharacterCount: affected,
      },
    });
    return { work: await this.adminDto(adminId, workId), affectedCharacterCount: affected };
  }

  /** 对一个作品及其全部下游执行更严更正，返回受影响的角色数。 */
  private async tightenTree(
    adminId: string,
    workId: string,
    target: PlazaSnapshotClassification,
    reason: string,
    visited: Set<string>,
  ): Promise<number> {
    if (visited.has(workId)) return 0;
    visited.add(workId);
    const policy = this.policy!;
    const characters = this.characters!;
    const w = await this.store.work(workId);
    if (!w) return 0;
    const current = await this.store.version(w.id, w.currentVersion);
    if (current?.classification && current.snapshot.kind === 'custom_character') {
      const merged = mergeStricter(current.classification, target);
      const changed = JSON.stringify(merged) !== JSON.stringify(current.classification);
      if (
        changed &&
        policy.compareClassification(toFacts(current.classification), toFacts(merged)) !== 'looser'
      ) {
        const now = this.clock.now();
        const snapshot = {
          ...current.snapshot,
          classification: merged,
          avatarMediaId: merged.basis === 'real_person' ? null : current.snapshot.avatarMediaId,
        };
        await this.db.transaction(async (tx) => {
          const locked = await this.store.lockWork(tx, w.id);
          if (!locked) return;
          const version = locked.currentVersion + 1;
          await tx.db.insert(workVersions).values({
            workId: w.id,
            version,
            snapshot,
            settings: current.settings,
            classification: merged,
            changeNote: TIGHTEN_NOTE,
            createdAt: now,
          });
          await tx.db
            .update(works)
            .set({
              currentVersion: version,
              basis: merged.basis,
              avatarMediaId: merged.basis === 'real_person' ? null : locked.avatarMediaId,
              updatedAt: now,
            })
            .where(eq(works.id, w.id));
          // 下游角色在下面直接更正，已在上一版的复制关系跟到更正版，不再出现「新版本」提示。
          await tx.db
            .update(adoptions)
            .set({ version, updateDismissedVersion: version, updatedAt: now })
            .where(and(eq(adoptions.workId, w.id), eq(adoptions.version, locked.currentVersion)));
          await this.audit.record(
            {
              module: 'plaza',
              action: 'plaza.work_classification_corrected',
              actorType: 'admin',
              actorId: adminId,
              targetType: 'plaza_work',
              targetId: w.id,
              details: { reason, version, classification: merged },
            },
            tx,
          );
        });
      }
    }
    let affected = 0;
    const copies = await this.db.db
      .select({ characterId: adoptions.characterId, userId: adoptions.userId })
      .from(adoptions)
      .where(and(eq(adoptions.workId, w.id), eq(adoptions.kind, 'copy')));
    for (const c of copies) {
      const cur = await characters.getSnapshotClassification(c.characterId);
      if (!cur) continue;
      const merged = mergeStricter(cur, target);
      if (JSON.stringify(merged) === JSON.stringify(cur)) continue;
      const r = await characters.tightenClassification(
        c.characterId,
        toClassificationInput(merged),
        reason,
      );
      if (r.ok) {
        affected += 1;
        await this.audit.record({
          module: 'plaza',
          action: 'plaza.character_classification_corrected',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: c.characterId,
          details: { reason, workId: w.id },
        });
      }
    }
    const remixes = await this.db.db
      .select({ id: works.id })
      .from(works)
      .where(eq(works.originWorkId, w.id));
    for (const r of remixes)
      affected += await this.tightenTree(adminId, r.id, target, reason, visited);
    return affected;
  }

  // ---------- 举报 ----------

  async listReports(input: unknown) {
    const q = parseContract(
      z.object({
        status: z.enum(['pending', 'dismissed', 'actioned']).optional(),
        cursor: z.string().optional(),
      }),
      input,
    );
    const offset = decodeOffset(q.cursor);
    const rows = await this.db.db
      .select()
      .from(reports)
      .where(q.status ? eq(reports.status, q.status) : undefined)
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(PAGE + 1)
      .offset(offset);
    return {
      items: await this.reportDtos(rows.slice(0, PAGE)),
      nextCursor: rows.length > PAGE ? encodeOffset(offset + PAGE) : null,
    };
  }

  private async reportDtos(rows: ReportRow[]): Promise<AdminReportDto[]> {
    const commentIds = rows.filter((r) => r.targetKind === 'comment').map((r) => r.targetId);
    const cs = commentIds.length
      ? await this.db.db.select().from(comments).where(inArray(comments.id, commentIds))
      : [];
    const cMap = new Map(cs.map((c) => [c.id, c]));
    return rows.map((r) => ({
      reportId: r.id,
      reporterUserId: r.reporterUserId,
      target:
        r.targetKind === 'work'
          ? { kind: 'work' as const, workId: r.targetId }
          : {
              kind: 'comment' as const,
              commentId: r.targetId,
              workId: r.workId,
              text: cMap.get(r.targetId)?.text ?? '',
            },
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
  }

  async resolveReport(adminId: string, reportId: string, input: unknown): Promise<AdminReportDto> {
    const body = parseContract(ResolveBody, input);
    const [report] = await this.db.db.select().from(reports).where(eq(reports.id, reportId));
    if (!report) throw new AppError('not_found', '举报不存在');
    if (report.status === 'pending') {
      if (body.action === 'delete_comment' && report.targetKind !== 'comment')
        throw new AppError('bad_request', '这条举报针对的是作品，不能删除评论');
      await this.db.transaction(async (tx) => {
        if (body.action === 'remove_work')
          await this.removeWorkTx(tx, adminId, report.workId, body.reason);
        if (body.action === 'delete_comment')
          await this.plaza.softDeleteComment(report.targetId, report.workId, 'admin', tx);
        const status = body.action === 'dismiss' ? 'dismissed' : 'actioned';
        // 同一对象的其他待处理举报一并处理，并逐一通知举报人（PLZ-07 第 4 条，不显示处理细节）。
        const resolved = await tx.db
          .update(reports)
          .set({
            status,
            resolutionReason: body.reason,
            resolvedBy: adminId,
            resolvedAt: this.clock.now(),
          })
          .where(
            and(
              eq(reports.targetKind, report.targetKind),
              eq(reports.targetId, report.targetId),
              eq(reports.status, 'pending'),
            ),
          )
          .returning();
        const text = status === 'dismissed' ? '你举报的内容经核查未发现问题' : '你举报的内容已处理';
        for (const r of resolved)
          await this.store.notify(tx, r.reporterUserId, 'report_resolved', null, text);
        await this.audit.record(
          {
            module: 'plaza',
            action: 'plaza.report_resolved',
            actorType: 'admin',
            actorId: adminId,
            targetType: 'plaza_report',
            targetId: reportId,
            details: {
              action: body.action,
              reason: body.reason,
              targetKind: report.targetKind,
              targetId: report.targetId,
              resolvedCount: resolved.length,
            },
          },
          tx,
        );
      });
    }
    const [after] = await this.db.db.select().from(reports).where(eq(reports.id, reportId));
    return (await this.reportDtos([after!]))[0]!;
  }

  async deleteComment(adminId: string, commentId: string, input: unknown): Promise<void> {
    const { reason } = parseContract(Reason, input);
    const [c] = await this.db.db.select().from(comments).where(eq(comments.id, commentId));
    if (!c) throw new AppError('not_found', '评论不存在');
    await this.db.transaction(async (tx) => {
      await this.plaza.softDeleteComment(c.id, c.workId, 'admin', tx);
      await this.audit.record(
        {
          module: 'plaza',
          action: 'plaza.comment_deleted',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'plaza_comment',
          targetId: commentId,
          details: { reason, workId: c.workId },
        },
        tx,
      );
    });
  }

  // ---------- 停权 ----------

  async banAuthor(adminId: string, userId: string, input: unknown): Promise<void> {
    const body = parseContract(BanBody, input);
    const permanent = body.until === 'permanent';
    const until = permanent ? null : new Date(body.until);
    if (until && until.getTime() <= this.clock.nowMs())
      throw new AppError('bad_request', '停权结束时间必须晚于现在');
    await this.db.transaction(async (tx) => {
      const now = this.clock.now();
      await tx.db
        .insert(bans)
        .values({
          userId,
          until,
          permanent,
          reason: body.reason,
          createdBy: adminId,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: bans.userId,
          set: { until, permanent, reason: body.reason, createdBy: adminId, createdAt: now },
        });
      const listed = await tx.db
        .select({ id: works.id })
        .from(works)
        .where(and(eq(works.authorUserId, userId), eq(works.status, 'listed')));
      for (const w of listed)
        await this.outbox.publish(tx, 'plaza.work_removed', 'plaza', {
          workId: w.id,
          authorUserId: userId,
          reason: 'author_banned',
        });
      await this.store.badgeChanged(tx, userId, null);
      await this.audit.record(
        {
          module: 'plaza',
          action: 'plaza.author_banned',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'user',
          targetId: userId,
          details: { reason: body.reason, until: body.until },
        },
        tx,
      );
    });
  }

  async unbanAuthor(adminId: string, userId: string, input: unknown): Promise<void> {
    const { reason } = parseContract(Reason, input);
    await this.db.transaction(async (tx) => {
      await tx.db.delete(bans).where(eq(bans.userId, userId));
      await this.store.badgeChanged(tx, userId, null);
      await this.audit.record(
        {
          module: 'plaza',
          action: 'plaza.author_unbanned',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'user',
          targetId: userId,
          details: { reason },
        },
        tx,
      );
    });
  }
}
