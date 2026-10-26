/**
 * 有效人设文本的无损分段；不从原始ZIP重新生成、不改字段格式。
 * 2026-10-27 批 U4：分段函数和中文标签表挪到 @weiban/client-core（网页人设卡与后台共用，只在一处定义）。
 * 标签表 = 人设板块配置里各子板块的 legacyLabels（packages/client-core/src/persona-sections.ts），新增标签改那里。
 */
export {
  joinPersonaText,
  splitPersonaText,
  type PersonaTextDocument,
  type PersonaTextPart,
} from '@weiban/client-core';
