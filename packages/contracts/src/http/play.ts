/**
 * play 模块（L7，D-L7-08，T-091～T-095）：五个已采纳玩法——每日一问（PLAY-03）、心愿清单（PLAY-04）、
 * 慢信（PLAY-05）、陪你专注（PLAY-06）、TA 的提醒（PLAY-07）。模块归属见 ADR-0024：数据归新模块 play
 * （上层，schema `play`），角色「说话」归 ai-runtime（订阅 play.* 事件、经 PlayAgentPort 回写）。
 * 按钮、清单、计时、日期都不调用模型（PRD 第 16 章「花钱少」）。不打卡、不惩罚（SAFE-08）。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  Id,
  LocalDate,
  LocalTime,
  NoContent,
  Timestamp,
  cursorPage,
  defineEndpoint,
  tolerantEnum,
} from '../common.js';

/** P-40～P-44 与字数上限（PLAY-03～07、裁定 E2）。 */
export const PLAY_LIMITS = {
  dailyQuestionsPerDay: 1,
  dailyAnswerMaxChars: 200,
  wishlistItemsPerCharacter: 50,
  wishlistItemMaxChars: 50,
  letterMaxChars: 2000,
  letterReplyDelayMinHours: 6,
  letterReplyDelayMaxHours: 24,
  focusMinMinutes: 5,
  focusMaxMinutes: 120,
  focusNoteMaxChars: 30,
  remindersPerUser: 10,
  reminderTextMaxChars: 20,
} as const;

// ---------- 每日一问（PLAY-03） ----------

export const DailyQuestionTag = z.enum(['romance', 'child_safe', 'work', 'family', 'childhood', 'light']);

export const DailyQuestionToday = z.object({
  /** 用户当地日期。 */
  date: LocalDate,
  characterId: Id,
  questionId: Id,
  question: z.string().max(100),
  /** 今天已答：用户的回答与角色的答案；未答为 null（提交前看不到 TA 的答案，也不提前生成）。 */
  answer: z
    .object({
      answerId: Id,
      userAnswer: z.string().max(PLAY_LIMITS.dailyAnswerMaxChars),
      /** 生成中或余额不足时为 null，见 characterAnswerStatus。 */
      characterAnswer: z.string().max(500).nullable(),
      characterAnswerStatus: z.enum(['pending', 'ready', 'waiting_balance']),
      answeredAt: Timestamp,
    })
    .nullable(),
});
export type DailyQuestionToday = z.infer<typeof DailyQuestionToday>;

export const DailyAnswerHistoryItem = z.object({
  answerId: Id,
  date: LocalDate,
  characterId: Id,
  question: z.string().max(100),
  userAnswer: z.string(),
  characterAnswer: z.string().nullable(),
});

export const DailyQuestionEndpoints = {
  getToday: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/play/daily-question`,
    auth: 'user',
    query: z.object({ characterId: Id.optional() }),
    response: DailyQuestionToday,
    summary:
      '今天的题（P-40）：不传 characterId 用上次选的角色；按关系类型、儿童、真人过滤题目（PLAY-03 第 3 条），换角色时题目可能随之变化；今天答过后只读',
  }),
  answer: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/play/daily-question/answers`,
    auth: 'user',
    body: z.object({
      clientRequestId: Id,
      characterId: Id,
      questionId: Id,
      answer: z.string().trim().min(1).max(PLAY_LIMITS.dailyAnswerMaxChars),
    }),
    response: DailyQuestionToday,
    summary:
      '提交回答（不能修改）。今天答过 409 already_answered。私聊写「每日一问」卡片消息（发送者为用户）；' +
      '发出 play.daily_answer_submitted，ai-runtime 生成 TA 的答案（PlayAgentPort 回写）并在私聊接一句（花费算「聊天」）',
  }),
  listHistory: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/play/daily-question/history`,
    auth: 'user',
    query: z.object({ cursor: z.string().optional() }),
    response: cursorPage(DailyAnswerHistoryItem),
    summary: '答过的题（没答的日子不显示）',
  }),
} as const;

export const AdminDailyQuestion = z.object({
  questionId: Id,
  text: z.string().min(1).max(100),
  tags: z.array(DailyQuestionTag),
  listed: z.boolean(),
  updatedAt: Timestamp,
});

export const DailyQuestionAdminEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/play/questions`,
    auth: 'admin',
    query: z.object({ cursor: z.string().optional(), tag: DailyQuestionTag.optional() }),
    response: cursorPage(AdminDailyQuestion),
    summary: '每日一问题库（ADM-04 第 5 条）',
  }),
  create: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/play/questions`,
    auth: 'admin',
    body: AdminDailyQuestion.pick({ text: true, tags: true, listed: true }),
    response: AdminDailyQuestion,
    summary: '新增题目',
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/play/questions/:questionId`,
    auth: 'admin',
    params: z.object({ questionId: Id }),
    body: AdminDailyQuestion.pick({ text: true, tags: true, listed: true }).partial(),
    response: AdminDailyQuestion,
    summary: '编辑、上架 / 下架题目',
  }),
} as const;

