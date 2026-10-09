/**
 * importer 模块（L6，D-L6-04、D-L6-07）：导入聊天记录生成角色草稿（CHR-08）、导入资料生成补充设定（CHR-09）。
 * 数据归 importer（表 import_jobs、import_raw）。原文加密暂存，默认生成完成后删除（CHR-08 第 6 条，
 * security-and-privacy.md 5.3、第 6 节）；截图与文字原文同等对待。分析由 ai-runtime 经 ImportAnalyzerPort 完成，
 * 费用从用户余额扣（用途 import_analysis，开始前给出预计花费）。
 *
 * 流程：创建任务（粘贴文字 / 上传文件 / 上传截图）→ 识别发言人（截图先确认识别出的对话）→ 选定发言人并拿到预计花费 →
 * 开始分析（可离开页面，完成后推送通知）→ 取结果：新角色草稿进入自定义角色编辑器 / 补充设定文字进入确认页。
 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint, tolerantEnum } from '../common.js';
import { DraftCharacterCard } from '../character-card.js';
import { CharacterClassificationInput } from './characters.js';

/** 单次导入上限（runtime-overview.md 第 12 节第 6、7 条）。 */
export const IMPORT_LIMITS = {
  maxChars: 200_000,
  maxScreenshots: 30,
  /** 3 分钟内出草稿的参考长度（CHR-08 第 5 条），只用于提示。 */
  fastPathChars: 50_000,
} as const;

export const ImportKind = z.enum(['new_character', 'supplement']);
export const ImportSourceKind = z.enum(['text', 'file', 'screenshots']);

export const ImportJobStatus = z.enum([
  'collecting', // 等待上传文件 / 截图
  'detecting', // 识别格式与发言人中
  'awaiting_dialogue_confirmation', // 截图：等用户确认识别出的对话
  'awaiting_speaker', // 等用户选定发言人
  'ready', // 已选发言人，给出预计花费，等用户点开始
  'analyzing',
  'completed',
  'failed',
  'cancelled',
]);
export type ImportJobStatus = z.infer<typeof ImportJobStatus>;

export const ImportFailure = z.enum([
  'format_unrecognized', // 识别不出两个以上发言人
  'insufficient_balance',
  'model_unavailable',
  'vision_unavailable', // 截图：没有可用的识图模型（CHR-08 第 1 条）
  'internal',
]);

export const ImportJob = z.object({
  jobId: Id,
  kind: ImportKind,
  /** kind = supplement 时为要补充的角色。 */
  targetCharacterId: Id.nullable(),
  sourceKind: ImportSourceKind,
  status: tolerantEnum(ImportJobStatus),
  /** 识别出的发言人与发言条数。 */
  speakers: z.array(
    z.object({ name: z.string().max(40), messageCount: z.number().int().nonnegative() }),
  ),
  selectedSpeaker: z.string().max(40).nullable(),
  charCount: z.number().int().nonnegative(),
  /** 超过 IMPORT_LIMITS.maxChars 时只取最近的部分（CHR-08 边界情况）。 */
  truncated: z.boolean(),
  /** 预计花费（微元，按价目表估算，MDL-09）。 */
  estimatedMicros: z.number().int().nonnegative().nullable(),
  progress: z.number().int().min(0).max(100),
  keepRaw: z.boolean(),
  /** 原文已删除的时间；保留原文或尚未删除为 null。 */
  rawDeletedAt: Timestamp.nullable(),
  failure: tolerantEnum(ImportFailure).nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ImportJob = z.infer<typeof ImportJob>;

/** 截图识别出的对话，生成前让用户确认（右侧气泡 = 导入者本人）。 */
export const RecognizedDialogueLine = z.object({
  lineId: z.string().max(32),
  speaker: z.string().max(40),
  text: z.string().max(2000),
  screenshotIndex: z.number().int().nonnegative(),
});

export const ImportResult = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new_character'),
    draft: DraftCharacterCard,
    /** 默认「真人 · 身边真人」（CHR-08 第 4 条）；改选原创 / 虚构需要声明，由自定义角色创建接口校验。 */
    suggestedClassification: CharacterClassificationInput,
    /** 草稿里识别出的疑似真名，提示用户替换。 */
    detectedRealNames: z.array(z.string().max(40)),
  }),
  z.object({
    kind: z.literal('supplement'),
    targetCharacterId: Id,
    text: z.string().max(5000),
  }),
]);
export type ImportResult = z.infer<typeof ImportResult>;

