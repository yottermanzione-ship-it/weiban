/**
 * importer 的注入令牌（T-079）。
 * 草稿生成 / 截图识别 / 模型识别发言人由 ai-runtime 实现契约 ImportAnalyzerPort（T-081）。
 * ai-runtime 不能 import importer（上层白名单只允许 importer → ai-runtime），所以令牌定义在这里，
 * 由装配入口 app.module.ts 绑定 ai-runtime 的实现；未绑定时相关步骤以 model_unavailable 失败。
 */
import type { ImportAnalyzerPort } from '@weiban/contracts';

export const IMPORTER_ANALYZER = Symbol('weiban.importer.analyzer');
export type ImporterAnalyzer = ImportAnalyzerPort;