// ---------- 心愿清单（PLAY-04） ----------

export const WishlistItem = z.object({
  itemId: Id,
  characterId: Id,
  text: z.string().min(1).max(PLAY_LIMITS.wishlistItemMaxChars),
  /** 由角色提议、用户点「加进去」加入的（「TA 提议」标签）。 */
  proposedByCharacter: z.boolean(),
  /** 定了日期即成为一条「约定」（MEM-04、SIM-07）。 */
  dueDate: LocalDate.nullable(),
  /** 只能由用户打勾。 */
  completedAt: Timestamp.nullable(),
  /** 是否已为此项发过瞬间卡（同一项只发一次）。 */
  cardIssued: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type WishlistItem = z.infer<typeof WishlistItem>;

export const WishlistSummary = z.object({
  characterId: Id,
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
});

const WishItemParams = z.object({ itemId: Id });

export const WishlistEndpoints = {
  listSummaries: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/play/wishlists`,
    auth: 'user',
    response: z.object({ items: z.array(WishlistSummary) }),
    summary: '「我 → 服务 → 心愿清单」：各角色清单总览',
  }),
  listItems: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/play/wishlists/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: z.object({ items: z.array(WishlistItem), limit: z.number().int().positive() }),
    summary: '和某角色的心愿清单（服务页与聊天信息页是同一张）',
  }),
  addItem: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/play/wishlists/:characterId/items`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: z.object({
      clientRequestId: Id,
      text: z.string().trim().min(1).max(PLAY_LIMITS.wishlistItemMaxChars),
      dueDate: LocalDate.nullable().optional(),
    }),
    response: WishlistItem,
    summary: '添加一项；达到 P-41 返回 422 limit_reached',
  }),
  updateItem: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/play/wishlist-items/:itemId`,
    auth: 'user',
    params: WishItemParams,
    body: z.object({
      text: z.string().trim().min(1).max(PLAY_LIMITS.wishlistItemMaxChars).optional(),
      /** 设日期 → 发 play.wishlist_item_changed，ai-runtime 写约定记忆；设为 null 取消约定。 */
      dueDate: LocalDate.nullable().optional(),
      /** 打勾 / 取消完成。完成后（第一次）发 play.wishlist_item_completed：瞬间卡、成就第 31 号。 */
      completed: z.boolean().optional(),
    }),
    response: WishlistItem,
    summary: '编辑、定日期、打勾（都不调用模型）；取消完成不收回已获得的卡',
  }),
  deleteItem: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/play/wishlist-items/:itemId`,
    auth: 'user',
    params: WishItemParams,
    response: NoContent,
    summary: '删除一项（有日期的约定一并取消）',
  }),
} as const;

// ---------- 慢信（PLAY-05） ----------

export const LetterStatus = z.enum(['draft', 'sent', 'in_transit', 'delivered']);

