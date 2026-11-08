import { test as base } from '@playwright/test';

export * from '@playwright/test';

/**
 * 端到端测试共用的 test：默认把新手引导记为「已自动弹过」。
 *
 * 新手引导（onboarding-guide.tsx）第一次进私聊页、第一次进服务页（会员）、第一次下拉小程序时会自动弹出，
 * 遮罩会挡住其他用例的点击。引导兼容本机 localStorage `weiban:guided-tour:v1:<用户ID>`，并导入账号端，
 * 用户 ID 由测试服务器临时生成，没法像 permissions-onboarded 那样写进 storage-state.json；
 * 所以在页面脚本运行前包一层 localStorage 读取：这类键还没有值时，当作三个引导都已弹过。
 * 只影响测试账号，生产代码不变；专门测自动弹出的 guides.spec.ts 使用独立账号，
 * 并直接用 @playwright/test，不经过这里，避免其他测试导入的已见状态干扰首次引导。
 */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.addInitScript(() => {
      const prefix = 'weiban:guided-tour:v1:';
      const seen = JSON.stringify({
        completed: [],
        paused: null,
        shown: ['scenario', 'miniapps', 'ecology'],
        tier: null,
      });
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (this: Storage, key: string) {
        const value = getItem.call(this, key);
        return value === null && key.startsWith(prefix) ? seen : value;
      };
    });
    await provide(context);
  },
});
