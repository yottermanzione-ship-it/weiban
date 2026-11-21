/**
 * 管理员 API key：创建、列表、作废、校验（迁移 0172）。
 *
 * 跟 sessions 同一套规矩：明文只在创建时返回一次，库里只存 SHA-256 哈希；
 * 作废 = revoked_at 非空（查库时即过滤，立即失效）；scope 限定能调的接口。
 * v1 只有 role-requests:complete 一个 scope，专给角色申请结案的自动化调用用。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  CLOCK,
  DATABASE,
  newId,
  SCOPE_ROLE_REQUESTS_COMPLETE,
  type AuthPrincipal,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import {
  adminApiKeyPrefix,
  generateAdminApiKey,
  hashToken,
  isAdminApiKeyUsable,
} from '../domain/rules.js';
import { adminApiKeys, users } from '../infra/db/schema.js';

export class AdminApiKeyError extends Error {}

export interface CreatedAdminApiKey {
  id: string;
  /** 明文 key，只返回一次；调用方当场取走存入连接器，绝不写文件。 */
  key: string;
  keyPrefix: string;
  name: string;
  scope: string;
  createdBy: string;
}

export interface AdminApiKeySummary {
  id: string;
  name: string;
  scope: string;
  keyPrefix: string;
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

const ALLOWED_SCOPES: readonly string[] = [SCOPE_ROLE_REQUESTS_COMPLETE];

@Injectable()
export class AdminApiKeyService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 创建一把 key：生成明文、只存哈希、返回明文一次。 */
  async create(name: string, scope: string, createdBy: string): Promise<CreatedAdminApiKey> {
    if (!name.trim()) throw new AdminApiKeyError('用途名不能为空');
    if (!ALLOWED_SCOPES.includes(scope)) {
      throw new AdminApiKeyError(`不支持的作用域 ${scope}`);
    }
    const [creator] = await this.database.db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, createdBy));
    if (!creator || creator.role !== 'admin' || creator.status !== 'active') {
      throw new AdminApiKeyError('创建者必须是有效的管理员账号');
    }
    const key = generateAdminApiKey();
    const id = newId();
    const now = this.clock.now();
    await this.database.db.insert(adminApiKeys).values({
      id,
      name: name.trim(),
      keyHash: hashToken(key),
      keyPrefix: adminApiKeyPrefix(key),
      scope,
      createdBy,
      createdAt: now,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    });
    return { id, key, keyPrefix: adminApiKeyPrefix(key), name: name.trim(), scope, createdBy };
  }

  /** 列出全部 key（不含明文）。 */
  async list(): Promise<AdminApiKeySummary[]> {
    const rows = await this.database.db
      .select()
      .from(adminApiKeys)
      .orderBy(desc(adminApiKeys.createdAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      scope: row.scope,
      keyPrefix: row.keyPrefix,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    }));
  }

  /** 作废一把 key（置 revoked_at，立即失效）；不存在或已作废返回 false。 */
  async revoke(id: string): Promise<boolean> {
    const now = this.clock.now();
    const updated = await this.database.db
      .update(adminApiKeys)
      .set({ revokedAt: now })
      .where(and(eq(adminApiKeys.id, id), isNull(adminApiKeys.revokedAt)))
      .returning({ id: adminApiKeys.id });
    return updated.length > 0;
  }

  /**
   * 校验一把 API key（SessionService.verify 查不到会话时调）：
   * 按哈希查 key，未作废、未过期、创建者仍是有效管理员才返回管理员身份；
   * 命中后更新 last_used_at（更新失败不影响本次请求）。
   */
  async verifyApiKey(token: string): Promise<AuthPrincipal | null> {
    const now = this.clock.now();
    const [row] = await this.database.db
      .select({
        id: adminApiKeys.id,
        scope: adminApiKeys.scope,
        expiresAt: adminApiKeys.expiresAt,
        revokedAt: adminApiKeys.revokedAt,
        createdBy: adminApiKeys.createdBy,
        role: users.role,
        status: users.status,
        bannedAt: users.bannedAt,
      })
      .from(adminApiKeys)
      .leftJoin(users, eq(users.id, adminApiKeys.createdBy))
      .where(eq(adminApiKeys.keyHash, hashToken(token)));
    if (!row) return null;
    if (!isAdminApiKeyUsable(row, now)) return null;
    // 创建者被删 / 降权 / 封禁后，key 不可用（fail-closed）。
    if (!row.createdBy || row.role !== 'admin' || row.status !== 'active' || row.bannedAt) {
      return null;
    }
    try {
      await this.database.db
        .update(adminApiKeys)
        .set({ lastUsedAt: now })
        .where(eq(adminApiKeys.id, row.id));
    } catch {
      // last_used_at 写失败不影响本次请求。
    }
    return {
      userId: row.createdBy,
      sessionId: row.id,
      role: 'admin',
      adminSession: true,
      scope: row.scope,
    };
  }
}
