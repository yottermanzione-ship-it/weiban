import { describe, expect, it } from 'vitest';
import {
  backfillStickerLabels,
  parseStickerLabelFile,
  type LabelDbClient,
  type StickerLabelFileRow,
} from './seed-sticker-labels-options.js';

const STICKER_A = '11111111-1111-4111-8111-111111111111';
const STICKER_B = '22222222-2222-4222-8222-222222222222';
const STICKER_C = '33333333-3333-4333-8333-333333333333';
const MEDIA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEDIA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function fileRow(overrides: Partial<StickerLabelFileRow> = {}): StickerLabelFileRow {
  return {
    stickerId: STICKER_A,
    mediaId: MEDIA_A,
    contentHash: HASH_A,
    fullDescription: '一只小猫抱着抱枕',
    imageText: '无',
    literalMeaning: '小猫抱着抱枕',
    usageMeaning: '安慰对方',
    suitableContexts: '对方难过时',
    unsuitableContexts: '正式场合',
    primaryTag: 'comfort',
    emotion: { 主情绪: 'comfort', 强度: 2, 副情绪: '平静' },
    confidence: 0.9,
    reviewNeeded: false,
    model: 'mimo-v2.6-flash',
    tagVersion: 'sticker-tag-v1',
    taggedAt: '2026-10-31T10:22:23.588Z',
    ...overrides,
  };
}

function jsonlRow(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stickerId: STICKER_A,
    packId: '9670ef26-4966-5245-84cb-724265b0023d',
    packName: '测试包',
    mediaId: MEDIA_A,
    contentHash: HASH_A,
    existingDescription: '测试 1',
    完整描述: '一只小猫抱着抱枕',
    图里原文字: '无',
    字面意思: '小猫抱着抱枕',
    使用意思: '安慰对方',
    适合场合: '对方难过时',
    不适合场合: '正式场合',
    情绪与强度: { 主情绪: 'comfort', 强度: 2, 副情绪: '平静' },
    主标签: 'comfort',
    可信度: 0.9,
    review_needed: false,
    model: 'mimo-v2.6-flash',
    tag_version: 'sticker-tag-v1',
    tagged_at: '2026-10-31T10:22:23.588Z',
    usage: { promptTokens: 1, completionTokens: 1 },
    ...overrides,
  });
}

describe('parseStickerLabelFile', () => {
  it('解析有效行并保留 review 标记', () => {
    const rows = parseStickerLabelFile(
      `${jsonlRow()}\n${jsonlRow({ stickerId: STICKER_B, review_needed: true, 可信度: 0.1 })}\n`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.reviewNeeded).toBe(false);
    expect(rows[1]?.reviewNeeded).toBe(true);
    expect(rows[1]?.confidence).toBe(0.1);
  });

  it('字段缺失、非法 UUID、越界可信度、重复 stickerId 都报错', () => {
    expect(() => parseStickerLabelFile(`${jsonlRow({ 主标签: undefined })}\n`)).toThrow();
    expect(() => parseStickerLabelFile(`${jsonlRow({ stickerId: 'not-a-uuid' })}\n`)).toThrow(
      /第 1 行/,
    );
    expect(() => parseStickerLabelFile(`${jsonlRow({ 可信度: 1.5 })}\n`)).toThrow(/可信度/);
    expect(() => parseStickerLabelFile(`${jsonlRow()}\n${jsonlRow()}\n`)).toThrow(/重复/);
    expect(() => parseStickerLabelFile('not json\n')).toThrow(/合法 JSON/);
  });
});

/** 内存假数据库：只实现回填用到的三类语句，upsert 按 sticker_id 覆盖。 */
class FakeDb implements LabelDbClient {
  stickers = new Map<string, { id: string; media_id: string; deleted_at: Date | null }>();
  objects = new Map<string, { id: string; content_hash: string | null }>();
  labels = new Map<string, unknown[]>();

