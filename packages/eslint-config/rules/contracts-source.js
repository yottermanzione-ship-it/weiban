/**
 * R6 契约来源：接口类型只从 '@weiban/contracts' 包的公开出口导入。
 * 能用工具检查的部分：禁止绕过包出口、直接引用 packages/contracts 的内部文件。
 * 「在 web / server 里另写一份接口类型」无法靠 lint 判断，由质量负责人评审时检查。
 */
import { STANDARDS_DOC, importSourceVisitors, resolveRelative, toPosix } from './support.js';

const CONTRACTS_DIR = '/packages/contracts/';

export default {
  meta: {
    type: 'problem',
    docs: { description: "R6：契约只能从 '@weiban/contracts' 包出口导入" },
    schema: [],
    messages: {
      deep:
        "R6 契约来源：请写 import … from '@weiban/contracts'，不要引用契约包内部路径 {{source}}。见 " +
        STANDARDS_DOC,
    },
  },
  create(context) {
    const filename = toPosix(context.filename);
    if (filename.includes(CONTRACTS_DIR)) return {};
    return importSourceVisitors((source, node) => {
      const resolved = resolveRelative(filename, source);
      const deepPackagePath = source.startsWith('@weiban/contracts/');
      const relativeIntoContracts = resolved !== null && `${resolved}/`.includes(CONTRACTS_DIR);
      if (deepPackagePath || relativeIntoContracts) {
        context.report({ node, messageId: 'deep', data: { source } });
      }
    });
  },
};
