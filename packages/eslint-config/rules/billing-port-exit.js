/**
 * R9 扣费出口唯一（engineering-standards.md 第 3 节 R9 与 3.1，T-014 定方案，T-015 实现）。
 *
 * 思路：不猜变量名，管住「拿到扣费端口」的途径。只看名字本身（被导入的原名、属性名），
 * 与本地变量叫什么无关，所以 `port.settle()`、`billingPort['estimateAndReserve']()` 这类写法都拦得住。
 *
 * 规则 A（主检查）：出现名字 BillingReservationPort 或 BILLING_RESERVATION_PORT 就报错，包括
 *   import / import type / `as` 别名（按原名）、export … from、命名空间访问 c.X（值和类型位置）、
 *   import('…').X 类型、动态导入后解构 { X }、方括号 c['X']。
 * 规则 B（兜底）：出现 estimateAndReserve 这个名字（属性访问 .x、['x']、无插值模板字符串键、
 *   解构 { estimateAndReserve }、作为字符串常量）就报错。settle / release 是常见单词，由规则 A 覆盖。
 * 规则 C：import NestJS 的 ModuleRef（动态按令牌取服务会绕开 import 检查）。
 *
 * 检查范围（按「最严格理解」，见 T-015 交接说明）：
 *   - 规则 A、B：apps/server/src 下全部文件（含模块目录里的单元测试、platform/、src 下其他目录），
 *     豁免 modules/model-access、modules/billing、装配入口 main.ts / app.module.ts。
 *   - 规则 C：apps/server/src 下全部文件（含 model-access、billing），豁免 platform/ 和装配入口。
 *   - apps/server/test/（集成测试，需要直接测计费）三条都豁免。
 */
import { STANDARDS_DOC, locate } from './support.js';

const EXEMPT_MODULES = new Set(['model-access', 'billing']);
const RESERVATION_NAMES = new Set(['BillingReservationPort', 'BILLING_RESERVATION_PORT']);
const RESERVE_METHOD = 'estimateAndReserve';
const MODULE_REF = 'ModuleRef';

/** 字面量形式的「名字」：'x' 字符串或没有插值的 `x` 模板字符串。取不到返回 null。 */
function staticString(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'R9：只有 model-access 可以引用扣费（冻结 / 结算 / 解冻）端口' },
    schema: [],
    messages: {
      reservation:
        'R9 扣费出口唯一：只有 modules/model-access（和 billing 自己）可以引用 {{name}}；其他模块只能用 BillingReadPort.getSpendStatus。见 ' +
        STANDARDS_DOC +
        '（3.1）',
      reserve:
        "R9 扣费出口唯一：只有 modules/model-access 可以使用 estimateAndReserve（含 x.estimateAndReserve、x['estimateAndReserve']、解构）。见 " +
        STANDARDS_DOC +
        '（3.1）',
      moduleRef:
        'R9 扣费出口唯一：除 platform/ 和装配入口外不能使用 NestJS 的 ModuleRef（按令牌动态取服务会绕开模块边界检查），请改用构造函数注入。见 ' +
        STANDARDS_DOC +
        '（3.1）',
    },
  },
  create(context) {
    const here = locate(context.filename);
    if (here.kind === 'outside' || here.kind === 'composition') return {};
    const checkReservation = !(here.kind === 'module' && EXEMPT_MODULES.has(here.module));
    const checkModuleRef = here.kind !== 'platform';
    if (!checkReservation && !checkModuleRef) return {};

    const reported = new Set();
    const report = (node, messageId, data = {}) => {
      const key = `${node.range[0]}:${node.range[1]}:${messageId}`;
      if (reported.has(key)) return;
      reported.add(key);
      context.report({ node, messageId, data });
    };

    /** 对一个「名字」做判断：Identifier 的 name，或字面量键的值。 */
    const checkName = (name, node) => {
      if (checkReservation && RESERVATION_NAMES.has(name)) {
        report(node, 'reservation', { name });
      } else if (checkReservation && name === RESERVE_METHOD) {
        report(node, 'reserve');
      } else if (checkModuleRef && name === MODULE_REF) {
        report(node, 'moduleRef');
      }
    };

    return {
      // 任何位置的标识符：import 原名、导出、类型引用、命名空间属性、TSQualifiedName、解构键、
      // import('…').X 的限定名……统统按名字判断，与本地变量名无关。
      Identifier(node) {
        checkName(node.name, node);
      },
      // import { 'BillingReservationPort' as x }、export { … as 'x' } 这类字符串形式的名字
      ImportSpecifier(node) {
        const name = staticString(node.imported);
        if (name !== null) checkName(name, node.imported);
      },
      ExportSpecifier(node) {
        const name = staticString(node.local);
        if (name !== null) checkName(name, node.local);
      },
      // 方括号访问：x['estimateAndReserve']、c['BillingReservationPort']、x[`estimateAndReserve`]
      MemberExpression(node) {
        if (!node.computed) return;
        const name = staticString(node.property);
        if (name !== null) checkName(name, node.property);
      },
      // 解构 / 对象字面量里的字符串键：const { 'estimateAndReserve': f } = x
      Property(node) {
        const name = staticString(node.key);
        if (name !== null) checkName(name, node.key);
      },
      // 规则 B 的字符串常量兜底：const k = 'estimateAndReserve'; x[k]()、Reflect.get(x, 'estimateAndReserve')
      Literal(node) {
        if (checkReservation && node.value === RESERVE_METHOD) report(node, 'reserve');
      },
      TemplateLiteral(node) {
        if (checkReservation && staticString(node) === RESERVE_METHOD) report(node, 'reserve');
      },
    };
  },
};
