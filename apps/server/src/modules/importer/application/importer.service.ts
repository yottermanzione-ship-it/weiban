/**
 * importer：导入聊天记录生成角色草稿（CHR-08）、导入资料生成补充设定（CHR-09），T-079。
 *
 * 状态机（契约 ImportJobStatus）：
 *   text：创建即 detecting → awaiting_speaker | failed
 *   file：collecting →（uploadFile 若干次）→ finishUpload → detecting → awaiting_speaker | failed
 *   screenshots：collecting →（上传截图）→ finishUpload → detecting（识图）→ awaiting_dialogue_confirmation
 *                → confirmDialogue → awaiting_speaker | failed
 *   awaiting_speaker → selectSpeaker（给出预计花费）→ ready → start（余额检查）→ analyzing → completed | failed
 *   failed（分析阶段）可再次 start 重试；任何阶段可 cancel（删除任务与原文）。
 *
 * 原文（security-and-privacy.md 5.3）：
 *   - 上传 / 粘贴的文字与识别出的对话按用户数据密钥加密存 importer.import_raw；截图存 media（import_screenshot）。
 *   - 分析成功且未勾选「保留原文」：在同一个事务里删除原文行与截图并写 raw_deleted_at。
 *   - 分析失败时暂留原文供「重试」；兜底清扫每小时删除所有未勾选保留、创建超过 24 小时的原文。
 *   - 原文从不写日志、事件载荷。
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  IMPORT_LIMITS,
  ImportJob,
  ImportKind,
  ImportResult,
  ImportSourceKind,
  Id,
  MEDIA_LIMITS,
  RecognizedDialogueLine,
  type BillingReadPort,
  type ImportDialogueLine,
  type MediaSystemPort,
  type PushPort,
  type SyncPort,
  type Tx,
} from '@weiban/contracts';
import { z } from 'zod';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  LOGGER,
  OUTBOX,
  USER_DATA_REGISTRY,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type JobQueue,
  type Logger,
  type Outbox,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { PUSH_PORT } from '../../push/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { keepRecent, normalizeText, parseDialogue, speakerStats } from '../domain/parse.js';
import { importJobs, importRaw } from '../infra/db/schema.js';
import { IMPORTER_ANALYZER, type ImporterAnalyzer } from '../tokens.js';

type JobRow = typeof importJobs.$inferSelect;
type JobDto = z.infer<typeof ImportJob>;
type ResultDto = z.infer<typeof ImportResult>;
type Line = ImportDialogueLine & { screenshotIndex?: number };

export const IMPORTER_DETECT_JOB = 'importer.detect';
export const IMPORTER_ANALYZE_JOB = 'importer.analyze';
export const IMPORTER_RAW_SWEEP_JOB = 'importer.raw_sweep';
const RAW_TTL_MS = 24 * 3600_000;
const LIST_DAYS = 30;
/** 原文按块加密，每块最多这么多字符。 */
const CHUNK = 50_000;
/** 模型识别发言人时给的样本长度。 */
const SAMPLE_CHARS = 4_000;

const CreateBody = z.object({
  clientRequestId: Id,
  kind: ImportKind,
  targetCharacterId: Id.nullable().optional(),
  sourceKind: ImportSourceKind,
  text: z.string().min(1).optional(),
});

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
  size?: number;
}

const TEXT_MIME = /^(text\/|application\/(csv|vnd\.ms-excel|octet-stream)$)/;
const IMAGE_MIME = /^image\/(png|jpe?g|webp|heic|heif|gif)$/;

