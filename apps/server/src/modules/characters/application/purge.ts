/**
 * 后台「彻底删除（硬删）」预设角色。
 *
 * 与现有的「下架（软删）」并存：下架只改 status，数据保留；本服务在**一个事务**内物理删除角色及
 * 其关联数据，用于总经理要求的「真正删除」。管理员控制器只允许 admin 调用，入口见
 * `CharacterAdminController` 的 GET `:characterId/purge-impact` 与 DELETE `:characterId?purge=true`。
 *
 * 数据边界（迁移 0135 之后的真实 schema；以 information_schema / pg_constraint 核对）：
 * - 对 characters.characters 有外键的是 10 张表共 11 个约束（relations 的 a / b 两列各一个），
 *   全部 ON DELETE CASCADE：persona_versions、public_updates、relations、work_links、
 *   default_voices、trial_sessions、user_supplements、persona_update_seen、
 *   user_child_feature_flags、eligibility_changes，删角色行时自动清理。
 * - 其余模块的 character_id 列**没有外键**（contacts、chat、moments、growth、play、plaza、
 *   model_access、ai_runtime、calls、health 等）。各模块通过 `CHARACTER_PURGE_REGISTRY` 登记
 *   contributor，在本事务内按 character_id 删除自己的数据；characters 不直接读写别人的 schema。
 * - 计费流水 / 冻结 / 用量 / 分享搜索调用记录保留：它们是财务与审计历史，ledger 还有禁止 DELETE
 *   的触发器，且都允许 character_id 作为历史引用存在（无外键，不会留下外键错误）。同样保留
 *   客服工单、媒体素材对象（平台素材可能被其它角色复用；媒体表没有 character 外键）。宠物相册里
 *   用户上传的照片会由 growth 一并删除；素材库「指定角色」的表情包映射会由 media 从 JSONB 数组移除。
 * - 已发布的人设广场「预设改版」作品依赖该预设角色才能继续应用；由 plaza 的 contributor 检查，
 *   发现时返回 409 并说明数量，要求管理员先在角色广场处理，不静默删除用户作品。
 * - 角色不存在、已删除或不是预设角色时一律 404；仍有未处理外键引用时返回 409，不静默跳过。
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  AdminCharacterPurgeImpact,
  AdminCharacterPurgeResult,
  type AdminCharacterPurgeCounts,
  type CharacterPublishStatus,
} from '@weiban/contracts';
import {
  AppError,
  AUDIT_LOG,
  CHARACTER_PURGE_REGISTRY,
  CLOCK,
  DATABASE,
  type AuditLog,
  type CharacterPurgeCounts,
  type CharacterPurgeRegistry,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { characters } from '../infra/db/schema.js';

const EMPTY_COUNTS: CharacterPurgeCounts = {
  contacts: 0,
  conversations: 0,
  messages: 0,
  moments: 0,
};

@Injectable()
export class CharacterPurgeService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CHARACTER_PURGE_REGISTRY) private readonly registry: CharacterPurgeRegistry,
  ) {}

  /** 影响面查询（只读）：供后台二次确认展示。 */
  async impact(characterId: string): Promise<AdminCharacterPurgeImpact> {
    const row = await this.load(characterId);
    const counts = await this.counts(characterId);
    return AdminCharacterPurgeImpact.parse({
      characterId,
      name: row.name,
      status: row.status as CharacterPublishStatus,
      counts,
    });
  }

  /** 单事务彻底删除；返回删除前的实际影响面。 */
  async purge(adminId: string, characterId: string): Promise<AdminCharacterPurgeResult> {
    try {
      return await this.database.transaction(async (tx) => {
        const row = await this.load(characterId, tx);
        // 先把所有「不能自动清理」的引用检查一遍，再删任何数据：失败时事务里还没有写入。
        for (const contributor of this.registry.list())
          await contributor.assertAllowed?.(characterId);
        const counts = await this.counts(characterId, tx);
        for (const contributor of this.registry.list()) await contributor.purge(tx, characterId);
        // characters 自己的非外键引用：被删除角色的试聊记录不再指向来源角色。
        await tx.query(
          'UPDATE characters.trial_sessions SET source_character_id = NULL WHERE source_character_id = $1',
          [characterId],
        );
        await this.audit.record(
          {
            module: 'characters',
            action: 'character.purged',
            actorType: 'admin',
            actorId: adminId,
            targetType: 'character',
            targetId: characterId,
            details: {
              name: row.name,
              status: row.status,
              // 不用 messages 作键名：审计脱敏会把 messages 当成正文整值打码。
              impact: {
                contacts: counts.contacts,
                conversations: counts.conversations,
                messageCount: counts.messages,
                moments: counts.moments,
              },
            },
          },
          tx,
        );
        await tx.db.delete(characters).where(eq(characters.id, characterId));
        return AdminCharacterPurgeResult.parse({
          characterId,
          purgedAt: this.clock.now().toISOString(),
          counts,
        });
      });
    } catch (error) {
      const constraint = foreignKeyConstraint(error);
      if (constraint)
        throw new AppError('conflict', `该角色仍被其它数据引用，无法彻底删除：${constraint}`, {
          details: { constraint },
          cause: error,
        });
      throw error;
    }
  }

  /** 角色行必须存在且是后台管理的预设角色。 */
  private async load(characterId: string, tx?: DbTx) {
    const db = tx?.db ?? this.database.db;
    const query = db.select().from(characters).where(eq(characters.id, characterId));
    const [row] = await (tx ? query.for('update') : query);
    if (!row || row.kind !== 'preset') throw new AppError('not_found', '找不到角色');
    return row;
  }

  /** 汇总各模块 contributor 的计数；在事务里调用时 contributor 用同一事务读，口径一致。 */
  private async counts(characterId: string, tx?: DbTx): Promise<AdminCharacterPurgeCounts> {
    const counts = { ...EMPTY_COUNTS };
    for (const contributor of this.registry.list()) {
      const part = (await contributor.count?.(characterId, tx)) ?? {};
      counts.contacts += part.contacts ?? 0;
      counts.conversations += part.conversations ?? 0;
      counts.messages += part.messages ?? 0;
      counts.moments += part.moments ?? 0;
    }
    return counts;
  }
}

/** pg 外键冲突（23503）时取出约束名，用于给管理员明确原因而不是 500。 */
function foreignKeyConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const value = error as { code?: unknown; constraint?: unknown };
  if (value.code !== '23503') return null;
  return typeof value.constraint === 'string' && value.constraint
    ? value.constraint
    : '未知外键约束';
}
