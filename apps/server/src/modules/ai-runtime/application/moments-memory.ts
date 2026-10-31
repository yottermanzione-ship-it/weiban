/**
 * 私人朋友圈记忆写回（2026-10-31 04:42 / 04:53 决定，晓楠 06:00 批准实施）。
 *
 * 触发（显式任务口子，不新增 observe 调用；点赞不触发）：
 * - 角色私人动态发布成功 → post 批次（moments-ai.maybePost 投递）；
 * - 用户评论角色私人动态 → thread 批次（moments-ai.onCommentCreated 投递）；
 * - 角色回复评论 → reply 批次（moments-ai.react0 投递）。
 * 公开内容（公开草稿文本、微博转发）在投递侧与任务执行时各拦一次，拦不住也不会写错：
 * 执行时复核帖子仍在、仍是该角色的动态、仍不是公开草稿文本，任一不符直接丢弃不重试。
 *
 * 写入：经 MemoryService.applyExternal，范围一律 normal，来源值 'moments'
 * （需 0150 迁移放宽 memories 表 check 约束）。每批最多 3 个操作，不存全文，
 * 纯客套只产 NOOP 操作（不写库）。来源 id 直接用动态/评论的 UUID：
 * MemoryEntry.sourceMessageIds 是 z.array(Id)，带 moments: 前缀的字符串会在读回
 * 解析（MemoryEntry.parse）时失败；命名空间改由行上的 origin='moments' 承担。
 * 批次 id 仍用 moments: 命名空间（moments:post:<postId> 等），幂等键取自批次 id。
 *
 * 尽力而为：网关失败、解析失败、快照不符、revision 对不上、账号/好友状态变化
 * 一律丢弃不重试（网关幂等键会回放缓存的失败，重试没有意义）；只有数据库等
 * 基础设施异常才抛错走 pg-boss 有界重试。写回失败绝不影响发帖与回复主流程。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  type ContactsReadPort,
  type IdentityAccountStatusPort,
  type ModelGatewayPort,
  type MomentsPost,
  type MomentsReadPort,
} from '@weiban/contracts';
import {
  AppError,
  DATABASE,
  JOB_QUEUE,
  type Database,
  type JobQueue,
} from '../../../platform/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { MOMENTS_READ_PORT } from '../../moments/index.js';
import { publicMomentDrafts } from '../infra/db/ecology-schema.js';
import { ExtractedMemory, healthPrivate, type ExtractedOperation } from '../domain/memory.js';
import { localParts } from './proactive-scheduler.js';
import { MemoryService } from './memory.js';

/** 朋友圈记忆提取任务名（与群聊/通话提取任务同命名惯例）。 */
export const MOMENTS_MEMORY_JOB = 'ai.extract_moments_memory';

/** 每批最多写入的操作数（04:42 决定）。 */
export const MOMENTS_MEMORY_MAX_OPERATIONS = 3;

export type MomentsMemoryKind = 'post' | 'thread' | 'reply';

export interface MomentsMemoryJob {
  batchId: string;
  kind: MomentsMemoryKind;
  userId: string;
  characterId: string;
  postId: string;
  /** thread / reply 批次触发的那条评论。 */
  commentId?: string;
  /** 投递时读到的好友版本；执行时对不上直接丢弃（联系人删了重加不继承旧批次）。 */
  epoch: string;
}

export function momentsMemoryBatchId(
  kind: MomentsMemoryKind,
  postId: string,
  commentId?: string,
): string {
  if (kind === 'post') return `moments:post:${postId}`;
  if (kind === 'thread') return `moments:thread:${postId}:${commentId}`;
  return `moments:reply:${commentId}`;
}

export function momentsMemoryJobData(
  kind: MomentsMemoryKind,
  input: {
    userId: string;
    characterId: string;
    postId: string;
    commentId?: string;
    epoch: string;
  },
): MomentsMemoryJob {
  if (kind !== 'post' && !input.commentId)
    throw new Error('moments memory thread/reply job requires commentId');
  return {
    batchId: momentsMemoryBatchId(kind, input.postId, input.commentId),
    kind,
    userId: input.userId,
    characterId: input.characterId,
    postId: input.postId,
    ...(input.commentId ? { commentId: input.commentId } : {}),
    epoch: input.epoch,
  };
}

/**
 * 投递写回任务。写回是尽力而为：投递失败只丢一批记忆，调用方不处理错误。
 * singletonKey 只在排队中去重；已完成的重复投递靠 applyExternal 的批次幂等兜底。
 */