@Injectable()
export class ImporterService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Optional() @Inject(PUSH_PORT) private readonly push?: PushPort,
    @Optional() @Inject(IMPORTER_ANALYZER) private readonly analyzer?: ImporterAnalyzer,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'importer',
      purgeUser: (userId) => this.purgeUser(userId),
      countUserData: (userId) => this.countUserData(userId),
    });
    await this.jobs.work<{ jobId: string }>(IMPORTER_DETECT_JOB, (job) =>
      this.detect(job.data.jobId),
    );
    await this.jobs.work<{ jobId: string }>(IMPORTER_ANALYZE_JOB, (job) =>
      this.analyze(job.data.jobId),
    );
    await this.jobs.work(IMPORTER_RAW_SWEEP_JOB, () => this.sweepRaw());
    await this.jobs.schedule(IMPORTER_RAW_SWEEP_JOB, '17 * * * *');
  }

  // ---------- 接口 ----------

  async createJob(userId: string, input: unknown): Promise<JobDto> {
    const body = parseContract(CreateBody, input);
    if (body.kind === 'supplement' && !body.targetCharacterId)
      throw new AppError('bad_request', '补充设定导入需要指定角色');
    if (body.sourceKind === 'text' && !body.text?.trim())
      throw new AppError('bad_request', '请粘贴聊天记录');
    const [existing] = await this.db.db
      .select()
      .from(importJobs)
      .where(
        and(eq(importJobs.userId, userId), eq(importJobs.clientRequestId, body.clientRequestId)),
      );
    if (existing) return this.dto(existing);
    const now = this.clock.now();
    const id = newId();
    const row = await this.db.transaction(async (tx) => {
      const inserted = await tx.db
        .insert(importJobs)
        .values({
          id,
          userId,
          clientRequestId: body.clientRequestId,
          kind: body.kind,
          targetCharacterId: body.kind === 'supplement' ? (body.targetCharacterId ?? null) : null,
          sourceKind: body.sourceKind,
          status: body.sourceKind === 'text' ? 'detecting' : 'collecting',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      const created = inserted[0];
      if (!created) return null;
      if (body.sourceKind === 'text') {
        await this.appendText(tx, userId, id, body.text!);
        await this.jobs.send(
          IMPORTER_DETECT_JOB,
          { jobId: id },
          { tx, singletonKey: `detect:${id}` },
        );
      }
      await this.dataChanged(tx, userId, id);
      return created;
    });
    if (!row) {
      const [again] = await this.db.db
        .select()
        .from(importJobs)
        .where(
          and(eq(importJobs.userId, userId), eq(importJobs.clientRequestId, body.clientRequestId)),
        );
      if (!again) throw new AppError('internal_error', '导入任务未能创建');
      return this.dto(again);
    }
    return this.dto(row);
  }

  async uploadFile(userId: string, jobId: string, file: UploadedFile | undefined): Promise<JobDto> {
    if (!file?.buffer?.length) throw new AppError('bad_request', '请选择文件');
    const job = await this.own(userId, jobId);
    if (job.status !== 'collecting') throw new AppError('conflict', '当前不能再上传文件');
    const mime = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    if (job.sourceKind === 'file') {
      if (!(TEXT_MIME.test(mime) || name.endsWith('.txt') || name.endsWith('.csv')))
        throw new AppError('bad_request', '只支持 .txt / .csv 文件');
      if (file.buffer.length > MEDIA_LIMITS.importFileMaxBytes)
        throw new AppError('bad_request', '文件太大');
      const text = decodeText(file.buffer);
      await this.db.transaction(async (tx) => {
        await this.appendText(tx, userId, jobId, text, name.endsWith('.csv') ? 'csv' : null);
        await this.touch(tx, jobId);
      });
    } else if (job.sourceKind === 'screenshots') {
      if (!IMAGE_MIME.test(mime)) throw new AppError('bad_request', '只支持图片格式的截图');
      if (job.screenshotCount >= IMPORT_LIMITS.maxScreenshots)
        throw new AppError('limit_reached', `截图单次最多 ${IMPORT_LIMITS.maxScreenshots} 张`);
      const media = await this.media.putObject({
        ownerUserId: userId,
        purpose: 'import_screenshot',
        bytes: file.buffer,
        mimeType: mime,
      });
      await this.db.transaction(async (tx) => {
        const [locked] = await tx.db
          .select()
          .from(importJobs)
          .where(eq(importJobs.id, jobId))
          .for('update');
        if (!locked || locked.screenshotCount >= IMPORT_LIMITS.maxScreenshots) {
          await this.media.deleteObject(media.mediaId, tx as unknown as Tx).catch(() => undefined);
          throw new AppError('limit_reached', `截图单次最多 ${IMPORT_LIMITS.maxScreenshots} 张`);
        }
        await tx.db.insert(importRaw).values({
          id: newId(),
          jobId,
          userId,
          part: 'screenshot',
          seq: locked.screenshotCount,
          mediaId: media.mediaId,
          ciphertext: null,
          createdAt: this.clock.now(),
        });
        await tx.db
          .update(importJobs)
          .set({ screenshotCount: locked.screenshotCount + 1, updatedAt: this.clock.now() })
          .where(eq(importJobs.id, jobId));
      });
    } else throw new AppError('conflict', '粘贴文字的导入不需要上传文件');
    return this.getJob(userId, jobId);
  }

  async finishUpload(userId: string, jobId: string): Promise<JobDto> {
    const job = await this.own(userId, jobId);
    if (job.status !== 'collecting') return this.dto(job);
    const raw = await this.db.db
      .select({ id: importRaw.id })
      .from(importRaw)
      .where(eq(importRaw.jobId, jobId))
      .limit(1);
    if (!raw.length) throw new AppError('bad_request', '还没有上传内容');
    await this.db.transaction(async (tx) => {
      await this.setStatus(tx, job, { status: 'detecting' });
      await this.jobs.send(IMPORTER_DETECT_JOB, { jobId }, { tx, singletonKey: `detect:${jobId}` });
    });
    return this.getJob(userId, jobId);
  }

  async listJobs(userId: string): Promise<{ items: JobDto[] }> {
    const since = new Date(this.clock.nowMs() - LIST_DAYS * 24 * 3600_000);
    const rows = await this.db.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.userId, userId), gte(importJobs.createdAt, since)))
      .orderBy(desc(importJobs.createdAt));
    return { items: rows.map((r) => this.dto(r)) };
  }

  async getJob(userId: string, jobId: string): Promise<JobDto> {
    return this.dto(await this.own(userId, jobId));
  }

  async getDialogue(
    userId: string,
    jobId: string,
  ): Promise<{ items: z.infer<typeof RecognizedDialogueLine>[] }> {
    const job = await this.own(userId, jobId);
    if (job.sourceKind !== 'screenshots')
      throw new AppError('conflict', '只有截图导入需要确认对话');
    const lines = await this.readLines(job);
    return {
      items: lines.map((l, i) =>
        RecognizedDialogueLine.parse({
          lineId: String(i + 1),
          speaker: l.speaker.slice(0, 40),
          text: l.text.slice(0, 2000),
          screenshotIndex: l.screenshotIndex ?? 0,
        }),
      ),
    };
  }

  async confirmDialogue(
    userId: string,
    jobId: string,
    body: { lines?: z.infer<typeof RecognizedDialogueLine>[] },
  ): Promise<JobDto> {
    const job = await this.own(userId, jobId);
    if (job.status !== 'awaiting_dialogue_confirmation')
      throw new AppError('conflict', '当前不需要确认对话');
    const lines: Line[] = body.lines
      ? body.lines
          .filter((l) => l.speaker.trim() && l.text.trim())
          .map((l) => ({
            speaker: l.speaker.trim(),
            text: l.text,
            screenshotIndex: l.screenshotIndex,
          }))
      : await this.readLines(job);
    await this.db.transaction(async (tx) => {
      await this.applyLines(tx, job, lines);
    });
    return this.getJob(userId, jobId);
  }

  async selectSpeaker(userId: string, jobId: string, speaker: string): Promise<JobDto> {
    const job = await this.own(userId, jobId);
    if (!['awaiting_speaker', 'ready'].includes(job.status))
      throw new AppError('conflict', '当前不能选择发言人');
    if (!job.speakers.some((s) => s.name === speaker))
      throw new AppError('bad_request', '请从识别出的发言人中选择');
    const estimated = this.analyzer
      ? await this.analyzer
          .estimate({ userId, charCount: job.charCount, screenshotCount: job.screenshotCount })
          .catch(() => null)
      : null;
    await this.db.transaction(async (tx) => {
      await this.setStatus(tx, job, {
        status: 'ready',
        selectedSpeaker: speaker,
        estimatedMicros: estimated === null ? null : Math.max(0, Math.round(estimated)),
      });
    });
    return this.getJob(userId, jobId);
  }

  async start(userId: string, jobId: string, body: { keepRaw: boolean }): Promise<JobDto> {
    const job = await this.own(userId, jobId);
    const retry = job.status === 'failed' && !!job.selectedSpeaker && !job.rawDeletedAt;
    if (job.status !== 'ready' && !retry) throw new AppError('conflict', '当前不能开始生成');
    if (!this.analyzer) throw new AppError('service_disabled', '导入分析暂不可用');
    // CHR-08 第 7 条：余额不足以完成时不开始。
    const spend = await this.billing.getSpendStatus(userId);
    if (spend.insufficient || spend.availableMicros < (job.estimatedMicros ?? 1))
      throw new AppError('insufficient_balance', '余额不足');
    await this.db.transaction(async (tx) => {
      await this.setStatus(tx, job, {
        status: 'analyzing',
        keepRaw: body.keepRaw,
        progress: 0,
        failure: null,
      });
      await this.jobs.send(
        IMPORTER_ANALYZE_JOB,
        { jobId },
        { tx, singletonKey: `analyze:${jobId}:${this.clock.nowMs()}`, retryLimit: 0 },
      );
    });
    return this.getJob(userId, jobId);
  }

  async getResult(userId: string, jobId: string): Promise<ResultDto> {
    const job = await this.own(userId, jobId);
    if (job.status !== 'completed' || !job.resultCiphertext)
      throw new AppError('conflict', '结果还没有生成');
    const plain = await this.crypto.open(userId, `importer:result:${jobId}`, job.resultCiphertext);
    try {
      return ImportResult.parse(JSON.parse(plain.toString('utf8')));
    } finally {
      plain.fill(0);
    }
  }

  async saveResultDraft(userId: string, jobId: string, input: unknown): Promise<ResultDto> {
    const result = parseContract(ImportResult, input);
    const job = await this.own(userId, jobId);
    if (job.status !== 'completed') throw new AppError('conflict', '结果还没有生成');
    if (result.kind !== job.kind) throw new AppError('bad_request', '结果类型与导入任务不符');
    if (result.kind === 'supplement' && result.targetCharacterId !== job.targetCharacterId)
      throw new AppError('bad_request', '补充设定的角色与导入任务不符');
    await this.db.transaction(async (tx) => {
      const sealed = await this.crypto.seal(
        userId,
        `importer:result:${jobId}`,
        JSON.stringify(result),
        tx,
      );
      await tx.db
        .update(importJobs)
        .set({ resultCiphertext: sealed, updatedAt: this.clock.now() })
        .where(eq(importJobs.id, jobId));
      await this.dataChanged(tx, userId, jobId);
    });
    return result;
  }

  async cancel(userId: string, jobId: string): Promise<void> {
    parseContract(Id, jobId);
    await this.db.transaction(async (tx) => {
      const [job] = await tx.db
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
        .for('update');
      if (!job) return;
      await this.deleteRawIn(tx, jobId);
      await tx.db.delete(importJobs).where(eq(importJobs.id, jobId));
      await this.dataChanged(tx, userId, jobId);
    });
  }

  async deleteRaw(userId: string, jobId: string): Promise<JobDto> {
    const job = await this.own(userId, jobId);
    if (job.status === 'analyzing') throw new AppError('conflict', '生成中不能删除原文');
    await this.db.transaction(async (tx) => {
      await this.deleteRawIn(tx, jobId);
      await tx.db
        .update(importJobs)
        .set({ rawDeletedAt: job.rawDeletedAt ?? this.clock.now(), updatedAt: this.clock.now() })
        .where(eq(importJobs.id, jobId));
      await this.dataChanged(tx, userId, jobId);
    });
    return this.getJob(userId, jobId);
  }

  // ---------- 后台任务 ----------

  /** 识别格式与发言人（文字走规则，规则不行再交模型；截图走识图）。 */
  async detect(jobId: string): Promise<void> {
    const [job] = await this.db.db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job || job.status !== 'detecting') return;
    try {
      if (job.sourceKind === 'screenshots') {
        const shots = await this.db.db
          .select()
          .from(importRaw)
          .where(and(eq(importRaw.jobId, jobId), eq(importRaw.part, 'screenshot')))
          .orderBy(asc(importRaw.seq));
        if (!this.analyzer) return this.fail(job, 'vision_unavailable');
        const result = await this.analyzer.recognizeScreenshots({
          userId: job.userId,
          jobId,
          mediaIds: shots.map((s) => s.mediaId!).filter(Boolean),
          idempotencyKey: `importer:recognize:${jobId}`,
        });
        if (!result.ok) return this.fail(job, result.error);
        await this.db.transaction(async (tx) => {
          await this.writeLines(tx, job, result.value);
          await this.setStatus(tx, job, {
            status: 'awaiting_dialogue_confirmation',
            charCount: result.value.reduce((n, l) => n + l.text.length, 0),
          });
        });
        return;
      }
      const { text, fileHint } = await this.readText(job);
      let parsed = parseDialogue(text, fileHint);
      if (!parsed.lines.length && this.analyzer) {
        const sample = text.slice(0, SAMPLE_CHARS);
        const ai = await this.analyzer.detectSpeakers({
          userId: job.userId,
          jobId,
          sample,
          idempotencyKey: `importer:detect:${jobId}`,
        });
        if (!ai.ok)
          return this.fail(
            job,
            ai.error === 'format_unrecognized' ? 'format_unrecognized' : ai.error,
          );
        // 模型只看样本：样本之外按样本识别出的「名字：」规则继续切分。
        const names = new Set(ai.value.map((l) => l.speaker));
        parsed = { lines: splitByNames(text, names), format: null };
        if (!parsed.lines.length) parsed = { lines: ai.value, format: null };
      }
      if (new Set(parsed.lines.map((l) => l.speaker)).size < 2)
        return this.fail(job, 'format_unrecognized');
      await this.db.transaction(async (tx) => {
        await this.applyLines(tx, job, parsed.lines);
      });
    } catch (error) {
      this.logger.error({ jobId, err: (error as Error).name }, 'importer.detect failed');
      await this.fail(job, 'internal');
    }
  }

  async analyze(jobId: string): Promise<void> {
    const [job] = await this.db.db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job || job.status !== 'analyzing') return;
    if (!this.analyzer || !job.selectedSpeaker) return this.fail(job, 'model_unavailable', true);
    let lastProgress = 0;
    let lastWrite = 0;
    try {
      const lines = await this.readLines(job);
      const result = await this.analyzer.analyze({
        userId: job.userId,
        jobId,
        kind: job.kind as 'new_character' | 'supplement',
        targetCharacterId: job.targetCharacterId,
        speaker: job.selectedSpeaker,
        lines: lines.map((l) => ({ speaker: l.speaker, text: l.text })),
        idempotencyKey: `importer:analyze:${jobId}:${job.updatedAt.getTime()}`,
        onProgress: (percent) => {
          const p = Math.max(0, Math.min(99, Math.round(percent)));
          const now = this.clock.nowMs();
          if (p <= lastProgress || now - lastWrite < 2000) return;
          lastProgress = p;
          lastWrite = now;
          void this.db.db
            .update(importJobs)
            .set({ progress: p, updatedAt: this.clock.now() })
            .where(and(eq(importJobs.id, jobId), eq(importJobs.status, 'analyzing')))
            .catch(() => undefined);
        },
      });
      if (!result.ok) return this.fail(job, result.error, true);
      const value = ImportResult.parse(result.value);
      await this.db.transaction(async (tx) => {
        const [current] = await tx.db
          .select()
          .from(importJobs)
          .where(eq(importJobs.id, jobId))
          .for('update');
        // 任务中途被取消。
        if (!current || current.status !== 'analyzing') return;
        const sealed = await this.crypto.seal(
          job.userId,
          `importer:result:${jobId}`,
          JSON.stringify(value),
          tx,
        );
        const now = this.clock.now();
        let rawDeletedAt: Date | null = current.rawDeletedAt;
        if (!current.keepRaw) {
          await this.deleteRawIn(tx, jobId);
          rawDeletedAt = rawDeletedAt ?? now;
        }
        await tx.db
          .update(importJobs)
          .set({
            status: 'completed',
            progress: 100,
            failure: null,
            resultCiphertext: sealed,
            rawDeletedAt,
            updatedAt: now,
          })
          .where(eq(importJobs.id, jobId));
        await this.outbox.publish(tx, 'importer.job_completed', 'importer', {
          userId: job.userId,
          jobId,
          kind: job.kind as 'new_character' | 'supplement',
          ok: true,
        });
        await this.dataChanged(tx, job.userId, jobId);
      });
      await this.notify(job, true);
    } catch (error) {
      this.logger.error({ jobId, err: (error as Error).name }, 'importer.analyze failed');
      await this.fail(job, 'internal', true);
    }
  }

  /** 兜底清扫：未勾选保留、创建超过 24 小时的原文一律删除。 */
  async sweepRaw(): Promise<void> {
    const before = new Date(this.clock.nowMs() - RAW_TTL_MS);
    const stale = await this.db.db
      .selectDistinct({ jobId: importRaw.jobId })
      .from(importRaw)
      .innerJoin(importJobs, eq(importJobs.id, importRaw.jobId))
      .where(
        and(
          eq(importJobs.keepRaw, false),
          lt(importJobs.createdAt, before),
          // 正在分析的任务不动，结束后由任务本身删除。
          inArray(importJobs.status, [
            'collecting',
            'detecting',
            'awaiting_dialogue_confirmation',
            'awaiting_speaker',
            'ready',
            'completed',
            'failed',
            'cancelled',
          ]),
        ),
      )
      .limit(500);
    for (const { jobId } of stale) {
      await this.db.transaction(async (tx) => {
        await this.deleteRawIn(tx, jobId);
        const [job] = await tx.db
          .update(importJobs)
          .set({ rawDeletedAt: this.clock.now(), updatedAt: this.clock.now() })
          .where(eq(importJobs.id, jobId))
          .returning();
        if (job) await this.dataChanged(tx, job.userId, jobId);
      });
    }
  }

  // ---------- 内部 ----------

  private async own(userId: string, jobId: string): Promise<JobRow> {
    parseContract(Id, jobId);
    const [job] = await this.db.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)));
    if (!job) throw new AppError('not_found', '导入任务不存在');
    return job;
  }

  private async appendText(
    tx: DbTx,
    userId: string,
    jobId: string,
    raw: string,
    hint: 'csv' | null = null,
  ): Promise<void> {
    const text = normalizeText(raw);
    const [last] = await tx.db
      .select({ seq: importRaw.seq })
      .from(importRaw)
      .where(and(eq(importRaw.jobId, jobId), eq(importRaw.part, 'text')))
      .orderBy(desc(importRaw.seq))
      .limit(1);
    let seq = (last?.seq ?? -1) + 1;
    // 第一块前缀一个文件类型提示（不是原文内容），识别 CSV 用。
    const payload = seq === 0 && hint ? `\u0000csv\u0000${text}` : seq > 0 ? `\n${text}` : text;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const id = newId();
      await tx.db.insert(importRaw).values({
        id,
        jobId,
        userId,
        part: 'text',
        seq,
        mediaId: null,
        ciphertext: await this.crypto.seal(
          userId,
          `importer:raw:${id}`,
          payload.slice(i, i + CHUNK),
          tx,
        ),
        createdAt: this.clock.now(),
      });
      seq += 1;
    }
  }

  private async readText(job: JobRow): Promise<{ text: string; fileHint: string | null }> {
    const rows = await this.db.db
      .select()
      .from(importRaw)
      .where(and(eq(importRaw.jobId, job.id), eq(importRaw.part, 'text')))
      .orderBy(asc(importRaw.seq));
    let text = '';
    for (const row of rows) {
      if (!row.ciphertext) continue;
      text += (
        await this.crypto.open(job.userId, `importer:raw:${row.id}`, row.ciphertext)
      ).toString('utf8');
    }
    if (text.startsWith('\u0000csv\u0000')) return { text: text.slice(5), fileHint: 'import.csv' };
    return { text, fileHint: null };
  }

  /** 识别出的对话：截断到最近的 maxChars、统计发言人、写入、进入选发言人或失败。 */
  private async applyLines(tx: DbTx, job: JobRow, all: Line[]): Promise<void> {
    const kept = keepRecent(all, IMPORT_LIMITS.maxChars);
    const speakers = speakerStats(kept.lines);
    await this.writeLines(tx, job, kept.lines);
    if (speakers.length < 2) {
      await this.setStatus(tx, job, {
        status: 'failed',
        failure: 'format_unrecognized',
        speakers,
        charCount: kept.charCount,
        truncated: kept.truncated,
      });
      return;
    }
    await this.setStatus(tx, job, {
      status: 'awaiting_speaker',
      speakers,
      charCount: kept.charCount,
      truncated: kept.truncated,
      selectedSpeaker: null,
      estimatedMicros: null,
    });
  }

  private async writeLines(tx: DbTx, job: JobRow, lines: Line[]): Promise<void> {
    await tx.db
      .delete(importRaw)
      .where(and(eq(importRaw.jobId, job.id), eq(importRaw.part, 'lines')));
    const json = JSON.stringify(lines);
    let seq = 0;
    for (let i = 0; i < json.length; i += CHUNK * 4) {
      const id = newId();
      await tx.db.insert(importRaw).values({
        id,
        jobId: job.id,
        userId: job.userId,
        part: 'lines',
        seq,
        mediaId: null,
        ciphertext: await this.crypto.seal(
          job.userId,
          `importer:raw:${id}`,
          json.slice(i, i + CHUNK * 4),
          tx,
        ),
        createdAt: this.clock.now(),
      });
      seq += 1;
    }
  }

  private async readLines(job: JobRow): Promise<Line[]> {
    const rows = await this.db.db
      .select()
      .from(importRaw)
      .where(and(eq(importRaw.jobId, job.id), eq(importRaw.part, 'lines')))
      .orderBy(asc(importRaw.seq));
    if (!rows.length) return [];
    let json = '';
    for (const row of rows) {
      if (!row.ciphertext) continue;
      json += (
        await this.crypto.open(job.userId, `importer:raw:${row.id}`, row.ciphertext)
      ).toString('utf8');
    }
    const parsed = z
      .array(
        z.object({
          speaker: z.string(),
          text: z.string(),
          screenshotIndex: z.number().int().nonnegative().optional(),
        }),
      )
      .safeParse(JSON.parse(json || '[]'));
    return parsed.success ? parsed.data : [];
  }

  /** 物理删除原文行与截图（同一事务）。 */
  private async deleteRawIn(tx: DbTx, jobId: string): Promise<void> {
    const shots = await tx.db
      .select({ mediaId: importRaw.mediaId })
      .from(importRaw)
      .where(and(eq(importRaw.jobId, jobId), eq(importRaw.part, 'screenshot')));
    for (const shot of shots)
      if (shot.mediaId) await this.media.deleteObject(shot.mediaId, tx as unknown as Tx);
    await tx.db.delete(importRaw).where(eq(importRaw.jobId, jobId));
  }

  private async setStatus(
    tx: DbTx,
    job: JobRow,
    patch: Partial<Omit<JobRow, 'id' | 'userId' | 'createdAt'>>,
  ): Promise<void> {
    await tx.db
      .update(importJobs)
      .set({ ...patch, updatedAt: this.clock.now() })
      .where(eq(importJobs.id, job.id));
    await this.dataChanged(tx, job.userId, job.id);
  }

  private async touch(tx: DbTx, jobId: string): Promise<void> {
    await tx.db
      .update(importJobs)
      .set({ updatedAt: this.clock.now() })
      .where(eq(importJobs.id, jobId));
  }

  private async fail(job: JobRow, failure: string, analysis = false): Promise<void> {
    const known = [
      'format_unrecognized',
      'insufficient_balance',
      'model_unavailable',
      'vision_unavailable',
    ];
    await this.db.transaction(async (tx) => {
      const [current] = await tx.db
        .select()
        .from(importJobs)
        .where(eq(importJobs.id, job.id))
        .for('update');
      if (!current || current.status === 'completed') return;
      await this.setStatus(tx, current, {
        status: 'failed',
        failure: known.includes(failure) ? failure : 'internal',
      });
      if (analysis)
        await this.outbox.publish(tx, 'importer.job_completed', 'importer', {
          userId: job.userId,
          jobId: job.id,
          kind: job.kind as 'new_character' | 'supplement',
          ok: false,
        });
    });
    if (analysis) await this.notify(job, false);
  }

  private async notify(job: JobRow, ok: boolean): Promise<void> {
    if (!this.push) return;
    // 契约 PushRequest.kind 还没有 import（NotificationKind 已有），暂用 system，见交接说明。
    await this.push
      .send({
        userId: job.userId,
        kind: 'system',
        title: ok ? '导入完成' : '导入没有完成',
        body: ok
          ? job.kind === 'supplement'
            ? '补充设定已生成，点开确认'
            : '角色草稿已生成，点开继续编辑'
          : '没能生成，点开查看原因',
        deepLink: `/imports/${job.id}`,
        conversationId: null,
        dedupeKey: `import:${job.id}:${ok ? 'ok' : 'fail'}:${job.updatedAt.getTime()}`,
        dedupeWindowHours: 24,
        respectsDoNotDisturb: false,
      })
      .catch(() => undefined);
  }

  private dto(row: JobRow): JobDto {
    return ImportJob.parse({
      jobId: row.id,
      kind: row.kind,
      targetCharacterId: row.targetCharacterId,
      sourceKind: row.sourceKind,
      status: row.status,
      speakers: row.speakers.map((s) => ({
        name: s.name.slice(0, 40),
        messageCount: s.messageCount,
      })),
      selectedSpeaker: row.selectedSpeaker,
      charCount: row.charCount,
      truncated: row.truncated,
      estimatedMicros: row.estimatedMicros,
      progress: row.progress,
      keepRaw: row.keepRaw,
      rawDeletedAt: row.rawDeletedAt?.toISOString() ?? null,
      failure: row.failure,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private async dataChanged(tx: DbTx, userId: string, itemId: string | null): Promise<void> {
    await this.sync.appendUpdate(tx as unknown as Tx, userId, {
      type: 'data.changed',
      data: { section: 'imports', characterId: null, itemId },
    });
  }

  private async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const jobs = await tx.db
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(eq(importJobs.userId, userId));
      for (const j of jobs) await this.deleteRawIn(tx, j.id);
      const leftover = await tx.db
        .delete(importRaw)
        .where(eq(importRaw.userId, userId))
        .returning({ id: importRaw.id });
      const removed = await tx.db
        .delete(importJobs)
        .where(eq(importJobs.userId, userId))
        .returning({ id: importJobs.id });
      return removed.length + leftover.length;
    });
  }

  private async countUserData(userId: string): Promise<number> {
    const a = await this.db.db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(eq(importJobs.userId, userId));
    const b = await this.db.db
      .select({ id: importRaw.id })
      .from(importRaw)
      .where(eq(importRaw.userId, userId));
    return a.length + b.length;
  }
}

/** 文件解码：UTF-8（带或不带 BOM）；含大量替换字符时按 GB18030 再试（Windows 导出的 .txt / .csv 常见）。 */
function decodeText(buffer: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 10 && bad > utf8.length / 200) {
    try {
      return new TextDecoder('gb18030').decode(buffer);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/** 已知发言人名字后按「名字：内容」切分全文（模型识别样本后的延伸）。 */
function splitByNames(text: string, names: Set<string>): ImportDialogueLine[] {
  const lines: ImportDialogueLine[] = [];
  for (const raw of normalizeText(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.{1,40}?)\s*[:：]\s?(.+)$/.exec(line);
    if (m && names.has(m[1]!.trim())) lines.push({ speaker: m[1]!.trim(), text: m[2]!.trim() });
    else if (lines.length) lines[lines.length - 1]!.text += `\n${line}`;
  }
  return new Set(lines.map((l) => l.speaker)).size >= 2 ? lines : [];
}
