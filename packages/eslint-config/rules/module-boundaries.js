/**
 * R1 公开出口、R2 层级方向、R3 聊天不依赖 AI、R10 测试引用。
 * 依据：ADR-0004 第 3 节；engineering-standards.md 第 3 节（含 3.2）。
 *
 * 只检查相对路径的 import（服务器内部互相引用一律写相对路径，别名由 weiban/no-path-alias 直接报错）。
 *
 * R10（T-014 定，T-015 实现）：
 *   - apps/server/test/ 下的集成测试只能引用 src/modules/<模块>/index.ts、src/modules/<模块>/testing.ts、
 *     src/platform/**；引用模块内部文件、装配入口（main.ts / app.module.ts）、src 下其他目录一律报错。
 *     （按「最严格理解」实现：规范列出的三类以外都不允许，见 T-015 交接说明。）
 *   - 模块的 testing.ts 只给测试用：生产代码（非测试文件）引用任何模块的 testing.ts 都报错，含本模块。
 *   - 测试文件（含模块目录内的单元测试）可以引用其他模块的 testing.ts。
 */
import { SERVER_MODULES } from '../architecture.js';
import {
  STANDARDS_DOC,
  importSourceVisitors,
  isModuleEntry,
  isModuleTestingEntry,
  isServerIntegrationTest,
  isTestFile,
  locate,
  rankOf,
  resolveRelative,
} from './support.js';

const KIND_LABEL = {
  platform: '平台内核 platform',
  composition: '装配入口（main.ts / app.module.ts）',
  'server-other': 'src 下的其他目录',
};

function label(location) {
  if (location.kind === 'module') {
    const layer = SERVER_MODULES[location.module]?.layer ?? '未登记';
    return `模块 ${location.module}（${layer}）`;
  }
  return KIND_LABEL[location.kind] ?? location.kind;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: '服务器模块边界：R1 公开出口、R2 层级方向、R3 聊天不依赖 AI、R10 测试引用',
    },
    schema: [],
    messages: {
      unknownModule:
        '模块目录 modules/{{module}} 没有在 packages/eslint-config/architecture.js 登记层级，请先登记（规则由架构负责人定）。',
      r1:
        "R1 公开出口：其他模块只能 import 模块 {{module}} 的 index.ts（写成 '…/{{module}}'），不能直接引用其内部文件 {{inner}}。见 " +
        STANDARDS_DOC,
      r2:
        'R2 层级方向：{{from}} 不能 import {{to}}（下层不能依赖上层，只能通过事件通知上层）。见 ' +
        STANDARDS_DOC,
      r3:
        'R3 聊天不依赖 AI：modules/chat 不得 import modules/ai-runtime 的任何内容。见 ' +
        STANDARDS_DOC,
      r10Test:
        'R10 测试引用：集成测试（apps/server/test/）只能 import 模块的 index.ts、testing.ts 和 platform/，不能引用 {{to}}。需要的假实现 / 数据工厂请让该模块从 testing.ts 导出。见 ' +
        STANDARDS_DOC +
        '（3.2）',
      r10Prod:
        'R10 测试引用：testing.ts 只给测试用，生产代码不能 import modules/{{module}}/testing.ts。见 ' +
        STANDARDS_DOC +
        '（3.2）',
    },
  },
  create(context) {
    const filename = context.filename;
    const integrationTest = isServerIntegrationTest(filename);
    const from = locate(filename);
    if (from.kind === 'outside' && !integrationTest) return {};
    const fromIsTest = integrationTest || isTestFile(filename);

    const visitors = importSourceVisitors((source, node) => {
      const resolved = resolveRelative(filename, source);
      if (!resolved) return;
      const to = locate(resolved);
      if (to.kind === 'outside') return;

      if (to.kind === 'module' && !SERVER_MODULES[to.module]) {
        context.report({ node, messageId: 'unknownModule', data: { module: to.module } });
        return;
      }

      // R10：testing.ts 只给测试用
      if (to.kind === 'module' && isModuleTestingEntry(to.inner) && !fromIsTest) {
        context.report({ node, messageId: 'r10Prod', data: { module: to.module } });
        return;
      }

      // R10：集成测试只能引用 index.ts、testing.ts、platform/
      if (integrationTest) {
        const allowed =
          to.kind === 'platform' ||
          (to.kind === 'module' && (isModuleEntry(to.inner) || isModuleTestingEntry(to.inner)));
        if (!allowed) {
          const what =
            to.kind === 'module' ? `模块 ${to.module} 的内部文件 ${to.inner}` : label(to);
          context.report({ node, messageId: 'r10Test', data: { to: what } });
        }
        return;
      }

      if (to.kind === 'server-other') return;
      const sameModule =
        from.kind === 'module' && to.kind === 'module' && from.module === to.module;
      if (sameModule) return;

      if (
        from.kind === 'module' &&
        from.module === 'chat' &&
        to.kind === 'module' &&
        to.module === 'ai-runtime'
      ) {
        context.report({ node, messageId: 'r3' });
        return;
      }
      const isPublicExit =
        isModuleEntry(to.inner ?? '') || (fromIsTest && isModuleTestingEntry(to.inner ?? ''));
      if (to.kind === 'module' && !isPublicExit) {
        context.report({ node, messageId: 'r1', data: { module: to.module, inner: to.inner } });
      }
      const fromRank = rankOf(from);
      const toRank = rankOf(to);
      if (fromRank !== null && toRank !== null && fromRank < toRank) {
        context.report({ node, messageId: 'r2', data: { from: label(from), to: label(to) } });
      }
    });

    return {
      ...visitors,
      Program(node) {
        if (from.kind === 'module' && !SERVER_MODULES[from.module]) {
          context.report({ node, messageId: 'unknownModule', data: { module: from.module } });
        }
      },
    };
  },
};