/**
 * 一封信。来信（用户写的）：draft → sent；回信与角色主动寄的信：in_transit → delivered。
 * 送达前只显示「信件在路上」：in_transit 时 body 为 null。
 */
export const Letter = z.object({
  letterId: Id,
  characterId: Id,
  direction: z.enum(['to_character', 'from_character']),
  status: tolerantEnum(LetterStatus),
  body: z.string().max(4000).nullable(),
  /** 回信对应的来信；角色主动寄的信（纪念日）为 null。 */
  inReplyToLetterId: Id.nullable(),
  /** 预计送达（只用于「这封的回信会晚一些到」的说明，不精确显示）。 */
  expectedDeliveryDate: LocalDate.nullable(),
  sentAt: Timestamp.nullable(),
  deliveredAt: Timestamp.nullable(),
  readAt: Timestamp.nullable(),
  /** 私聊里对应的信件卡片消息。 */
  messageId: Id.nullable(),
  updatedAt: Timestamp,
});
export type Letter = z.infer<typeof Letter>;

const LetterParams = z.object({ letterId: Id });

export const LetterEndpoints = {
  listLetters: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/play/letters`,
    auth: 'user',
    query: z.object({
      box: z.enum(['received', 'sent', 'drafts']),
      characterId: Id.optional(),
      cursor: z.string().optional(),
    }),
    response: cursorPage(Letter),
    summary: '「我 → 服务 → 信箱」：收到的 / 寄出的 / 草稿',
  }),
  getLetter: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/play/letters/:letterId`,
    auth: 'user',
    params: LetterParams,
    response: Letter,
    summary: '读信（第一次读后标记已读，信箱红点消失）',
  }),
  saveDraft: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/play/letter-drafts/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: z.object({ body: z.string().max(PLAY_LIMITS.letterMaxChars) }),
    response: Letter,
    summary: '保存草稿（离开写信页时，每个角色一份）',
  }),
  sendLetter: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/play/letters`,
    auth: 'user',
    body: z.object({
      clientRequestId: Id,
      characterId: Id,
      body: z.string().trim().min(1).max(PLAY_LIMITS.letterMaxChars),
    }),
    response: z.object({ letter: Letter, replyDelayed: z.boolean() }),
    summary:
      '寄信：私聊写信件卡片（发送者为用户），定好回信送达时间（P-42、活跃时段、每角色每天最多回 1 封，replyDelayed = 顺延）；' +
      '发出 play.letter_sent。回信由 ai-runtime 在送达前生成、经 PlayAgentPort.deliverLetterReply 送达；余额不足时信不丢',
  }),
  getBadge: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/play/letters/badge`,
    auth: 'user',
    response: z.object({ unreadCount: z.number().int().nonnegative() }),
    summary: '信箱与服务页宫格红点',
  }),
} as const;

// ---------- 陪你专注（PLAY-06） ----------

export const FocusSession = z.object({
  focusId: Id,
  characterId: Id,
  plannedMinutes: z.number().int().min(PLAY_LIMITS.focusMinMinutes).max(PLAY_LIMITS.focusMaxMinutes),
  note: z.string().max(PLAY_LIMITS.focusNoteMaxChars).nullable(),
  startedAt: Timestamp,
  /** 计划结束时间（服务器时间为准）。 */
  endsAt: Timestamp,
  endedAt: Timestamp.nullable(),
  /** completed = 时间到；ended_early = 用户提前结束（没有「失败」，SAFE-08）。 */
  result: z.enum(['in_progress', 'completed', 'ended_early']),
});
export type FocusSession = z.infer<typeof FocusSession>;

