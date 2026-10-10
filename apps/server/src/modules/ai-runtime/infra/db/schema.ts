import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  real,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
export const aiRuntimeSchema = pgSchema('ai_runtime');
/** null characterId 表示用户全局默认；单独设置整份快照不随默认变化。 */
export const companionSettings = aiRuntimeSchema.table(
  'companion_settings',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id'),
    instantReply: boolean('instant_reply').notNull(),
    splitBubbles: boolean('split_bubbles').notNull(),
    personaFit: integer('persona_fit').notNull().default(3),
    scenarioMode: text('scenario_mode').notNull().default('daily'),
    proactiveMessages: boolean('proactive_messages').notNull().default(true),
    proactiveFrequency: text('proactive_frequency').notNull().default('medium'),
    proactiveCalls: boolean('proactive_calls').notNull().default(false),
    dailyLife: boolean('daily_life').notNull().default(true),
    /** T-071：该角色发语音 / 通话用的音色（media 音色库，非克隆）；null = 预设默认。 */
    voiceId: uuid('voice_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('companion_user_character_idx').on(t.userId, t.characterId).nullsNotDistinct(),
    check('companion_persona_fit', sql`${t.personaFit} BETWEEN 1 AND 5`),
    check('companion_mode', sql`${t.scenarioMode} IN ('daily','tsundere','romance','adult')`),
    check('companion_frequency', sql`${t.proactiveFrequency} IN ('low','medium','high')`),
  ],
);

const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
/**
 * pgvector 列（vector(256)）。fromDriver/toDriver 使用字符串字面量，
 * 应用层在查询时通过原生 sql 调用 <=> 操作符，不经过 Drizzle 操作符。
 */
const vector256 = customType<{ data: string | null; driverData: string | null }>({
  dataType: () => 'vector(256)',
  fromDriver: (v) => v as string | null,
  toDriver: (v) => v,
});
/** 不在明文列保存记忆内容、来源消息、私密类别或共享标签。embedding 明文存储（见 ADR-0020）。 */
export const memories = aiRuntimeSchema.table(
  'memories',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    clientId: uuid('client_id'),
    scope: text('scope').notNull(),
    ciphertext: bytes('ciphertext').notNull(),
    /** 向量嵌入（明文，256 维，Phase 1 统计嵌入，见 ADR-0020）。新记录自动填充，旧记录 null。 */
    embedding: vector256('embedding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('memory_client_idx').on(t.userId, t.characterId, t.clientId),
    index('memory_owner_idx').on(t.userId, t.characterId, t.conversationId, t.id),
    check('memory_scope', sql`${t.scope} IN ('normal','adult')`),
  ],
);
/** 删除屏障按会话seq保守截断旧原文；摘要与来源清单加密。 */
export const memoryStates = aiRuntimeSchema.table(
  'memory_states',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    revision: integer('revision').notNull().default(0),
    pendingCount: integer('pending_count').notNull().default(0),
    retryAfter: timestamp('retry_after', { withTimezone: true }),
    barrierSeq: bigint('barrier_seq', { mode: 'number' }).notNull().default(0),
    cursorSeq: bigint('cursor_seq', { mode: 'number' }).notNull().default(0),
    /** 分段摘要（最近批次滚动，normal/adult 分开，保留 4000 字）。 */
    summaryCiphertext: bytes('summary_ciphertext'),
    /** 日摘要（加密 JSON 数组，最多 30 条），格式：{date,normal,adult}[]。 */
    dailySummariesCiphertext: bytes('daily_summaries_ciphertext'),
    /** 月摘要（加密 JSON 数组，最多 24 条），格式：{yearMonth,normal,adult}[]。 */
    monthlySummariesCiphertext: bytes('monthly_summaries_ciphertext'),
    /** 上次合并日摘要的时间，用于判断是否需要触发日汇总。 */
    lastDailyAt: timestamp('last_daily_at', { withTimezone: true }),
    /** 上次合并月摘要的时间，用于判断是否需要触发月汇总。 */
    lastMonthlyAt: timestamp('last_monthly_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('memory_state_owner_idx').on(t.userId, t.characterId, t.conversationId),
    check(
      'memory_state_counters',
      sql`${t.pendingCount} >= 0 AND ${t.revision} >= 0 AND ${t.barrierSeq} >= 0 AND ${t.cursorSeq} >= 0`,
    ),
  ],
);
/** T-051 推演引擎：每用户每角色的推演控制状态。 */
export const simulationStates = aiRuntimeSchema.table(
  'simulation_states',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    lastSimulatedDate: text('last_simulated_date'),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull(),
    eventsToday: integer('events_today').notNull().default(0),
    pausedReason: text('paused_reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('simulation_state_owner_idx').on(t.userId, t.characterId),
    check('simulation_events_today', sql`${t.eventsToday} >= 0`),
    check(
      'simulation_paused_reason',
      sql`${t.pausedReason} IS NULL OR ${t.pausedReason} IN ('budget_exceeded','inactive','model_unavailable')`,
    ),
  ],
);

