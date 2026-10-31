/**
 * 表情包标签幂等回填的纯逻辑（0154 建表配套）：解析 JSONL、按三键校验、生成 upsert。
 * 本文件不连数据库、不读配置，可单测；真正的连接与事务在 seed-sticker-labels.ts 里。
 *
 * 来源：sticker-tags-20261031.jsonl（1619 行，只读，脚本绝不改它）。
 * 只写 media.library_sticker_labels，不写其他表；existingDescription 与 usage（token 数）不入库。
 * 幂等：以 sticker_id 为键 INSERT ... ON CONFLICT DO UPDATE，重跑不产生重复行。
 * 排除标记：review_needed=true 的行（141 行低可信度，含空白占位图）写入时 review_needed 与
 * retry_excluded 同时为 true；复核通过须同时清掉两标记，空白占位图永久不清除。
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEXT_FIELDS = [
  '完整描述',
  '图里原文字',
  '字面意思',
  '使用意思',
  '适合场合',
  '不适合场合',
  '主标签',
] as const;

/** JSONL 一行的解析结果（已去掉不入库的对照/过程字段）。 */
export interface StickerLabelFileRow {
  stickerId: string;
  mediaId: string;
  contentHash: string;
  fullDescription: string;
  imageText: string;
  literalMeaning: string;
  usageMeaning: string;
  suitableContexts: string;
  unsuitableContexts: string;
  primaryTag: string;
  emotion: Record<string, unknown>;
  confidence: number;
  reviewNeeded: boolean;
  model: string;
  tagVersion: string;
  taggedAt: string;
}

export interface LabelSkip {
  stickerId: string;
  mediaId: string;
  reason: string;
}

export interface StickerLabelBackfillSummary {
  mode: 'validate' | 'apply';
  total: number;
  valid: number;
  written: number;
  skipped: number;
  /** 已写入（或校验通过待写入）但带排除标记的行数：选图整行排除。 */
  excluded: number;
  warnings: LabelSkip[];
  failures: LabelSkip[];
}

/** 回填用的最小数据库接口（Database / DbTx 的 query 子集，便于单测用假实现）。 */
export interface LabelDbClient {
  query<Row>(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, lineNo: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`第 ${lineNo} 行：字段 ${key} 必须是 non-empty 字符串`);
  }
  return value;
}

function requiredUuid(record: Record<string, unknown>, key: string, lineNo: number): string {
  const value = requiredString(record, key, lineNo);
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`第 ${lineNo} 行：字段 ${key} 不是合法 UUID：${value}`);
  }
  return value;
}

/** 解析 JSONL 的一行（unknown → 严格校验后的行）；字段缺失/类型不对直接抛错并带行号。 */
export function parseStickerLabelRow(value: unknown, lineNo: number): StickerLabelFileRow {
  if (!isRecord(value)) {
    throw new Error(`第 ${lineNo} 行：必须是 JSON 对象`);
  }
  const emotion = value['情绪与强度'];
  if (!isRecord(emotion)) {
    throw new Error(`第 ${lineNo} 行：字段 情绪与强度 必须是对象`);
  }
  const confidence = value['可信度'];
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error(`第 ${lineNo} 行：字段 可信度 必须是 0 到 1 的数字`);
  }
  const reviewNeeded = value['review_needed'];
  if (typeof reviewNeeded !== 'boolean') {
    throw new Error(`第 ${lineNo} 行：字段 review_needed 必须是布尔值`);
  }
  const texts = {} as Record<(typeof TEXT_FIELDS)[number], string>;
  for (const key of TEXT_FIELDS) {
    texts[key] = requiredString(value, key, lineNo);
  }
  return {
    stickerId: requiredUuid(value, 'stickerId', lineNo),
    mediaId: requiredUuid(value, 'mediaId', lineNo),
    contentHash: requiredString(value, 'contentHash', lineNo),
    fullDescription: texts['完整描述'],
    imageText: texts['图里原文字'],
    literalMeaning: texts['字面意思'],
    usageMeaning: texts['使用意思'],
    suitableContexts: texts['适合场合'],
    unsuitableContexts: texts['不适合场合'],
    primaryTag: texts['主标签'],
    emotion,
    confidence,
    reviewNeeded,
    model: requiredString(value, 'model', lineNo),
    tagVersion: requiredString(value, 'tag_version', lineNo),
    taggedAt: requiredString(value, 'tagged_at', lineNo),
  };
}

