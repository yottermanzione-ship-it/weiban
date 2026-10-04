/**
 * R1 公开出口、R2 层级方向、R3 聊天不依赖 AI。
 * 依据：ADR-0004 第 3 节；engineering-standards.md 第 3 节。
 *
 * 只检查相对路径的 import（服务器内部互相引用一律写相对路径）。
 * 以后如果服务器启用路径别名（如 '@/modules/chat'），需要在这里补上别名解析。
 */
import { SERVER_MODULES } from '../architecture.js';
import {
  STANDARDS_DOC,
  importSourceVisitors,
  isModuleEntry,
  locate,
  rankOf,
  resolveRelative,
} from './support.js';

const KIND_LABEL = {
  platform: '平台内核 platform',
  composition: '装配入口（main.ts / app.module.ts）',
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
    docs: { description: '服务器模块边界：R1 公开出口、R2 层级方向、R3 聊天不依赖 AI' },
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
    },
  },
  create(context) {
    const filename = context.filename;
    const from = locate(filename);
    if (from.kind === 'outside') return {};

    const visitors = importSourceVisitors((source, node) => {
      const resolved = resolveRelative(filename, source);
      if (!resolved) return;
      const to = locate(resolved);
      if (to.kind === 'outside' || to.kind === 'server-other') return;

      if (to.kind === 'module' && !SERVER_MODULES[to.module]) {
        context.report({ node, messageId: 'unknownModule', data: { module: to.module } });
        return;
      }
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
      if (to.kind === 'module' && !isModuleEntry(to.inner)) {
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
