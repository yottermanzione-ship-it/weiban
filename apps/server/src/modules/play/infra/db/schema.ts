/**
 * play 模块的表（schema `play`，上层模块，ADR-0024）。
 * - T-091 每日一问（迁移 0065）：题库、每天的回答、上次选的角色。
 * - T-092～T-095（心愿清单 0066、慢信 0067、陪你专注 0068、TA 的提醒 0069）在本文件追加各自的表。
 *
 * 用户写的文字（回答等）按用户数据密钥加密保存（ENVELOPE_CRYPTO，owner = userId），
 * 注销时随用户密钥销毁与本模块删除清单一起清除。
 */
import {
  boolean,
  customType,
  date,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const time = (name: string) => timestamp(name, { withTimezone: true });
export const playSchema = pgSchema('play');

// ---------- T-091 每日一问（PLAY-03） ----------

/** 题库（ADM-04 第 5 条）：标签至少含 romance / child_safe / work，可上架 / 下架。 */
export const dailyQuestions = playSchema.table(
  'daily_questions',
  {
    id: uuid('id').primaryKey(),
    text: text('text').notNull(),
    /** 契约 DailyQuestionTag 的取值。 */
    tags: text('tags').array().notNull(),
    listed: boolean('listed').notNull(),
    createdBy: uuid('created_by'),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [index('daily_questions_listed_idx').on(t.listed, t.createdAt, t.id)],
);

/**
 * 用户每天的回答（每个用户每个当地日期最多一条：当天答完整页只读，PLAY-03 第 2 条）。
 * 题目文字存快照（题库改动后历史不变）。角色答案由 ai-runtime 经 PlayAgentPort 回写。
 */
export const dailyAnswers = playSchema.table(
  'daily_answers',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    /** 用户当地日期。 */
    localDate: date('local_date', { mode: 'string' }).notNull(),
    questionId: uuid('question_id').notNull(),
    questionText: text('question_text').notNull(),
    /** AAD = play:daily_answer:{id}:user */
    userAnswerCiphertext: bytes('user_answer_ciphertext').notNull(),
    /** AAD = play:daily_answer:{id}:character；生成前为 null。 */
    characterAnswerCiphertext: bytes('character_answer_ciphertext'),
    /** pending | ready | waiting_balance */
    characterAnswerStatus: text('character_answer_status').notNull(),
    /** 私聊里的「每日一问」卡片消息。 */
    messageId: uuid('message_id'),
    clientRequestId: uuid('client_request_id').notNull(),
    answeredAt: time('answered_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('daily_answers_user_date_idx').on(t.userId, t.localDate),
    uniqueIndex('daily_answers_user_request_idx').on(t.userId, t.clientRequestId),
    index('daily_answers_user_history_idx').on(t.userId, t.localDate, t.id),
    index('daily_answers_status_idx').on(t.characterAnswerStatus, t.userId),
  ],
);

/** 「默认上次选的角色」（PLAY-03 第 2 条）。 */
export const dailyPrefs = playSchema.table('daily_prefs', {
  userId: uuid('user_id').primaryKey(),
  lastCharacterId: uuid('last_character_id').notNull(),
  updatedAt: time('updated_at').notNull(),
});

// ---------- T-092 心愿清单（PLAY-04） ----------

/** 用户和某角色的心愿清单项（每角色最多 P-41 项）。文字按用户数据密钥加密。 */
export const wishlistItems = playSchema.table(
  'wishlist_items',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    /** AAD = play:wish:{id} */
    textCiphertext: bytes('text_ciphertext').notNull(),
    /** 「TA 提议」。 */
    proposedByCharacter: boolean('proposed_by_character').notNull(),
    /** 定了日期即成为「约定」（MEM-04、SIM-07）。 */
    dueDate: date('due_date', { mode: 'string' }),
    completedAt: time('completed_at'),
    /** 第一次打勾的时间（取消完成不清除；决定 firstCompletion 与只发一次瞬间卡）。 */
    firstCompletedAt: time('first_completed_at'),
    cardIssued: boolean('card_issued').notNull(),
    /** 角色已问过「我们那件事做了吗」（每项最多一次，T-096 判断）。 */
    followedUpAt: time('followed_up_at'),
    /** 用户添加：clientRequestId；角色提议：proposalId。用于幂等。 */
    sourceKey: uuid('source_key').notNull(),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('wishlist_items_source_idx').on(t.userId, t.sourceKey),
    index('wishlist_items_user_character_idx').on(t.userId, t.characterId, t.createdAt),
  ],
);

/** 角色提议（PLAY-04 第 4 条）：每角色每周最多 1 次；用户点「加进去」后建项。 */
export const wishlistProposals = playSchema.table(
  'wishlist_proposals',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    /** AAD = play:wish_proposal:{id} */
    textCiphertext: bytes('text_ciphertext').notNull(),
    /** 用户当地周一（每周 1 次的计数窗口）。 */
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    /** pending | accepted | declined */
    status: text('status').notNull(),
    itemId: uuid('item_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('wishlist_proposals_idem_idx').on(t.userId, t.characterId, t.idempotencyKey),
    index('wishlist_proposals_week_idx').on(t.userId, t.characterId, t.weekStart),
  ],
);
