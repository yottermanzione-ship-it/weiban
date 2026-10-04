/**
 * R7 时间：服务器业务模块读取「当前时间」必须经过 platform/clock（测试才能拨时间）。
 * 禁止 new Date()（不带参数）和 Date.now()。new Date(某个时间戳) 这种「解析时间」是允许的。
 * 平台内核（platform/）和测试文件不检查。
 */
import { STANDARDS_DOC, isTestFile, locate } from './support.js';

export default {
  meta: {
    type: 'problem',
    docs: { description: 'R7：服务器业务代码通过 platform/clock 取当前时间' },
    schema: [],
    messages: {
      raw:
        'R7 时间：业务代码不要直接用 {{what}}，请使用 platform/clock 提供的时钟。见 ' +
        STANDARDS_DOC,
    },
  },
  create(context) {
    if (locate(context.filename).kind !== 'module' || isTestFile(context.filename)) return {};
    return {
      NewExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Date' &&
          node.arguments.length === 0
        ) {
          context.report({ node, messageId: 'raw', data: { what: 'new Date()' } });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Date' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'now'
        ) {
          context.report({ node, messageId: 'raw', data: { what: 'Date.now()' } });
        }
      },
    };
  },
};