export async function sendMomentsMemoryJob(jobs: JobQueue, data: MomentsMemoryJob): Promise<void> {
  await jobs
    .send(MOMENTS_MEMORY_JOB, data, {
      singletonKey: `moments-memory:${data.batchId}`,
      retryLimit: 3,
      retryBackoff: true,
    })
    .catch(() => undefined);
}

/** 公开草稿文本比对：公开路（postPublic）发帖即用草稿原文，文本相等即同一条公开内容。 */
export function isSharedPublicDraftText(
  draftText: string | null | undefined,
  postText: string,
): boolean {
  if (!draftText) return false;
  const draft = draftText.trim();
  return draft.length > 0 && draft === postText.trim();
}

export async function findPublicDraftText(
  database: Database,
  characterId: string,
  localDate: string,
): Promise<string | null> {
  const [row] = await database.db
    .select({ status: publicMomentDrafts.status, text: publicMomentDrafts.text })
    .from(publicMomentDrafts)
    .where(
      and(
        eq(publicMomentDrafts.characterId, characterId),
        eq(publicMomentDrafts.localDate, localDate),
      ),
    );
  if (!row || row.status !== 'ready') return null;
  return row.text;
}

/**
 * 该动态是不是公开草稿。草稿日期按 Asia/Shanghai 取（postPublic 建草稿即用该时区），
 * 与用户时区无关。查库失败时抛错，由调用方决定是重试还是按公开处理。
 */
export async function isSharedPublicDraft(
  database: Database,
  characterId: string,
  postCreatedAt: string,
  postText: string,
): Promise<boolean> {
  const localDate = localParts(new Date(postCreatedAt), 'Asia/Shanghai').date;
  return isSharedPublicDraftText(
    await findPublicDraftText(database, characterId, localDate),
    postText,
  );
}

/**
 * 读脑分流（04:53 决定）：只做私人——角色动态、非公开草稿、非私密模型路。
 * 私密模型路（job.privateConversationId）沿用现有 adult 生成，不插脑前缀；
 * 用户动态与公开动态走现有路。
 */
export function shouldUseBrainPrefix(input: {
  privateConversation: boolean;
  authorKind: 'user' | 'character';
  sharedPublicDraft: boolean;
}): boolean {
  return !input.privateConversation && input.authorKind === 'character' && !input.sharedPublicDraft;
}

/**
 * 提取输入：动态正文 + 最近 12 条评论，每行带来源 id（动态/评论的 UUID），
 * 模型只能引用这些 id。说话人只分用户/角色/其他角色，不查画像。
 */
export function buildMomentsExtractionInput(
  post: MomentsPost,
  characterId: string,
): { sourceIds: string[]; text: string } {
  const lines: string[] = [];
  const sourceIds: string[] = [];
  const postText = post.text.slice(0, 600);
  sourceIds.push(post.postId);
  lines.push(`[${post.postId}] 角色：${postText || '（图片动态）'}`);
  for (const comment of post.comments.slice(-12)) {
    const speaker =
      comment.author.kind === 'user'
        ? '用户'
        : comment.author.refId === characterId
          ? '角色'
          : '其他角色';
    sourceIds.push(comment.commentId);
    lines.push(`[${comment.commentId}] ${speaker}：${comment.text.slice(0, 200)}`);
  }
  const text = lines.join('\n');
  return { sourceIds, text: text.length > 4000 ? text.slice(0, 4000) : text };
}

/**
 * 校验提取结果：结构须过 ExtractedMemory，超过 3 条只留前 3 条；
 * 引用了未给出的来源 id、或内容命中健康隐私（healthPrivate，与 applyExternal
 * 同口径）时整批丢弃，返回 null。调用方不得绕过本校验直接写库。
 */
export function validateMomentsExtraction(
  parsed: unknown,
  allowedSourceIds: ReadonlySet<string>,
): ExtractedOperation[] | null {
  const result = ExtractedMemory.safeParse(parsed);
  if (!result.success) return null;
  const operations = result.data.operations.slice(0, MOMENTS_MEMORY_MAX_OPERATIONS);
  for (const operation of operations) {
    if (!operation.sourceMessageIds.every((id) => allowedSourceIds.has(id))) return null;
    if (healthPrivate(operation.content)) return null;
  }
  return operations;
}

function isValidJobData(data: unknown): data is MomentsMemoryJob {
  if (!data || typeof data !== 'object') return false;
  const job = data as Record<string, unknown>;
  if (typeof job.batchId !== 'string' || !job.batchId) return false;
  if (job.kind !== 'post' && job.kind !== 'thread' && job.kind !== 'reply') return false;
  if (typeof job.userId !== 'string' || !job.userId) return false;
  if (typeof job.characterId !== 'string' || !job.characterId) return false;
  if (typeof job.postId !== 'string' || !job.postId) return false;
  if (typeof job.epoch !== 'string' || !job.epoch) return false;
  if (job.kind !== 'post' && (typeof job.commentId !== 'string' || !job.commentId)) return false;
  return true;
}

