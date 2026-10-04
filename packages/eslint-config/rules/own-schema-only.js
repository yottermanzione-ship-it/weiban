/**
 * R8 数据表：每个模块只访问自己 pgSchema 下的表。
 * 检查两处：
 *   1. pgSchema('xxx') 定义了别的模块的 schema；
 *   2. 原生 SQL 文本里出现别的 schema 名加点（如 chat.messages、"billing"."accounts"）。
 *      原生 SQL 指：sql`…` 模板、sql.raw('…')、xxx.execute('…') / xxx.query('…') / xxx.unsafe('…')。
 * 普通字符串（例如事件名 'chat.message_created'）不在检查范围内。
 */
import { NON_MODULE_SCHEMAS, SERVER_MODULES } from '../architecture.js';
import { STANDARDS_DOC, locate } from './support.js';

const ALL_SCHEMAS = [
  ...Object.values(SERVER_MODULES)
    .map((info) => info.schema)
    .filter(Boolean),
  ...NON_MODULE_SCHEMAS,
];
const RAW_SQL_METHODS = new Set(['execute', 'query', 'unsafe', 'raw']);

function isSqlTag(tag) {
  if (tag.type === 'Identifier') return tag.name === 'sql';
  return (
    tag.type === 'MemberExpression' && tag.object.type === 'Identifier' && tag.object.name === 'sql'
  );
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'R8：模块只访问自己 schema 下的表' },
    schema: [],
    messages: {
      pgSchema:
        "R8 数据表：模块 {{module}} 不能定义其他模块的 schema pgSchema('{{schema}}')。见 " +
        STANDARDS_DOC,
      sql:
        'R8 数据表：模块 {{module}} 的原生 SQL 里出现了其他 schema「{{schema}}」，要别人的数据请调用对方模块的端口。见 ' +
        STANDARDS_DOC,
    },
  },
  create(context) {
    const here = locate(context.filename);
    if (here.kind !== 'module') return {};
    const own = SERVER_MODULES[here.module]?.schema ?? null;
    const forbidden = ALL_SCHEMAS.filter((schema) => schema !== own);
    const pattern = new RegExp(`(?<![\\w."])"?(${forbidden.join('|')})"?\\s*\\.\\s*"?[a-z_]`, 'i');

    const checkSqlText = (text, node) => {
      const hit = pattern.exec(text);
      if (hit) {
        context.report({ node, messageId: 'sql', data: { module: here.module, schema: hit[1] } });
      }
    };
    const checkSqlArgument = (arg) => {
      if (!arg) return;
      if (arg.type === 'Literal' && typeof arg.value === 'string') checkSqlText(arg.value, arg);
      if (arg.type === 'TemplateLiteral') {
        checkSqlText(arg.quasis.map((q) => q.value.raw).join(' '), arg);
      }
    };

    return {
      TaggedTemplateExpression(node) {
        if (isSqlTag(node.tag)) checkSqlArgument(node.quasi);
      },
      CallExpression(node) {
        const callee = node.callee;
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
              ? callee.property.name
              : null;
        if (name === 'pgSchema') {
          const arg = node.arguments[0];
          if (arg?.type === 'Literal' && typeof arg.value === 'string' && arg.value !== own) {
            context.report({
              node: arg,
              messageId: 'pgSchema',
              data: { module: here.module, schema: arg.value },
            });
          }
          return;
        }
        if (name && callee.type === 'MemberExpression' && RAW_SQL_METHODS.has(name)) {
          checkSqlArgument(node.arguments[0]);
        }
      },
    };
  },
};