export const FocusEndpoints = {
  getActive: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/play/focus`,
    auth: 'user',
    response: z.object({ session: FocusSession.nullable() }),
    summary: '「用户正在专注」状态（进行中的专注；离开页面计时照常，以服务器时间为准）',
  }),
  start: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/play/focus`,
    auth: 'user',
    body: z.object({
      clientRequestId: Id,
      characterId: Id,
      minutes: z.number().int().min(PLAY_LIMITS.focusMinMinutes).max(PLAY_LIMITS.focusMaxMinutes),
      note: z.string().trim().max(PLAY_LIMITS.focusNoteMaxChars).nullable().optional(),
    }),
    response: FocusSession,
    summary:
      '开始专注（同一时间只能一次，否则 409 focus_in_progress）。发出 play.focus_started：ai-runtime 让 TA 发一句加油，并让所有角色安静到结束',
  }),
  end: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/play/focus/:focusId/end`,
    auth: 'user',
    params: z.object({ focusId: Id }),
    response: FocusSession,
    summary: '提前结束（幂等；结束确认无挽留文案）。时间到由服务器自动结束。都发出 play.focus_ended',
  }),
} as const;

// ---------- TA 的提醒（PLAY-07） ----------

export const ReminderRepeat = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), date: LocalDate }),
  z.object({ kind: z.literal('daily'), weekdays: z.array(z.number().int().min(1).max(7)).max(0) }),
  z.object({ kind: z.literal('workdays'), weekdays: z.array(z.number().int().min(1).max(7)).max(0) }),
  /** weekdays：1 = 周一 … 7 = 周日。 */
  z.object({ kind: z.literal('weekly'), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7) }),
]);
export type ReminderRepeat = z.infer<typeof ReminderRepeat>;

export const Reminder = z.object({
  reminderId: Id,
  characterId: Id,
  text: z.string().min(1).max(PLAY_LIMITS.reminderTextMaxChars),
  time: LocalTime,
  repeat: ReminderRepeat,
  /** 「归类为健康」：到点消息带「健康」标记（推送不显示内容、不进分享图）；内容用用户数据密钥加密保存。 */
  health: z.boolean(),
  /** 「免打扰时段也提醒」。 */
  bypassDoNotDisturb: z.boolean(),
  enabled: z.boolean(),
  /** 角色口吻的说法是否已生成（未生成时到点用模板说法，余额恢复后补生成）。 */
  phrasingsReady: z.boolean(),
  /** 下次到点（服务器按用户时区算出）；已停用或已过的单次提醒为 null。 */
  nextFireAt: Timestamp.nullable(),
  /** 角色被删除（30 天内）时暂停。 */
  pausedByContactRemoval: z.boolean(),
  updatedAt: Timestamp,
});
export type Reminder = z.infer<typeof Reminder>;

export const ReminderWrite = z.object({
  characterId: Id,
  text: z.string().trim().min(1).max(PLAY_LIMITS.reminderTextMaxChars),
  time: LocalTime,
  repeat: ReminderRepeat,
  health: z.boolean(),
  bypassDoNotDisturb: z.boolean(),
  enabled: z.boolean(),
});

const ReminderParams = z.object({ reminderId: Id });

export const ReminderEndpoints = {
  listReminders: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/play/reminders`,
    auth: 'user',
    response: z.object({ items: z.array(Reminder), limit: z.number().int().positive() }),
    summary: '「我 → 服务 → TA 的提醒」',
  }),
  createReminder: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/play/reminders`,
    auth: 'user',
    body: ReminderWrite.extend({ clientRequestId: Id }),
    response: Reminder,
    summary:
      '新建提醒；已有 P-44 条返回 422 limit_reached。发出 play.reminder_saved，ai-runtime 生成 5 种说法（花费算「聊天」）经 PlayAgentPort 回写',
  }),
  updateReminder: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/play/reminders/:reminderId`,
    auth: 'user',
    params: ReminderParams,
    body: ReminderWrite.omit({ characterId: true }).partial(),
    response: Reminder,
    summary: '编辑 / 开关；改了内容会重新生成说法',
  }),
  deleteReminder: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/play/reminders/:reminderId`,
    auth: 'user',
    params: ReminderParams,
    response: NoContent,
    summary: '删除提醒',
  }),
} as const;
