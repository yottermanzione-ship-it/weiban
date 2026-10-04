/**
 * R7 时间：服务器代码读取「当前时间」必须经过 platform/clock（测试才能拨时间）。
 *
 * 检查范围：apps/server/src 下除 platform/ 和测试文件以外的所有文件
 * （业务模块、main.ts / app.module.ts、其他目录都算）。
 *
 * 禁止的写法（Date 也包括 globalThis.Date、global.Date、window.Date、self.Date，
 * 以及 globalThis['Date'] 这类方括号写法）：
 *   - new Date()（不带参数）
 *   - Date()（不带 new 直接调用，返回当前时间的字符串）
 *   - Date.now() 以及把 Date.now 赋给别的变量
 * 允许：new Date(某个时间戳 / 字符串) 这种「解析时间」。
 *
 * 已知局限：先把 Date 赋给别的变量再用（const D = Date; new D()）lint 无法可靠识别，由评审兜底。
 */
import { STANDARDS_DOC, isTestFile, locate } from './support.js';

const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window', 'self']);

/** 取成员访问的属性名（a.b 或 a['b']），取不到返回 null。 */
function propertyName(member) {
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (
    member.computed &&
    member.property.type === 'Literal' &&
    typeof member.property.value === 'string'
  ) {
    return member.property.value;
  }
  return null;
}

/** 这个表达式是不是全局的 Date（Date / globalThis.Date / globalThis['Date'] …）。 */
function isDateRef(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name === 'Date';
  if (node.type === 'MemberExpression') {
    return (
      node.object.type === 'Identifier' &&
      GLOBAL_OBJECTS.has(node.object.name) &&
      propertyName(node) === 'Date'
    );
  }
  return false;
}

/** 文件是否在 R7 检查范围内。 */
function inScope(filename) {
  const kind = locate(filename).kind;
  return kind !== 'outside' && kind !== 'platform' && !isTestFile(filename);
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'R7：服务器代码通过 platform/clock 取当前时间' },
    schema: [],
    messages: {
      raw:
        'R7 时间：服务器代码不要直接用 {{what}}，请使用 platform/clock 提供的时钟。见 ' +
        STANDARDS_DOC,
    },
  },
  create(context) {
    if (!inScope(context.filename)) return {};
    return {
      NewExpression(node) {
        if (isDateRef(node.callee) && node.arguments.length === 0) {
          context.report({ node, messageId: 'raw', data: { what: 'new Date()' } });
        }
      },
      CallExpression(node) {
        if (isDateRef(node.callee)) {
          context.report({ node, messageId: 'raw', data: { what: 'Date()' } });
        }
      },
      MemberExpression(node) {
        if (isDateRef(node.object) && propertyName(node) === 'now') {
          context.report({ node, messageId: 'raw', data: { what: 'Date.now()' } });
        }
      },
    };
  },
};
