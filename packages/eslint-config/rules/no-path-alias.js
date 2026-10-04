/**
 * 服务器禁止路径别名（T-011 验收建议 6）。
 *
 * R1～R3 只能看懂相对路径（./、../）。如果服务器代码用了 '@/modules/chat' 这类别名，
 * 边界规则会悄无声息地失效，所以这里直接报错：服务器内部互相引用一律写相对路径。
 *
 * 检查范围：apps/server/ 下所有文件（含测试）。
 * 视为别名的写法：
 *   - '@/…'、'~/…'、'~…'（TypeScript paths / 打包工具常见别名）
 *   - '#…'（Node 的 package.json "imports" 子路径别名）
 *   - 'src/…'、'modules/…'、'platform/…'、'apps/…'（依赖 baseUrl 的「伪绝对路径」）
 * 正常的 npm 包（如 '@nestjs/common'、'@weiban/contracts'、'pg'）不受影响。
 */
import { STANDARDS_DOC, importSourceVisitors, toPosix } from './support.js';

const ALIAS_PATTERNS = [/^@\//, /^~/, /^#/, /^(src|modules|platform|apps)\//];

export function isPathAlias(source) {
  return ALIAS_PATTERNS.some((pattern) => pattern.test(source));
}

export default {
  meta: {
    type: 'problem',
    docs: { description: '服务器代码禁止路径别名，一律写相对路径' },
    schema: [],
    messages: {
      alias:
        "禁止路径别名：服务器代码不能写 '{{source}}'，请改用相对路径（./ 或 ../），否则模块边界规则 R1～R3 会失效。见 " +
        STANDARDS_DOC,
    },
  },
  create(context) {
    if (!/\/apps\/server\//.test(toPosix(context.filename))) return {};
    return importSourceVisitors((source, node) => {
      if (isPathAlias(source)) context.report({ node, messageId: 'alias', data: { source } });
    });
  },
};
