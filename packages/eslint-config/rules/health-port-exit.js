/**
 * HealthReadPort 调用方唯一（docs/architecture/health-data.md 第 4 节，T-058 / T-059 登记）。
 *
 * 与 R9 同样「按名字管 import」：出现 HealthReadPort 或 HEALTH_READ_PORT 这两个名字就报错
 * （import / 类型引用 / 命名空间访问 / 字符串形式的导入名都按原名判断）。
 * 豁免：modules/health 自己、modules/ai-runtime（唯一调用方）、装配入口、apps/server/test/ 集成测试。
 */
import { isServerIntegrationTest, locate } from './support.js';

const ALLOWED_MODULES = new Set(['health', 'ai-runtime']);
const NAMES = new Set(['HealthReadPort', 'HEALTH_READ_PORT']);
const DOC = 'docs/architecture/health-data.md';

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
    docs: { description: '只有 ai-runtime 可以引用 HealthReadPort（经期数据只读端口）' },
    schema: [],
    messages: {
      health:
        '经期数据隔离：只有 modules/ai-runtime 可以引用 {{name}}，其他模块（群聊、朋友圈、时间线等）不能读取经期摘要。见 ' +
        DOC +
        '（第 4 节）',
    },
  },
  create(context) {
    const here = locate(context.filename);
    if (here.kind === 'outside' || here.kind === 'composition') return {};
    if (here.kind === 'module' && ALLOWED_MODULES.has(here.module)) return {};
    if (isServerIntegrationTest(context.filename)) return {};
    const reported = new Set();
    const check = (name, node) => {
      if (!NAMES.has(name)) return;
      const key = `${node.range[0]}:${node.range[1]}`;
      if (reported.has(key)) return;
      reported.add(key);
      context.report({ node, messageId: 'health', data: { name } });
    };
    return {
      Identifier(node) {
        check(node.name, node);
      },
      ImportSpecifier(node) {
        const name = staticString(node.imported);
        if (name !== null) check(name, node.imported);
      },
      ExportSpecifier(node) {
        const name = staticString(node.local);
        if (name !== null) check(name, node.local);
      },
      MemberExpression(node) {
        if (!node.computed) return;
        const name = staticString(node.property);
        if (name !== null) check(name, node.property);
      },
    };
  },
};
