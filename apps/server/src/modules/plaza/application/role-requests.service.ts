/**
 * 3.5：角色创建 › 申请制作（总经理 10-14 裁定 2.3；契约 RoleRequestEndpoints / RoleRequestAdminEndpoints）。
 *
 * 状态机：pending →（接单 / 填进度）in_progress →（完成）completed | （拒绝）rejected；pending 可由用户撤回 cancelled。
 * - 完成：关联一个已上架的预设角色（经 CharacterPlazaPort.getOfficialProfile 校验），默认经 ContactsWritePort 走添加流程
 *   加到该用户通讯录（幂等键 = requestId）；通讯录已满等失败时仍标记完成，addedToContacts = false，用户自己点「添加」。
 * - 每次状态变化：写 history、置 user_unseen、发 data.changed(role_requests)，并推送一条 system 通知（deepLink /role-requests/{id}）。
 *   推送失败不影响状态变化（推送在事务提交后发，失败只记日志）。
 * - 扣积分（3.8，总对照表 Q5，默认 200 积分）：提交时经 BillingServiceFeePort 冻结（可用积分不足 → 422 insufficient_balance，
 *   不建申请）；完成时扣除（pointsCharged = pointsCost），被拒或撤回时退回。扣除 / 退回在状态变化提交后调用，
 *   失败只记日志，由每 10 分钟的清扫（PlazaLifecycle）补做，所以钱不会卡在冻结里。
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import {
  CreateRoleRequest,
  RoleRequestConfig,
  RoleRequestStatus,
  type AdminRoleRequest,
  type ContactsWritePort,
  type IdentityDirectoryPort,
  type MediaReadPort,
  type MediaSystemPort,
  type BillingServiceFeePort,
  type PushPort,
  type RoleRequest,
  type SyncPort,
  type Tx,
  pointsToMicros,
} from '@weiban/contracts';
import { z } from 'zod';
import {
  AUDIT_LOG,
  AppError,
  newId,
  parseContract,
  type AuditLog,
  type DbTx,
} from '../../../platform/index.js';
import { BILLING_SERVICE_FEE_PORT } from '../../billing/index.js';
import { CONTACTS_WRITE_PORT } from '../../contacts/index.js';
import { IDENTITY_DIRECTORY_PORT } from '../../identity/index.js';
import { MEDIA_READ_PORT, MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { PUSH_PORT } from '../../push/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { decodeOffset, encodeOffset } from '../domain/rules.js';
import {
  plazaSettings,
  roleRequests,
  type RoleRequestHistoryJson,
  type RoleRequestRow,
  type RoleRequestStatusValue,
} from '../infra/db/schema.js';
import { PLAZA_CHARACTERS, type PlazaCharacters } from '../tokens.js';
import { PlazaStore } from './plaza-store.js';

const CONFIG_KEY = 'role_request_config';
const DEFAULT_CONFIG: RoleRequestConfig = { enabled: true, pointsCost: 200, maxOpenPerUser: 3 };

const ListMineQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const AdminListQuery = z.object({
  status: RoleRequestStatus.optional(),
  userId: z.uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const AdminMessageBody = z.object({ message: z.string().trim().max(500).optional() });
const RequiredMessageBody = z.object({ message: z.string().trim().min(1).max(500) });
const CompleteBody = z.object({
  characterId: z.uuid(),
  message: z.string().trim().max(500).optional(),
  addToContacts: z.boolean().default(true),
});

const STATUS_TEXT: Record<RoleRequestStatusValue, string> = {
  pending: '已提交',
  in_progress: '制作中',
  completed: '已完成',
  rejected: '未通过',
  cancelled: '已撤回',
};

@Injectable()
export class RoleRequestService {
  private readonly logger = new Logger('RoleRequestService');

  constructor(
    @Inject(PlazaStore) private readonly store: PlazaStore,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(MEDIA_READ_PORT) private readonly mediaRead: MediaReadPort,
    @Inject(CONTACTS_WRITE_PORT) private readonly contactsWrite: ContactsWritePort,
    @Optional() @Inject(PUSH_PORT) private readonly push?: PushPort,
    @Optional() @Inject(IDENTITY_DIRECTORY_PORT) private readonly directory?: IdentityDirectoryPort,
    @Optional() @Inject(PLAZA_CHARACTERS) private readonly characters?: PlazaCharacters,
    @Optional() @Inject(BILLING_SERVICE_FEE_PORT) private readonly fees?: BillingServiceFeePort,
  ) {}

  private get db() {
    return this.store.db;
  }
  private get clock() {
    return this.store.clock;
  }

  // ---------- 配置 ----------

  async getConfig(): Promise<RoleRequestConfig> {
    const [row] = await this.db.db
      .select()
      .from(plazaSettings)
      .where(eq(plazaSettings.key, CONFIG_KEY));
    const parsed = RoleRequestConfig.safeParse(row?.value);
    return parsed.success ? parsed.data : DEFAULT_CONFIG;
  }

  async updateConfig(adminId: string, input: unknown): Promise<RoleRequestConfig> {
    const body = parseContract(RoleRequestConfig, input);
    await this.db.transaction(async (tx) => {
      await tx.db
        .insert(plazaSettings)
        .values({ key: CONFIG_KEY, value: body, updatedAt: this.clock.now() })
        .onConflictDoUpdate({
          target: plazaSettings.key,
          set: { value: body, updatedAt: this.clock.now() },
        });
      await this.audit.record(
        {
          module: 'plaza',
          action: 'plaza.role_request_config_updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'plaza_settings',
          targetId: null,
          details: { ...body },
        },
        tx,
      );
    });
    return body;
  }

  // ---------- 用户端 ----------

  async create(userId: string, input: unknown): Promise<RoleRequest> {
    const body = parseContract(CreateRoleRequest, input);
    const existing = await this.byClientId(userId, body.clientRequestId);
    if (existing) return this.toDto(existing);
    const config = await this.getConfig();
    if (!config.enabled) throw new AppError('forbidden', '申请制作暂未开放');
    const imageIds = [...new Set(body.referenceImageIds ?? [])];
    for (const id of imageIds)
      if (!(await this.media.canUse(userId, id, ['role_request_image'])))
        throw new AppError('bad_request', '参考图无效，请重新上传');
    // 先看一眼未完成上限，避免明知会被拒还去冻结积分（事务里还会再查一次）。
    await this.assertOpenBelowLimit(this.db, userId, config.maxOpenPerUser);
    // Q5：先冻结积分（幂等键按 clientRequestId，重试返回同一个冻结），再建申请；建申请失败就退回。
    const cost = config.pointsCost;
    let feeHoldId: string | null = null;
    if (cost > 0) {
      if (!this.fees) throw new AppError('service_unavailable', '积分服务暂不可用，请稍后再试');
      const held = await this.fees.hold({
        userId,
        kind: 'role_request',
        amountMicros: pointsToMicros(cost),
        idempotencyKey: `role_request:${userId}:${body.clientRequestId}`,
        note: `申请制作：${body.roleName}`.slice(0, 100),
      });
      if (!held.ok)
        throw new AppError('insufficient_balance', `积分不足：申请制作需要 ${cost} 积分`, {
          details: { pointsCost: cost },
        });
      feeHoldId = held.value.holdId;
    }
    const now = this.clock.now();
    let row: RoleRequestRow;
    try {
      row = await this.db.transaction(async (tx) => {
        // 同一用户的提交串行化，保证「同时未完成上限」不被并发绕过。
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('plaza:role_request:' || $1, 0))",
          [userId],
        );
        const again = await this.byClientId(userId, body.clientRequestId, tx);
        if (again) return again;
        await this.assertOpenBelowLimit(tx, userId, config.maxOpenPerUser);
        const history: RoleRequestHistoryJson[] = [
          { status: 'pending', message: null, at: now.toISOString(), by: 'user' },
        ];
        const [created] = await tx.db
          .insert(roleRequests)
          .values({
            id: newId(),
            userId,
            clientRequestId: body.clientRequestId,
            roleName: body.roleName,
            basis: body.basis ?? null,
            categoryId: body.categoryId ?? null,
            sourceWork: body.sourceWork ?? '',
            referenceText: body.referenceText ?? '',
            referenceMediaIds: imageIds,
            note: body.note ?? '',
            status: 'pending',
            // Q5：记录当时价格；冻结中，完成时才扣（pointsCharged 届时写入）。
            pointsCost: cost,
            pointsCharged: 0,
            feeHoldId,
            feeState: feeHoldId ? 'held' : 'none',
            history,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await this.changed(tx, userId, created!.id);
        return created!;
      });
    } catch (e) {
      // 没建成申请：退回刚冻结的积分（同一 clientRequestId 已有申请时不会走到这里）。
      if (feeHoldId) await this.fees?.release(feeHoldId).catch(() => undefined);
      throw e;
    }
    return this.toDto(row);
  }

  async listMine(userId: string, input: unknown) {
    const q = parseContract(ListMineQuery, input);
    const offset = decodeOffset(q.cursor);
    const rows = await this.db.db
      .select()
      .from(roleRequests)
      .where(eq(roleRequests.userId, userId))
      .orderBy(desc(roleRequests.createdAt), desc(roleRequests.id))
      .limit(q.limit + 1)
      .offset(offset);
    const page = rows.slice(0, q.limit);
    const [unseen] = await this.db.db
      .select({ n: count() })
      .from(roleRequests)
      .where(and(eq(roleRequests.userId, userId), eq(roleRequests.userUnseen, true)));
    return {
      items: await Promise.all(page.map((r) => this.toDto(r))),
      nextCursor: rows.length > q.limit ? encodeOffset(offset + q.limit) : null,
      unseenCount: unseen?.n ?? 0,
    };
  }

  async get(userId: string, requestId: string): Promise<RoleRequest> {
    const row = await this.own(userId, requestId);
    if (row.userUnseen) {
      await this.db.transaction(async (tx) => {
        await tx.db
          .update(roleRequests)
          .set({ userUnseen: false })
          .where(eq(roleRequests.id, row.id));
        await this.changed(tx, userId, row.id);
      });
      row.userUnseen = false;
    }
    return this.toDto(row);
  }

  async markAllSeen(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const done = await tx.db
        .update(roleRequests)
        .set({ userUnseen: false })
        .where(and(eq(roleRequests.userId, userId), eq(roleRequests.userUnseen, true)))
        .returning({ id: roleRequests.id });
      if (done.length) await this.changed(tx, userId, null);
    });
  }

  async cancel(userId: string, requestId: string): Promise<RoleRequest> {
    await this.own(userId, requestId);
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, requestId);
      if (current.status === 'cancelled') return current;
      if (current.status !== 'pending') throw new AppError('conflict', '官方已开始处理，不能撤回');
      return this.transition(tx, current, 'cancelled', null, 'user', {});
    });
    return this.toDto(await this.syncFee(row));
  }

  // ---------- 管理端 ----------

  async adminList(input: unknown) {
    const q = parseContract(AdminListQuery, input);
    const offset = decodeOffset(q.cursor);
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(roleRequests.status, q.status));
    if (q.userId) conds.push(eq(roleRequests.userId, q.userId));
    const order =
      q.status === 'pending'
        ? [asc(roleRequests.createdAt), asc(roleRequests.id)]
        : [desc(roleRequests.createdAt), desc(roleRequests.id)];
    const rows = await this.db.db
      .select()
      .from(roleRequests)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(...order)
      .limit(q.limit + 1)
      .offset(offset);
    const page = rows.slice(0, q.limit);
    const [pending] = await this.db.db
      .select({ n: count() })
      .from(roleRequests)
      .where(eq(roleRequests.status, 'pending'));
    const names = await this.usernames(page.map((r) => r.userId));
    return {
      items: await Promise.all(page.map((r) => this.toAdminDto(r, names))),
      nextCursor: rows.length > q.limit ? encodeOffset(offset + q.limit) : null,
      pendingCount: pending?.n ?? 0,
    };
  }

  async adminGet(requestId: string): Promise<AdminRoleRequest> {
    const row = await this.find(requestId);
    return this.toAdminDto(row, await this.usernames([row.userId]));
  }

  async accept(adminId: string, requestId: string, input: unknown): Promise<AdminRoleRequest> {
    const { message } = parseContract(AdminMessageBody, input);
    return this.adminTransition(adminId, requestId, 'accept', async (tx, current) => {
      if (current.status === 'in_progress') return current;
      if (current.status !== 'pending') throw this.closed(current);
      return this.transition(tx, current, 'in_progress', message || null, 'admin', {
        handledBy: adminId,
      });
    });
  }

  async progress(adminId: string, requestId: string, input: unknown): Promise<AdminRoleRequest> {
    const { message } = parseContract(RequiredMessageBody, input);
    return this.adminTransition(adminId, requestId, 'progress', async (tx, current) => {
      if (current.status !== 'pending' && current.status !== 'in_progress')
        throw this.closed(current);
      return this.transition(tx, current, 'in_progress', message, 'admin', {
        handledBy: adminId,
      });
    });
  }

  async complete(adminId: string, requestId: string, input: unknown): Promise<AdminRoleRequest> {
    const body = parseContract(CompleteBody, input);
    const before = await this.find(requestId);
    if (before.status === 'completed' && before.characterId === body.characterId)
      return this.adminGet(requestId);
    if (before.status !== 'pending' && before.status !== 'in_progress') throw this.closed(before);
    const official = this.characters?.getOfficialProfile;
    if (!official) throw new AppError('service_unavailable', '角色服务暂不可用');
    const found = await official.call(this.characters, before.userId, body.characterId);
    if (!found) throw new AppError('character_not_available', '该角色不存在或尚未上架');
    // 先走添加流程（有自己的事务与幂等键），再记完成；失败（例如通讯录已满）不阻止完成。
    let added = false;
    if (body.addToContacts) {
      try {
        const r = await this.contactsWrite.addForUser({
          userId: before.userId,
          characterId: body.characterId,
          idempotencyKey: before.id,
        });
        added = r.ok;
      } catch (e) {
        this.logger.warn(`申请 ${before.id} 自动添加角色失败：${String(e)}`);
      }
    }
    return this.adminTransition(adminId, requestId, 'complete', async (tx, current) => {
      if (current.status === 'completed' && current.characterId === body.characterId)
        return current;
      if (current.status !== 'pending' && current.status !== 'in_progress')
        throw this.closed(current);
      const fallback = added
        ? `「${found.profile.name}」已做好，已加到你的通讯录`
        : `「${found.profile.name}」已做好，去角色广场添加 TA 吧`;
      return this.transition(tx, current, 'completed', body.message || fallback, 'admin', {
        handledBy: adminId,
        characterId: body.characterId,
        addedToContacts: added,
      });
    });
  }

  async reject(adminId: string, requestId: string, input: unknown): Promise<AdminRoleRequest> {
    const { message } = parseContract(RequiredMessageBody, input);
    return this.adminTransition(adminId, requestId, 'reject', async (tx, current) => {
      if (current.status === 'rejected') return current;
      if (current.status !== 'pending' && current.status !== 'in_progress')
        throw this.closed(current);
      return this.transition(tx, current, 'rejected', message, 'admin', { handledBy: adminId });
    });
  }

  // ---------- 注销 ----------

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    const rows = await tx.db
      .delete(roleRequests)
      .where(eq(roleRequests.userId, userId))
      .returning({ media: roleRequests.referenceMediaIds });
    for (const r of rows)
      for (const m of r.media) await this.media.deleteObject(m, tx as never).catch(() => undefined);
    return rows.length;
  }

  async countUserData(userId: string): Promise<number> {
    const [r] = await this.db.db
      .select({ n: count() })
      .from(roleRequests)
      .where(eq(roleRequests.userId, userId));
    return r?.n ?? 0;
  }

  // ---------- 积分（Q5） ----------

  /**
   * 按申请状态结清冻结：completed → 扣除；rejected / cancelled → 退回；其余不动。幂等，失败只记日志
   * （清扫任务 sweepFees 会再试）。返回更新后的行。
   */
  async syncFee(row: RoleRequestRow): Promise<RoleRequestRow> {
    if (row.feeState !== 'held' || !row.feeHoldId || !this.fees) return row;
    const action =
      row.status === 'completed'
        ? 'settle'
        : row.status === 'rejected' || row.status === 'cancelled'
          ? 'release'
          : null;
    if (!action) return row;
    try {
      if (action === 'settle') await this.fees.settle(row.feeHoldId);
      else await this.fees.release(row.feeHoldId);
    } catch (e) {
      this.logger.warn(
        `申请 ${row.id} 积分${action === 'settle' ? '扣除' : '退回'}失败：${String(e)}`,
      );
      return row;
    }
    const [next] = await this.db.transaction(async (tx) => {
      const out = await tx.db
        .update(roleRequests)
        .set(
          action === 'settle'
            ? { feeState: 'settled', pointsCharged: row.pointsCost }
            : { feeState: 'released' },
        )
        .where(and(eq(roleRequests.id, row.id), eq(roleRequests.feeState, 'held')))
        .returning();
      if (out.length) await this.changed(tx, row.userId, row.id);
      return out;
    });
    return next ?? (await this.find(row.id));
  }

  /** 清扫：已结束但积分还冻结着的申请（扣除 / 退回调用失败、进程中途退出）。返回处理条数。 */
  async sweepFees(limit = 200): Promise<number> {
    const rows = await this.db.db
      .select()
      .from(roleRequests)
      .where(
        and(
          eq(roleRequests.feeState, 'held'),
          inArray(roleRequests.status, ['completed', 'rejected', 'cancelled']),
        ),
      )
      .limit(limit);
    let n = 0;
    for (const r of rows) if ((await this.syncFee(r)).feeState !== 'held') n += 1;
    return n;
  }

  // ---------- 内部 ----------

  private async assertOpenBelowLimit(
    tx: { db: DbTx['db'] },
    userId: string,
    max: number,
  ): Promise<void> {
    const [open] = await tx.db
      .select({ n: count() })
      .from(roleRequests)
      .where(
        and(
          eq(roleRequests.userId, userId),
          inArray(roleRequests.status, ['pending', 'in_progress']),
        ),
      );
    if ((open?.n ?? 0) >= max)
      throw new AppError('conflict', `你已有 ${max} 个申请在处理中，请等处理完再提交`);
  }

  private closed(row: RoleRequestRow) {
    return new AppError('conflict', `申请已${STATUS_TEXT[row.status]}，不能再修改`);
  }

  private async byClientId(userId: string, clientRequestId: string, tx?: DbTx) {
    const [row] = await (tx ?? this.db).db
      .select()
      .from(roleRequests)
      .where(
        and(eq(roleRequests.userId, userId), eq(roleRequests.clientRequestId, clientRequestId)),
      );
    return row ?? null;
  }

  private async find(requestId: string): Promise<RoleRequestRow> {
    const [row] = await this.db.db
      .select()
      .from(roleRequests)
      .where(eq(roleRequests.id, requestId));
    if (!row) throw new AppError('not_found', '申请不存在');
    return row;
  }

  private async own(userId: string, requestId: string): Promise<RoleRequestRow> {
    const row = await this.find(requestId);
    if (row.userId !== userId) throw new AppError('not_found', '申请不存在');
    return row;
  }

  private async lock(tx: DbTx, requestId: string): Promise<RoleRequestRow> {
    const [row] = await tx.db
      .select()
      .from(roleRequests)
      .where(eq(roleRequests.id, requestId))
      .for('update');
    if (!row) throw new AppError('not_found', '申请不存在');
    return row;
  }

  private async adminTransition(
    adminId: string,
    requestId: string,
    action: string,
    run: (tx: DbTx, current: RoleRequestRow) => Promise<RoleRequestRow>,
  ): Promise<AdminRoleRequest> {
    let notify: RoleRequestRow | null = null;
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, requestId);
      const next = await run(tx, current);
      if (next !== current) {
        notify = next;
        await this.audit.record(
          {
            module: 'plaza',
            action: `plaza.role_request_${action}`,
            actorType: 'admin',
            actorId: adminId,
            targetType: 'plaza_role_request',
            targetId: requestId,
            details: { status: next.status, characterId: next.characterId },
          },
          tx,
        );
      }
      return next;
    });
    if (notify) await this.pushStatus(notify);
    const settled = await this.syncFee(row);
    return this.toAdminDto(settled, await this.usernames([settled.userId]));
  }

  private async transition(
    tx: DbTx,
    current: RoleRequestRow,
    status: RoleRequestStatusValue,
    message: string | null,
    by: 'user' | 'admin',
    extra: Partial<Pick<RoleRequestRow, 'handledBy' | 'characterId' | 'addedToContacts'>>,
  ): Promise<RoleRequestRow> {
    const now = this.clock.now();
    const history = [...current.history, { status, message, at: now.toISOString(), by }].slice(-50);
    const [next] = await tx.db
      .update(roleRequests)
      .set({
        status,
        adminMessage: by === 'admin' && message ? message : current.adminMessage,
        history,
        // 用户自己撤回不需要红点。
        userUnseen: by === 'admin' ? true : current.userUnseen,
        updatedAt: now,
        ...extra,
      })
      .where(eq(roleRequests.id, current.id))
      .returning();
    await this.changed(tx, current.userId, current.id);
    return next!;
  }

  private async changed(tx: DbTx, userId: string, requestId: string | null): Promise<void> {
    await this.sync.appendUpdate(tx as unknown as Tx, userId, {
      type: 'data.changed',
      data: { section: 'role_requests', characterId: null, itemId: requestId },
    });
  }

  private async pushStatus(row: RoleRequestRow): Promise<void> {
    if (!this.push) return;
    const body =
      row.status === 'in_progress'
        ? (row.adminMessage ?? `你申请的「${row.roleName}」已开始制作`)
        : row.status === 'completed'
          ? (row.adminMessage ?? `你申请的「${row.roleName}」已做好`)
          : row.status === 'rejected'
            ? `你申请的「${row.roleName}」未通过：${row.adminMessage ?? ''}`
            : `你申请的「${row.roleName}」${STATUS_TEXT[row.status]}`;
    try {
      await this.push.send({
        userId: row.userId,
        kind: 'system',
        title: '角色制作申请',
        body: body.length > 100 ? `${body.slice(0, 99)}…` : body,
        deepLink: `/role-requests/${row.id}`,
        conversationId: null,
        dedupeKey: `role_request:${row.id}:${row.status}:${row.history.length}`,
        dedupeWindowHours: 1,
        respectsDoNotDisturb: true,
      });
    } catch (e) {
      this.logger.warn(`申请 ${row.id} 推送失败：${String(e)}`);
    }
  }

  private async usernames(userIds: string[]): Promise<Record<string, string>> {
    const ids = [...new Set(userIds)];
    if (!ids.length || !this.directory) return {};
    try {
      return await this.directory.getUsernames(ids);
    } catch {
      return {};
    }
  }

  private async images(row: RoleRequestRow) {
    return Promise.all(
      row.referenceMediaIds.map(async (mediaId) => {
        try {
          return { mediaId, url: (await this.mediaRead.getMedia(row.userId, mediaId)).url };
        } catch {
          return { mediaId, url: null };
        }
      }),
    );
  }

  private async toDto(row: RoleRequestRow): Promise<RoleRequest> {
    return {
      requestId: row.id,
      roleName: row.roleName,
      basis: row.basis,
      categoryId: row.categoryId,
      sourceWork: row.sourceWork,
      referenceText: row.referenceText,
      referenceImages: await this.images(row),
      note: row.note,
      status: row.status,
      adminMessage: row.adminMessage,
      characterId: row.characterId,
      addedToContacts: row.addedToContacts,
      pointsCost: row.pointsCost,
      pointsCharged: row.pointsCharged,
      unseen: row.userUnseen,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async toAdminDto(
    row: RoleRequestRow,
    names: Record<string, string>,
  ): Promise<AdminRoleRequest> {
    return {
      ...(await this.toDto(row)),
      userId: row.userId,
      username: names[row.userId] ?? null,
      handledBy: row.handledBy,
      history: row.history.map((h) => ({ status: h.status, message: h.message, at: h.at })),
    };
  }
}
