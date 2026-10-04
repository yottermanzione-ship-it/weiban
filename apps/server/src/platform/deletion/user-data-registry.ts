/**
 * 删除清单登记处（security-and-privacy.md 第 5.1 节；契约 ports/common.ts 的 UserDataOwner）。
 *
 * 每个拥有用户数据的模块在启动时（模块类的 onModuleInit）登记自己的删除清单：
 *
 *   this.registry.register({
 *     module: 'chat',                                   // 契约 Events.ModuleName 的取值
 *     purgeUser: async (userId) => { ...物理删除本模块该用户的全部数据，返回删除行数，可重复调用... },
 *     countUserData: async (userId) => { ...返回本模块该用户剩余的数据条数... },
 *   });
 *
 * 注销流程（identity 模块编排，见 docs/backend/identity.md 第 6 节）：
 * identity 发出 identity.user_deletion_requested → 登记处为每个登记的模块自动订阅该事件，
 * 调用 purgeUser 并发布 platform.user_data_purged → identity 收齐所有模块的回报后删除账号本身。
 * 模块不需要自己写订阅者。
 */
import { Events, type UserDataOwner } from '@weiban/contracts';

export const USER_DATA_REGISTRY = Symbol('weiban.platform.user-data-registry');

export class UserDataRegistry {
  private readonly owners = new Map<Events.ModuleName, UserDataOwner>();
  private readonly listeners: Array<(owner: UserDataOwner) => void> = [];

  /** 登记一个模块的删除清单。同一模块只能登记一次。 */
  register(owner: UserDataOwner): void {
    const parsed = Events.ModuleName.safeParse(owner.module);
    if (!parsed.success) {
      throw new Error(`删除清单的模块名 ${owner.module} 不在契约 ModuleName 中`);
    }
    if (this.owners.has(parsed.data)) {
      throw new Error(`模块 ${owner.module} 的删除清单重复登记`);
    }
    this.owners.set(parsed.data, owner);
    for (const listener of this.listeners) listener(owner);
  }

  /** 已登记的全部删除清单（按登记顺序）。 */
  list(): readonly UserDataOwner[] {
    return [...this.owners.values()];
  }

  /** 已登记的模块名。 */
  modules(): Events.ModuleName[] {
    return [...this.owners.keys()];
  }

  /** 编排方（identity）监听新登记：已登记的立即回调一次，之后登记的在登记时回调。 */
  onRegister(listener: (owner: UserDataOwner) => void): void {
    this.listeners.push(listener);
    for (const owner of this.owners.values()) listener(owner);
  }

  /** 验证用：每个模块剩余的数据条数（注销完成后必须全部为 0）。 */
  async countAll(userId: string): Promise<Array<{ module: string; count: number }>> {
    const result: Array<{ module: string; count: number }> = [];
    for (const owner of this.owners.values()) {
      result.push({ module: owner.module, count: await owner.countUserData(userId) });
    }
    return result;
  }
}