/**
 * 解析整个 JSONL 文本：逐行解析，空行跳过；同一 stickerId 出现两次直接报错
 *（文件内重复会在回填时造成“后写覆盖先写”，必须先拦下）。
 */
export function parseStickerLabelFile(text: string): StickerLabelFileRow[] {
  const rows: StickerLabelFileRow[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      errors.push(`第 ${lineNo} 行：不是合法 JSON`);
      return;
    }
    try {
      const row = parseStickerLabelRow(parsed, lineNo);
      if (seen.has(row.stickerId)) {
        errors.push(`第 ${lineNo} 行：stickerId 重复：${row.stickerId}`);
        return;
      }
      seen.add(row.stickerId);
      rows.push(row);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  });
  if (errors.length) {
    throw new Error(`标签文件解析失败（${errors.length} 处）：${errors.slice(0, 10).join('；')}`);
  }
  return rows;
}

/** 同一 media 的多行标签是否一致（不一致时以第一行为准，见 backfillStickerLabels）。 */
function labelPayload(row: StickerLabelFileRow): string {
  return JSON.stringify({
    fullDescription: row.fullDescription,
    imageText: row.imageText,
    literalMeaning: row.literalMeaning,
    usageMeaning: row.usageMeaning,
    suitableContexts: row.suitableContexts,
    unsuitableContexts: row.unsuitableContexts,
    primaryTag: row.primaryTag,
    emotion: row.emotion,
    confidence: row.confidence,
  });
}

const UPSERT_SQL = `INSERT INTO media.library_sticker_labels
  (sticker_id, media_id, content_hash, full_description, image_text, literal_meaning, usage_meaning, suitable_contexts, unsuitable_contexts, primary_tag, emotion, confidence, review_needed, retry_excluded, model, tag_version, tagged_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::numeric, $13, $14, $15, $16, $17::timestamptz)
ON CONFLICT (sticker_id) DO UPDATE SET
  media_id = EXCLUDED.media_id,
  content_hash = EXCLUDED.content_hash,
  full_description = EXCLUDED.full_description,
  image_text = EXCLUDED.image_text,
  literal_meaning = EXCLUDED.literal_meaning,
  usage_meaning = EXCLUDED.usage_meaning,
  suitable_contexts = EXCLUDED.suitable_contexts,
  unsuitable_contexts = EXCLUDED.unsuitable_contexts,
  primary_tag = EXCLUDED.primary_tag,
  emotion = EXCLUDED.emotion,
  confidence = EXCLUDED.confidence,
  review_needed = EXCLUDED.review_needed,
  retry_excluded = EXCLUDED.retry_excluded,
  model = EXCLUDED.model,
  tag_version = EXCLUDED.tag_version,
  tagged_at = EXCLUDED.tagged_at`;

function upsertParams(row: StickerLabelFileRow): unknown[] {
  return [
    row.stickerId,
    row.mediaId,
    row.contentHash,
    row.fullDescription,
    row.imageText,
    row.literalMeaning,
    row.usageMeaning,
    row.suitableContexts,
    row.unsuitableContexts,
    row.primaryTag,
    JSON.stringify(row.emotion),
    String(row.confidence),
    row.reviewNeeded,
    // 排除标记与 review_needed 同值：低可信度行与空白占位图同时为 true。
    row.reviewNeeded,
    row.model,
    row.tagVersion,
    row.taggedAt,
  ];
}

