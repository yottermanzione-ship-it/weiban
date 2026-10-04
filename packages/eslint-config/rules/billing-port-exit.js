/**
 * R9 扣费出口唯一：只有 modules/model-access 调用 BillingPort 的
 * estimateAndReserve / settle / release；其他模块只能读 getSpendStatus。
 * billing 模块自己实现这些方法，不检查。
 *
 * settle / release 是常见单词（例如锁的 release()），所以只有当调用对象的名字里
 * 含 billing（如 billingPort.settle、this.billing.release）时才报错；estimateAndReserve 一律报错。
 */
import { STANDARDS_DOC, locate } from './support.js';

const EXEMPT_MODULES = new Set(['model-access', 'billing']);

export default {
  meta: {
    type: 'problem',
    docs: { description: 'R9：只有 model-access 可以冻结 / 结算 / 解冻扣费' },
    schema: [],
    messages: {
      call:
        'R9 扣费出口唯一：只有 modules/model-access 可以调用 BillingPort.{{method}}，其他模块只能读 getSpendStatus。见 ' +
        STANDARDS_DOC,
    },
  },
  create(context) {
    const here = locate(context.filename);
    if (here.kind !== 'module' || EXEMPT_MODULES.has(here.module)) return {};
    const source = context.sourceCode;
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        const method = callee.property.name;
        const isReserve = method === 'estimateAndReserve';
        const isSettleOrRelease =
          (method === 'settle' || method === 'release') &&
          /billing/i.test(source.getText(callee.object));
        if (isReserve || isSettleOrRelease) {
          context.report({ node, messageId: 'call', data: { method } });
        }
      },
    };
  },
};