/** T-051 推演引擎：生成的日常事件流水。 */
export const dailyEvents = aiRuntimeSchema.table(
  'daily_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    eventDate: text('event_date').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    summary: text('summary').notNull(),
    detail: text('detail'),
    moodAfter: text('mood_after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('daily_event_date_owner_seq_idx').on(t.userId, t.characterId, t.eventDate, t.seq),
    index('daily_event_owner_date_idx').on(t.userId, t.characterId, t.eventDate),
    check('daily_event_seq', sql`${t.seq} >= 0`),
    check(
      'daily_event_kind',
      sql`${t.kind} IN ('work','social','leisure','errand','rest','unexpected')`,
    ),
    check(
      'daily_event_mood',
      sql`${t.moodAfter} IS NULL OR ${t.moodAfter} IN ('happy','neutral','tired','annoyed','excited','sad','anxious')`,
    ),
  ],
);

/** T-051 推演引擎：每用户每角色当前心情。 */
export const moodStates = aiRuntimeSchema.table(
  'mood_states',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    mood: text('mood').notNull().default('neutral'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('mood_state_owner_idx').on(t.userId, t.characterId),
    check(
      'mood_state_mood',
      sql`${t.mood} IN ('happy','neutral','tired','annoyed','excited','sad','anxious')`,
    ),
  ],
);

/**
 * T-060 经期关怀配额账本（PLAY-01 第 6 条、P-36）。
 * 只记「某周期的某个名额已用」：cycleKey 是 health 给的不透明随机 ID，slot 是
 * pre_period / in_period / chat_d{经期第几天}；不存任何日期、痛感或症状（health-data.md 第 4 节）。
 */
export const healthCareLedger = aiRuntimeSchema.table(
  'health_care_ledger',
  {
    userId: uuid('user_id').notNull(),
    cycleKey: text('cycle_key').notNull(),
    slot: text('slot').notNull(),
    characterId: uuid('character_id'),
  },
  (t) => [unique('health_care_ledger_slot_idx').on(t.userId, t.cycleKey, t.slot)],
);