/**
 * 幂等回填：先三键校验（sticker 存在且未删、mediaId 一致、contentHash 一致），
 * 对不上的行只记入 failures、不硬写；校验通过的行以 sticker_id 为键 upsert。
 * 调用方须在单个事务里调用；apply=true 时先拿事务级咨询锁，防两路回填并发。
 * validate 模式（apply=false）只校验不写，written 为 0，valid 即待写入数。
 */
export async function backfillStickerLabels(
  client: LabelDbClient,
  inputRows: StickerLabelFileRow[],
  options: { apply: boolean },
): Promise<StickerLabelBackfillSummary> {
  const summary: StickerLabelBackfillSummary = {
    mode: options.apply ? 'apply' : 'validate',
    total: inputRows.length,
    valid: 0,
    written: 0,
    skipped: 0,
    excluded: 0,
    warnings: [],
    failures: [],
  };
  if (inputRows.length === 0) return summary;

  // 同一 media 的多行标签不一致时，以第一行的标签为准写全部行，并记入 warnings。
  const firstByMedia = new Map<string, StickerLabelFileRow>();
  const rows = inputRows.map((row) => {
    const first = firstByMedia.get(row.mediaId);
    if (!first) {
      firstByMedia.set(row.mediaId, row);
      return row;
    }
    if (labelPayload(first) !== labelPayload(row)) {
      summary.warnings.push({
        stickerId: row.stickerId,
        mediaId: row.mediaId,
        reason: 'media_label_inconsistent_using_first',
      });
      // 整行取第一行（只保留本行的 stickerId）：同一张图只应有一份标签。
      return { ...first, stickerId: row.stickerId };
    }
    return row;
  });

  if (options.apply) {
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('media:sticker-labels-backfill:v1', 0)) AS locked`,
    );
    if (lock.rows[0]?.locked !== true) {
      throw new Error('回填已在另一事务中运行，本次放弃');
    }
  }

  const stickerIds = rows.map((row) => row.stickerId);
  const mediaIds = [...new Set(rows.map((row) => row.mediaId))];
  const stickers = await client.query<{
    id: string;
    media_id: string;
    deleted_at: Date | null;
  }>('SELECT id, media_id, deleted_at FROM media.library_stickers WHERE id = ANY($1::uuid[])', [
    stickerIds,
  ]);
  const objects = await client.query<{ id: string; content_hash: string | null }>(
    'SELECT id, content_hash FROM media.objects WHERE id = ANY($1::uuid[])',
    [mediaIds],
  );
  const stickerById = new Map(stickers.rows.map((row) => [row.id, row]));
  const objectById = new Map(objects.rows.map((row) => [row.id, row]));

  const valid: StickerLabelFileRow[] = [];
  for (const row of rows) {
    const sticker = stickerById.get(row.stickerId);
    if (!sticker) {
      summary.failures.push({
        stickerId: row.stickerId,
        mediaId: row.mediaId,
        reason: 'sticker_not_found',
      });
      continue;
    }
    if (sticker.deleted_at !== null) {
      summary.failures.push({
        stickerId: row.stickerId,
        mediaId: row.mediaId,
        reason: 'sticker_deleted',
      });
      continue;
    }
    if (sticker.media_id !== row.mediaId) {
      summary.failures.push({
        stickerId: row.stickerId,
        mediaId: row.mediaId,
        reason: 'media_id_mismatch',
      });
      continue;
    }
    const object = objectById.get(row.mediaId);
    if (!object) {
      summary.failures.push({
        stickerId: row.stickerId,
        mediaId: row.mediaId,
        reason: 'object_not_found',
      });
      continue;
    }
    if (object.content_hash !== row.contentHash) {
      summary.failures.push({
        stickerId: row.stickerId,
        mediaId: row.mediaId,
        reason: 'content_hash_mismatch',
      });
      continue;
    }
    valid.push(row);
  }

  summary.valid = valid.length;
  summary.skipped = summary.failures.length;
  summary.excluded = valid.filter((row) => row.reviewNeeded).length;
  if (options.apply) {
    for (const row of valid) {
      await client.query(UPSERT_SQL, upsertParams(row));
      summary.written += 1;
    }
  }
  return summary;
}