const JobParams = z.object({ jobId: Id });

export const ImporterEndpoints = {
  createJob: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/imports`,
    auth: 'user',
    body: z.object({
      clientRequestId: Id,
      kind: ImportKind,
      targetCharacterId: Id.nullable().optional(),
      sourceKind: ImportSourceKind,
      /** sourceKind = text 时的粘贴内容；超长部分服务器截取最近的部分。 */
      text: z
        .string()
        .min(1)
        .max(IMPORT_LIMITS.maxChars * 2)
        .optional(),
    }),
    response: ImportJob,
    summary:
      '创建导入任务，成功 201。text 立即进入识别；file / screenshots 先 collecting，再用 uploadFile 上传。' +
      '导入页提示「只导入你有权使用的内容」（CHR-08 第 6 条）',
  }),
  uploadFile: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/imports/:jobId/files`,
    auth: 'user',
    params: JobParams,
    response: ImportJob,
    summary:
      '上传 .txt / .csv（multipart，字段 file，≤ MEDIA_LIMITS.importFileMaxBytes）或一张截图（字段 file，图片格式）；截图最多 30 张，超出 422 limit_reached',
  }),
  finishUpload: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/imports/:jobId/files/done`,
    auth: 'user',
    params: JobParams,
    response: ImportJob,
    summary: '上传完毕，开始识别格式与发言人（截图走识图，费用从余额扣）',
  }),
  listJobs: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/imports`,
    auth: 'user',
    response: z.object({ items: z.array(ImportJob) }),
    summary: '我的导入任务（最近 30 天）',
  }),
  getJob: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/imports/:jobId`,
    auth: 'user',
    params: JobParams,
    response: ImportJob,
    summary: '任务状态与进度（也会经 importer.job_updated 更新推到各设备）',
  }),
  getRecognizedDialogue: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/imports/:jobId/dialogue`,
    auth: 'user',
    params: JobParams,
    response: z.object({ items: z.array(RecognizedDialogueLine) }),
    summary: '截图识别出的对话（awaiting_dialogue_confirmation 时）',
  }),
  confirmDialogue: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/imports/:jobId/dialogue/confirm`,
    auth: 'user',
    params: JobParams,
    body: z.object({
      /** 用户修正过的行（改发言人、删行）；不传表示照单全收。 */
      lines: z.array(RecognizedDialogueLine).max(5000).optional(),
    }),
    response: ImportJob,
    summary: '确认截图识别结果，进入选发言人',
  }),
  selectSpeaker: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/imports/:jobId/speaker`,
    auth: 'user',
    params: JobParams,
    body: z.object({ speaker: z.string().min(1).max(40) }),
    response: ImportJob,
    summary: '选定「哪一方是要生成的角色」（CHR-08 第 2 条），返回预计花费',
  }),
  start: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/imports/:jobId/start`,
    auth: 'user',
    params: JobParams,
    body: z.object({
      /** 勾选「保留原文以便以后补充」，默认不保留。 */
      keepRaw: z.boolean().default(false),
    }),
    response: ImportJob,
    summary:
      '开始分析；余额不足以完成时 422 insufficient_balance，不开始（CHR-08 第 7 条）。完成后推送「导入完成」并发出 importer.job_completed',
  }),
  getResult: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/imports/:jobId/result`,
    auth: 'user',
    params: JobParams,
    response: ImportResult,
    summary: '分析结果：新角色草稿（进 CHR-07 编辑器）或补充设定文字；未完成返回 409 conflict',
  }),
  saveResultDraft: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/imports/:jobId/result`,
    auth: 'user',
    params: JobParams,
    body: ImportResult,
    response: ImportResult,
    summary:
      '保存用户在编辑器里未完成的修改（中途离开可回来继续；「进行中的导入」列表用 listJobs）。之后 getResult 返回保存的版本；' +
      '用户点「创建角色」/「保存补充设定」后由对应接口落库，草稿保留到任务删除',
  }),
  cancel: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/imports/:jobId`,
    auth: 'user',
    params: JobParams,
    response: NoContent,
    summary: '取消 / 删除任务，原文与截图立即物理删除',
  }),
  deleteRaw: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/imports/:jobId/raw/delete`,
    auth: 'user',
    params: JobParams,
    response: ImportJob,
    summary: '删除保留的原文（勾选过保留原文的任务）',
  }),
} as const;
