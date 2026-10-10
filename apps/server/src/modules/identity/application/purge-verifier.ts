/**
 * 注销核验（T-080，security-and-privacy.md 第 6 节「注销后查不到」；脚本 scripts/verify-user-purged）。
 *
 * 四类检查，全部通过才算删干净：
 * 1. 删除清单：每个登记模块的 countUserData(userId) 必须为 0。
 * 2. 全库扫描：所有业务 schema 里类型为 uuid 的列（以及 text 类型、名字像用户引用的列）中，
 *    值等于该用户 ID 的行数必须为 0。不依赖各模块自己写的计数，能发现漏登记的表。
 *    UUID 不会撞号，所以出现即是残留引用。
 * 3. 平台表：审计记录不含明文用户 ID；发件箱里已送达的事件不含该用户 ID（未送达的单列提示）；数据密钥已删除；账号行已删除。
 * 4. 对象存储：不存在没有元数据行对应的孤儿文件（存储键不按用户分目录，见 MediaStorageAudit）。
 *
 * 只输出条数与表名，不输出任何内容。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_LOG,
  DATABASE,
  OUTBOX,
  USER_DATA_REGISTRY,
  type AuditLog,
  type Database,
  type Outbox,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { MEDIA_STORAGE_AUDIT, type MediaStorageAudit } from '../../media/index.js';

export interface PurgeCheck {
  /** 检查项名称，如 module:chat、table:chat.messages.owner_user_id、platform:audit_log、storage:orphans */
  name: string;
  count: number;
  /** false = 只提示不判失败（例如尚未送达的事件、存储不支持列举）。 */
  blocking: boolean;
  note?: string;
}

export interface PurgeReport {
  userId: string;
  ok: boolean;
  checks: PurgeCheck[];
}

/** 不扫描的 schema：系统表、任务队列（pg-boss 自带保留期清理，任务数据只放 ID）。 */
const SKIPPED_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'pg_toast',
  'pgboss',
  'drizzle',
  'public',
];
/** text 类型但存放用户 ID 的列名（uuid 列全部扫描）。 */
const TEXT_USER_COLUMNS = [
  'owner',
  'actor_id',
  'target_id',
  'ref_id',
  'author_ref_id',
  'actor_ref_id',
  'sender_ref_id',
  'user_id',
];
/** 已由第 3 类单独检查的列。 */
const HANDLED = new Set([
  'platform.audit_log.actor_id',
  'platform.audit_log.target_id',
  'platform.user_data_keys.owner',
]);

@Injectable()
export class PurgeVerifier {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(MEDIA_STORAGE_AUDIT) private readonly storage: MediaStorageAudit,
  ) {}

  async verify(userId: string): Promise<PurgeReport> {
    const checks: PurgeCheck[] = [];

    // 1. 删除清单
    for (const { module, count } of await this.registry.countAll(userId))
      checks.push({ name: `module:${module}`, count, blocking: true });

    // 2. 全库扫描
    const { rows: columns } = await this.database.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `SELECT c.table_schema, c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema <> ALL($1::text[])
          AND (c.data_type = 'uuid' OR (c.data_type = 'text' AND c.column_name = ANY($2::text[])))
        ORDER BY 1, 2, 3`,
      [SKIPPED_SCHEMAS, TEXT_USER_COLUMNS],
    );
    for (const col of columns) {
      const key = `${col.table_schema}.${col.table_name}.${col.column_name}`;
      if (HANDLED.has(key)) continue;
      const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const { rows } = await this.database.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${ident(col.table_schema)}.${ident(col.table_name)}
          WHERE ${ident(col.column_name)}${col.data_type === 'uuid' ? '' : '::text'} = $1::${col.data_type === 'uuid' ? 'uuid' : 'text'}`,
        [userId],
      );
      const count = Number(rows[0]?.n ?? 0);
      // 只列出有残留的列，避免输出几百行 0
      if (count > 0) checks.push({ name: `table:${key}`, count, blocking: true });
    }
    checks.push({
      name: 'table:*（全库 uuid 列扫描）',
      count: 0,
      blocking: true,
      note: `已扫描 ${columns.length} 列`,
    });

    // 3. 平台表
    const one = async (sqlText: string) =>
      Number((await this.database.query<{ n: string }>(sqlText, [userId])).rows[0]?.n ?? 0);
    checks.push({
      name: 'platform:identity.users',
      count: await one('SELECT count(*) AS n FROM identity.users WHERE id = $1::uuid'),
      blocking: true,
    });
    checks.push({
      name: 'platform:user_data_keys',
      count: await one('SELECT count(*) AS n FROM platform.user_data_keys WHERE owner = $1::text'),
      blocking: true,
    });
    checks.push({
      name: 'platform:audit_log（明文用户 ID）',
      count: await this.audit.countPlainUser(userId),
      blocking: true,
    });
    const events = await this.outbox.countMentioning(this.database, userId);
    checks.push({ name: 'platform:outbox（已送达事件）', count: events.delivered, blocking: true });
    checks.push({
      name: 'platform:outbox（未送达事件）',
      count: events.pending,
      blocking: false,
      note: '送达后由注销收尾任务清理（完成时一次、1 小时后再一次）',
    });

    // 4. 对象存储
    const storage = await this.storage.findOrphanKeys();
    checks.push(
      storage.listed
        ? {
            name: 'storage:orphans（无元数据的文件）',
            count: storage.orphans.length,
            blocking: true,
            note: `存储中共 ${storage.total} 个文件；10 分钟内的上传中文件可能短暂出现`,
          }
        : {
            name: 'storage:orphans',
            count: 0,
            blocking: false,
            note: '存储驱动不支持列举，未核验',
          },
    );

    return { userId, ok: checks.every((c) => !c.blocking || c.count === 0), checks };
  }
}
