/**
 * R4 模型出口唯一、R5 推送出口唯一。
 * 某类 SDK（及其接口域名）只允许在指定模块里出现；apps/ 和 packages/ai-evals/ 下其他任何地方出现都报错。
 * 名单在 ../architecture.js。
 */
import { STANDARDS_DOC, importSourceVisitors, locate, matchesPackage, toPosix } from './support.js';

export default {
  meta: {
    type: 'problem',
    docs: { description: 'R4 / R5：指定类别的 SDK 和接口域名只能在唯一出口模块中使用' },
    schema: [
      {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            what: { type: 'string' },
            allowedModule: { type: 'string' },
            packages: { type: 'array', items: { type: 'string' } },
            domains: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'what', 'allowedModule', 'packages'],
          additionalProperties: false,
        },
      },
    ],
    messages: {
      pkg:
        '{{id}} {{what}}出口唯一：只有 modules/{{allowedModule}} 可以使用 {{source}}，其他地方请调用该模块的端口。见 ' +
        STANDARDS_DOC,
      domain:
        '{{id}} {{what}}出口唯一：只有 modules/{{allowedModule}} 可以直接请求 {{domain}}。见 ' +
        STANDARDS_DOC,
    },
  },
  create(context) {
    const filename = toPosix(context.filename);
    // 检查范围：apps/ 全部，以及 packages/ai-evals（评测一律经模型网关，engineering-standards.md 3.3）
    if (!filename.includes('/apps/') && !filename.includes('/packages/ai-evals/')) return {};
    const here = locate(filename);
    const groups = (context.options[0] ?? []).filter(
      (group) => !(here.kind === 'module' && here.module === group.allowedModule),
    );
    if (groups.length === 0) return {};

    const checkText = (text, node) => {
      for (const group of groups) {
        for (const domain of group.domains ?? []) {
          if (text.includes(domain)) {
            context.report({ node, messageId: 'domain', data: { ...group, domain } });
          }
        }
      }
    };

    return {
      ...importSourceVisitors((source, node) => {
        for (const group of groups) {
          if (matchesPackage(source, group.packages)) {
            context.report({ node, messageId: 'pkg', data: { ...group, source } });
          }
        }
      }),
      Literal(node) {
        if (typeof node.value === 'string') checkText(node.value, node);
      },
      TemplateElement(node) {
        checkText(node.value.raw, node);
      },
    };
  },
};