  async query<Row>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    if (text.includes('pg_try_advisory_xact_lock')) {
      return { rows: [{ locked: true }] as Row[], rowCount: 1 };
    }
    if (text.includes('FROM media.library_stickers')) {
      const ids = (values?.[0] ?? []) as string[];
      const rows = ids.flatMap((id) => {
        const row = this.stickers.get(id);
        return row ? [row] : [];
      });
      return { rows: rows as Row[], rowCount: rows.length };
    }
    if (text.includes('FROM media.objects')) {
      const ids = (values?.[0] ?? []) as string[];
      const rows = ids.flatMap((id) => {
        const row = this.objects.get(id);
        return row ? [row] : [];
      });
      return { rows: rows as Row[], rowCount: rows.length };
    }
    if (text.startsWith('INSERT INTO media.library_sticker_labels')) {
      const params = values ?? [];
      this.labels.set(String(params[0]), [...params]);
      return { rows: [] as Row[], rowCount: 1 };
    }
    throw new Error(`意外的查询：${text.slice(0, 60)}`);
  }
}

function matchingDb(): FakeDb {
  const db = new FakeDb();
  db.stickers.set(STICKER_A, { id: STICKER_A, media_id: MEDIA_A, deleted_at: null });
  db.objects.set(MEDIA_A, { id: MEDIA_A, content_hash: HASH_A });
  return db;
}

describe('backfillStickerLabels', () => {
  it('validate 模式只校验不写', async () => {
    const db = matchingDb();
    const summary = await backfillStickerLabels(db, [fileRow()], { apply: false });
    expect(summary).toMatchObject({ mode: 'validate', total: 1, valid: 1, written: 0, skipped: 0 });
    expect(db.labels.size).toBe(0);
  });

  it('重跑不产生重复行，第二次覆盖第一次的值（幂等）', async () => {
    const db = matchingDb();
    const first = await backfillStickerLabels(db, [fileRow()], { apply: true });
    const second = await backfillStickerLabels(db, [fileRow({ usageMeaning: '新版使用意思' })], {
      apply: true,
    });
    expect(first.written).toBe(1);
    expect(second.written).toBe(1);
    expect(db.labels.size).toBe(1);
    expect(db.labels.get(STICKER_A)?.[6]).toBe('新版使用意思');
  });

  it('review 行同时写 review_needed 与 retry_excluded', async () => {
    const db = matchingDb();
    const summary = await backfillStickerLabels(
      db,
      [fileRow({ reviewNeeded: true, confidence: 0.1 })],
      {
        apply: true,
      },
    );
    expect(summary.excluded).toBe(1);
    const params = db.labels.get(STICKER_A);
    expect(params?.[12]).toBe(true);
    expect(params?.[13]).toBe(true);
  });

  it('三键对不上的行只记 failures、不硬写', async () => {
    const db = matchingDb();
    db.stickers.set(STICKER_B, { id: STICKER_B, media_id: MEDIA_B, deleted_at: null });
    db.stickers.set(STICKER_C, { id: STICKER_C, media_id: MEDIA_A, deleted_at: new Date() });
    const rows = [
      fileRow({ stickerId: '44444444-4444-4444-8444-444444444444' }),
      fileRow({ stickerId: STICKER_B, mediaId: MEDIA_A }),
      fileRow({ stickerId: STICKER_C }),
      fileRow({ stickerId: STICKER_A, contentHash: HASH_B }),
    ];
    const summary = await backfillStickerLabels(db, rows, { apply: true });
    expect(summary).toMatchObject({ total: 4, valid: 0, written: 0, skipped: 4 });
    expect(summary.failures.map((f) => f.reason)).toEqual([
      'sticker_not_found',
      'media_id_mismatch',
      'sticker_deleted',
      'content_hash_mismatch',
    ]);
    expect(db.labels.size).toBe(0);
  });

  it('同一 media 标签不一致时以第一行为准并记 warning', async () => {
    const db = matchingDb();
    db.stickers.set(STICKER_B, { id: STICKER_B, media_id: MEDIA_A, deleted_at: null });
    const summary = await backfillStickerLabels(
      db,
      [fileRow(), fileRow({ stickerId: STICKER_B, usageMeaning: '另一份意思' })],
      { apply: true },
    );
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]?.reason).toBe('media_label_inconsistent_using_first');
    expect(db.labels.get(STICKER_B)?.[6]).toBe('安慰对方');
  });
});