const EXTRACTION_SYSTEM_PROMPT = `你是记忆提取器，只从下面给出的朋友圈内容里提炼值得长期记住的事。只输出一个 JSON 对象：{"operations": [...]}，不要输出其他文字。
规则：
- 每批最多 3 条操作；没有值得记的，输出一条 NOOP 操作。
- 每条操作只能是 ADD（新增一条记忆）、UPDATE（改一条已记的记忆，需填 memoryId）、MARK_PAST（某事已过去）、NOOP（没什么可记）。没有现成的记忆 id 时不要编 memoryId，只用 ADD 或 NOOP。
- content 是一句话事实或承诺，不超过 200 字，不抄整段原文，不记成人内容、健康隐私（月经/经期等）、不记用户住址电话等敏感信息。
- category 只能是 basic（基本资料）、preference（喜好）、status（状态）、people（人物关系）、dates（日子）、episode（经历）、commitment（约定/承诺）之一；importance 1–10，越重要越大。有明确日期的约定可填 dueAt（ISO 时间），没有不填。
- sourceMessageIds 只能填下面内容里标注的来源 id，一个都不许编，也不许填没出现过的 id。
- 只记日常范围的事；朋友圈里的客套话、表情、玩笑不要记。`;

@Injectable()
export class MomentsMemoryService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(MOMENTS_READ_PORT) private readonly moments: MomentsReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work<MomentsMemoryJob>(MOMENTS_MEMORY_JOB, (job) => this.run(job.data));
  }

  /** 任务入口：任一快照/状态不符直接返回（丢弃不重试），基础设施异常才抛错。 */
  async run(data: MomentsMemoryJob): Promise<void> {
    if (!isValidJobData(data)) return;
    const { userId, characterId, postId } = data;
    if (await this.accounts.isBanned?.(userId)) return;
    const contact = await this.contacts.getActiveContact(userId, characterId);
    const epoch = await this.contacts.getActiveContactEpoch(userId, characterId);
    if (!contact?.conversationId || !epoch || epoch.version !== data.epoch) return;
    const conversationId = contact.conversationId;
    const post = await this.moments.getPost(userId, postId);
    if (!post || post.author.kind !== 'character' || post.author.refId !== characterId) return;
    if (await isSharedPublicDraft(this.db, characterId, post.createdAt, post.text)) return;
    const { sourceIds, text } = buildMomentsExtractionInput(post, characterId);
    if (healthPrivate(text)) return;
    const focus =
      data.kind === 'post'
        ? '只提炼这条动态本身'
        : data.kind === 'thread'
          ? '重点提炼用户评论里新出现的事'
          : '只提炼角色这条回复里新出现的事与承诺，不重复动态与已有评论';
    const generated = await this.gateway.generateText({
      userId,
      characterId,
      purpose: 'memory',
      billingOwner: 'user',
      modelRole: 'background',
      conversationId,
      countAsBackground: true,
      responseFormat: 'json',
      maxOutputTokens: 1200,
      idempotencyKey: `moments-memory:${data.batchId}`,
      meta: {
        conversationKind: 'direct',
        scenarioMode: 'daily',
        promptTemplateVersion: 'moments-memory-v1',
      },
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `朋友圈内容（来源 id 在每行开头）：\n${text}\n\n${focus}。只输出 JSON。`,
        },
      ],
    });
    // 网关失败（余额/配置/瞬时错误）一律丢弃：同一幂等键会回放缓存的失败，重试没有意义。
    if (!generated.ok) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(generated.value.text);
    } catch {
      return;
    }
    const operations = validateMomentsExtraction(parsed, new Set(sourceIds));
    if (!operations) return;
    try {
      await this.db.transaction(async (tx) => {
        const revision = await this.memory.revision(tx, userId, characterId, conversationId);
        // revision 对不上时 applyExternal 返回 false（丢弃，不抛错不重试）。
        await this.memory.applyExternal(tx, {
          userId,
          characterId,
          conversationId,
          epoch: data.epoch,
          scope: 'normal',
          origin: 'moments',
          batchId: data.batchId,
          revision,
          operations,
          sourceIds,
        });
      });
    } catch (error) {
      // 账号失效 / 好友已变化：这批属于旧关系，丢弃。来源校验漏网也丢弃，不重试。
      if (
        error instanceof AppError &&
        (error.code === 'not_found' || error.code === 'unauthenticated')
      )
        return;
      if (error instanceof Error && error.message === 'memory_external_invalid_source') return;
      throw error;
    }
  }
}
