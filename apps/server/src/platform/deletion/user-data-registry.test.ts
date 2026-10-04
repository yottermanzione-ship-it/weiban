import type { UserDataOwner } from '@weiban/contracts';
import { describe, expect, it } from 'vitest';
import { UserDataRegistry } from './user-data-registry.js';

function owner(module: string, count = 0): UserDataOwner {
  return { module, purgeUser: async () => 0, countUserData: async () => count };
}

describe('删除清单登记处', () => {
  it('登记、列出、汇总剩余条数', async () => {
    const registry = new UserDataRegistry();
    registry.register(owner('chat', 3));
    registry.register(owner('billing'));
    expect(registry.modules()).toEqual(['chat', 'billing']);
    expect(await registry.countAll('u')).toEqual([
      { module: 'chat', count: 3 },
      { module: 'billing', count: 0 },
    ]);
  });

  it('模块名必须在契约里，且不能重复登记', () => {
    const registry = new UserDataRegistry();
    expect(() => registry.register(owner('no_such_module'))).toThrow(/ModuleName/);
    registry.register(owner('chat'));
    expect(() => registry.register(owner('chat'))).toThrow(/重复/);
  });

  it('监听者先收到已登记的，再收到之后登记的', () => {
    const registry = new UserDataRegistry();
    registry.register(owner('chat'));
    const seen: string[] = [];
    registry.onRegister((o) => seen.push(o.module));
    registry.register(owner('media'));
    expect(seen).toEqual(['chat', 'media']);
  });
});