/** 计划记录仅ID、状态与时序；模型输入和已生成气泡按用户DEK加密。 */
export const replyPlans = aiRuntimeSchema.table(
  'reply_plans',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    triggerId: uuid('trigger_id').notNull(),
    triggerSeq: bigint('trigger_seq', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    leaseId: uuid('lease_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    inputCiphertext: bytes('input_ciphertext'),
    resultCiphertext: bytes('result_ciphertext'),
    nextBubble: integer('next_bubble').notNull().default(0),
    retryEpoch: integer('retry_epoch').notNull().default(0),
    failure: text('failure'),
    careUntil: timestamp('care_until', { withTimezone: true }),
  },
  (t) => [
    check(
      'reply_plan_status',
      sql`${t.status} IN ('queued','generating','waiting','sending','done','cancelled')`,
    ),
    check('reply_plan_kind', sql`${t.kind} IN ('message','greeting')`),
    check(
      'reply_plan_counters',
      sql`${t.triggerSeq} >= 0 AND ${t.triggerSeq} <= 9007199254740991 AND ${t.nextBubble} >= 0 AND ${t.nextBubble} <= 4 AND ${t.retryEpoch} >= 0`,
    ),
    unique('reply_trigger_idx').on(t.userId, t.triggerId),
    index('reply_due_idx').on(t.status, t.dueAt),
    index('reply_conversation_idx').on(t.conversationId, t.triggerSeq),
  ],
);

/**
 * T-053 主动消息调度计划：每条候选主动消息一行，记录理由（SIM-05 第 10 条）、
 * 来源（事件 ID / 约定 ID / 节日 ID / 久未联系起点）、话题键（P-07 去重）与最终结局。
 * 同一来源（sourceRef）对同一用户只会出现一次：一个日常事件最多推一次（第 6 章总规则 1）。
 */
export const proactivePlans = aiRuntimeSchema.table(
  'proactive_plans',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    reason: text('reason').notNull(),
    sourceRef: text('source_ref').notNull(),
    topicKey: text('topic_key').notNull(),
    /** 给模型的素材说明（不含用户隐私原文以外的东西；事件摘要、节日名等）。 */
    brief: text('brief').notNull(),
    localDate: text('local_date').notNull(),
    isHoliday: boolean('is_holiday').notNull().default(false),
    priority: integer('priority').notNull().default(0),
    status: text('status').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    /** 第一次因 P-09 延后的时间；超过 60 分钟放弃。 */
    deferredSince: timestamp('deferred_since', { withTimezone: true }),
    outcome: text('outcome'),
    messageId: uuid('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('proactive_plan_source_idx').on(t.userId, t.characterId, t.sourceRef),
    check('proactive_plan_status', sql`${t.status} IN ('planned','generating','sent','dropped')`),
    index('proactive_plan_due_idx').on(t.status, t.dueAt),
    index('proactive_plan_topic_idx').on(t.userId, t.characterId, t.topicKey),
  ],
);

/**
 * T-053 用户聊天活跃小时（P-06 活跃时段学习、P-09 正在聊天判断）。
 * 只存「哪天哪个小时发过消息」与该小时最后一次时间，不存内容。保留 15 天。
 */
export const userChatActivity = aiRuntimeSchema.table(
  'user_chat_activity',
  {
    userId: uuid('user_id').notNull(),
    localDate: text('local_date').notNull(),
    hour: integer('hour').notNull(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('user_chat_activity_pk').on(t.userId, t.localDate, t.hour),
    check('user_chat_activity_hour', sql`${t.hour} >= 0 AND ${t.hour} <= 23`),
  ],
);

/** T-065 群聊陪伴设置（SOC-03 第 3、4 条）：秒回、角色自己聊天、群情景模式。没有行 = 默认值。 */
export const groupCompanionSettings = aiRuntimeSchema.table('group_companion_settings', {
  conversationId: uuid('conversation_id').primaryKey(),
  userId: uuid('user_id').notNull(),
  instantReply: boolean('instant_reply').notNull().default(false),
  selfChatEnabled: boolean('self_chat_enabled').notNull().default(true),
  scenarioMode: text('scenario_mode').notNull().default('daily'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** T-065 群里自己聊（SOC-05）账本：每群每个用户当地日期一行，实现 P-20「每群每天最多 1 次」。 */
export const groupSelfChats = aiRuntimeSchema.table(
  'group_self_chats',
  {
    conversationId: uuid('conversation_id').notNull(),
    userId: uuid('user_id').notNull(),
    localDate: text('local_date').notNull(),
    starterCharacterId: uuid('starter_character_id'),
    sourceRef: text('source_ref'),
    messages: integer('messages').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('group_self_chat_day_idx').on(t.conversationId, t.localDate),
    check('group_self_chat_messages', sql`${t.messages} >= 0 AND ${t.messages} <= 10`),
  ],
);

/** T-065 角色拉群（SOC-06）账本：P-22、每个节日最多 1 个群、退出后私聊最多提一次。 */
export const groupInvites = aiRuntimeSchema.table(
  'group_invites',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    inviterCharacterId: uuid('inviter_character_id').notNull(),
    conversationId: uuid('conversation_id'),
    trigger: text('trigger').notNull(),
    sourceRef: text('source_ref').notNull(),
    reason: text('reason').notNull(),
    outcome: text('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    exitMentioned: boolean('exit_mentioned').notNull().default(false),
  },
  (t) => [
    unique('group_invite_source_idx').on(t.userId, t.sourceRef),
    check('group_invite_trigger', sql`${t.trigger} IN ('co_event','user_mention','holiday')`),
    index('group_invite_user_idx').on(t.userId, t.createdAt),
  ],
);

/** T-066 跨角色共享档位（MEM-07 第 1 条）。没有行 = 默认 friends。 */
export const memorySharingSettings = aiRuntimeSchema.table(
  'memory_sharing_settings',
  {
    userId: uuid('user_id').primaryKey(),
    level: text('level').notNull().default('friends'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('memory_sharing_level', sql`${t.level} IN ('off','basic','friends')`)],
);

/** T-066 P-18：用户进入某私聊的时间（服务器自己记，不只信客户端）。 */
export const chatVisits = aiRuntimeSchema.table(
  'chat_visits',
  {
    userId: uuid('user_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    lastEnteredAt: timestamp('last_entered_at', { withTimezone: true }).notNull(),
    prevEnteredAt: timestamp('prev_entered_at', { withTimezone: true }),
  },
  (t) => [unique('chat_visit_pk').on(t.userId, t.conversationId)],
);

/**
 * T-066 角色共同事件（SOC-02、CHR-04 第 2 条）：两个有关系的角色同一天一起做的事。
 * 两人读同一行，说法天然一致。characterAId < characterBId。
 */
export const jointEvents = aiRuntimeSchema.table(
  'joint_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    eventDate: text('event_date').notNull(),
    characterAId: uuid('character_a_id').notNull(),
    characterBId: uuid('character_b_id').notNull(),
    kind: text('kind').notNull(),
    summary: text('summary').notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('joint_event_pair_day_idx').on(t.userId, t.eventDate, t.characterAId, t.characterBId),
    index('joint_event_a_idx').on(t.userId, t.characterAId, t.eventDate),
    index('joint_event_b_idx').on(t.userId, t.characterBId, t.eventDate),
  ],
);

/** T-066 朋友圈发帖账本（P-16：每角色每天最多 1 条，每周按人设 2–4 条）。 */
export const momentsPlans = aiRuntimeSchema.table(
  'moments_plans',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    localDate: text('local_date').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceId: text('source_id').notNull(),
    status: text('status').notNull(),
    postId: uuid('post_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('moments_plan_day_idx').on(t.userId, t.characterId, t.localDate),
    index('moments_plan_week_idx').on(t.userId, t.characterId, t.createdAt),
  ],
);

/** T-066 通过名片添加的推荐人（CHR-04 第 3 条：第一条消息提到推荐人；读取即消费）。 */
export const cardReferrals = aiRuntimeSchema.table(
  'card_referrals',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    referrerCharacterId: uuid('referrer_character_id').notNull(),
    consumed: boolean('consumed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [unique('card_referral_pk').on(t.userId, t.characterId)],
);

/** T-072 P-45「不方便」静默：到 inconvenientUntil 前该用户所有角色不发语音、不主动来电；用户再发消息提前结束。 */
export const userQuietStates = aiRuntimeSchema.table('user_quiet_states', {
  userId: uuid('user_id').primaryKey(),
  inconvenientUntil: timestamp('inconvenient_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/**
 * T-072 主动来电记录（MED-07、P-10）：每次尝试一行。outcome：started / missed / declined / completed /
 * skipped_*（未拨出原因）。P-10 按 started 起的行计数；未接 / 拒接当天不再打。
 */
export const callAttempts = aiRuntimeSchema.table(
  'call_attempts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    localDate: text('local_date').notNull(),
    reason: text('reason').notNull(),
    sourceRef: text('source_ref').notNull(),
    callId: uuid('call_id'),
    outcome: text('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('call_attempt_source_idx').on(t.userId, t.sourceRef),
    index('call_attempt_user_created_idx').on(t.userId, t.createdAt),
  ],
);

/** T-082 PLAY-02 第 2 条：角色提议领养（每用户每角色一次，拒绝或忽略后不再提）。 */
export const petProposals = aiRuntimeSchema.table(
  'pet_proposals',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull(),
    messageId: uuid('message_id'),
    choice: text('choice'),
    chosenAt: timestamp('chosen_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.characterId] })],
);

/** T-082 GRW-05：名场面每角色每周评估一次（weekKey = 用户当地该周周一日期）。 */
export const momentCardAttempts = aiRuntimeSchema.table(
  'moment_card_attempts',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    weekKey: text('week_key').notNull(),
    outcome: text('outcome').notNull(),
    score: integer('score'),
    cardId: uuid('card_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.characterId, t.weekKey] })],
);

/** T-090 行为规划：按决策类型的实现配置（ADM-05 第 10 条）。没有行 = 默认（rules）。 */
export const plannerConfig = aiRuntimeSchema.table('planner_config', {
  decisionType: text('decision_type').primaryKey(),
  implementation: text('implementation').notNull().default('rules'),
  modelKey: text('model_key'),
  confidenceThreshold: real('confidence_threshold').notNull().default(0.55),
  evalReportId: text('eval_report_id'),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** T-090 决策记录（PLAN-01 第 4 条）：决策、置信度、理由；不存消息原文；保留 90 天。 */
export const planningDecisions = aiRuntimeSchema.table(
  'planning_decisions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id'),
    conversationId: uuid('conversation_id'),
    decisionType: text('decision_type').notNull(),
    options: jsonb('options').$type<string[]>().notNull(),
    choice: text('choice').notNull(),
    confidence: real('confidence').notNull(),
    reason: text('reason').notNull(),
    implementation: text('implementation').notNull(),
    fallback: text('fallback'),
    latencyMs: integer('latency_ms').notNull().default(0),
    usageRecordId: uuid('usage_record_id'),
    chargedMicros: bigint('charged_micros', { mode: 'number' }).notNull().default(0),
    path: text('path').notNull().default('reply'),
    /** 同一决策只问一次（例 proactive:{userId}:{date}:{sourceRef}）；回复路径为 null。 */
    decisionKey: text('decision_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('planning_decisions_user_idx').on(t.userId, t.createdAt),
    index('planning_decisions_created_idx').on(t.createdAt),
    unique('planning_decisions_key_idx').on(t.userId, t.decisionKey),
  ],
);
