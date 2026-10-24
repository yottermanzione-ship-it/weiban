/**
 * 后台彻底删除角色时，各模块清理自己数据的登记处。
 *
 * characters 不能 import 其它业务模块（会形成循环依赖），也不能直接写别人的 schema（R8）。
 * 拥有角色关联数据的模块在启动时登记一个 contributor：影响面计数、可选的阻塞检查、以及在同一事务内
 * 按 character_id 删除本模块数据。characters 只负责加锁、计数、调用全部 contributor、写审计并删除
 * 角色行；所有清理与角色行删除在同一个平台事务里，任何一个失败整体回滚。
 */
import type { DbTx } from '../db/database.js';

export const CHARACTER_PURGE_REGISTRY = Symbol('weiban.platform.character-purge-registry');

/** 影响面计数；模块只填自己负责的项，未填按 0 计。 */
export interface CharacterPurgeCounts {
  contacts: number;
  conversations: number;
  messages: number;
  moments: number;
}

export interface CharacterPurgeContributor {
  /** 模块名，用于重复登记检查与排错。 */
  module: string;
  /** 影响面查询；传 tx 时用同一事务读，保证与删除前口径一致。 */
  count?(characterId: string, tx?: DbTx): Promise<Partial<CharacterPurgeCounts>>;
  /** 有不能自动清理的引用时抛 AppError('conflict', 原因)；不能静默跳过。 */
  assertAllowed?(characterId: string): Promise<void>;
  /** 在调用方事务内删除本模块与角色相关的数据。 */
  purge(tx: DbTx, characterId: string): Promise<void>;
}

export class CharacterPurgeRegistry {
  private readonly contributors = new Map<string, CharacterPurgeContributor>();

  register(contributor: CharacterPurgeContributor): void {
    if (this.contributors.has(contributor.module))
      throw new Error(`角色彻底删除 contributor 重复登记：${contributor.module}`);
    this.contributors.set(contributor.module, contributor);
  }

  list(): readonly CharacterPurgeContributor[] {
    return [...this.contributors.values()];
  }
}
