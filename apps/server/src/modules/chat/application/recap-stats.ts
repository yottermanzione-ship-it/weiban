/**
 * 年度回忆用的只读聚合（10-25）。实现在 chat 内部，跨模块只经 ChatRecapReadPort 拿数字：
 * 消息正文、adult 内容、加密载荷都不出这个模块。
 *
 * 可见口径照抄 ChatRead 的「此刻用户真的能看到」（chat/application/store.ts、read.ts）：
 * - 会话必须属于本人（conversations.owner_user_id）且本人有 user_conversation_states 行、是 user 参与者；
 * - 试聊会话（trial_expires_at 非空）在试聊结束后用户看不到，整段排除；
 * - 归档**不排除**：删除好友后归档的会话用户仍能打开读；
 * - 消息必须 status = normal、scope = normal（私密原文永不进入年度回忆）、seq 超过本人清空位置、
 *   不在本人隐藏清单里、不带 health / quirk_draft 标签；
 * - 系统提示（sender_kind = system）不计。
 *
 * 「你发言」按发送者参与者判定（participants.kind = 'user' AND ref_id = 本人），
 * 不把同一个群里的其他角色或别的用户的发言算成你。
 * 每条消息只统计一次：聚合直接落在 messages 行上，join 的 participants 是主键一对一，不会拆成多行。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  Id,
  type ChatRecapAggregates,
  type ChatRecapNightCandidate,
  type ChatRecapReadPort,
  type ChatRecapWindow,
} from '@weiban/contracts';
import { DATABASE, parseContract, type Database } from '../../../platform/index.js';

/** 北京时间的本地墙上时间；夜间 / 按日聚合都以它为准（不是服务器时区）。 */
const LOCAL_TS = `(m.created_at AT TIME ZONE 'Asia/Shanghai')`;
const LOCAL_HOUR = `extract(hour FROM ${LOCAL_TS})`;
const IS_NIGHT = `(${LOCAL_HOUR} >= 22 OR ${LOCAL_HOUR} < 6)`;
/** 夜间时间轴：22:00 = 0，23:59 = 119，次日 00:00 = 120，次日 03:15 = 315。 */
const NIGHT_OFFSET = `CASE WHEN ${LOCAL_HOUR} >= 22
  THEN ((${LOCAL_HOUR} - 22) * 60 + extract(minute FROM ${LOCAL_TS}))
  ELSE ((${LOCAL_HOUR} + 2) * 60 + extract(minute FROM ${LOCAL_TS})) END`;
/** 自然夜：22:00–23:59 记当天；00:00–05:59 记前一天。仅用于「几个晚上」，展示仍用真实日期。 */
const NIGHT_KEY = `CASE WHEN ${LOCAL_HOUR} >= 22 THEN ${LOCAL_TS}::date ELSE (${LOCAL_TS}::date - 1) END`;

/** 可见消息的公共 CTE；$1 = 用户，$2 = 窗口起（含），$3 = 窗口止（不含）。 */
const VISIBLE_CTE = `
WITH visible AS (
  SELECT m.id,
         m.created_at,
         c.id AS conversation_id,
         c.type AS conversation_type,
         c.character_id,
         (sp.kind = 'user' AND sp.ref_id = $1::uuid) AS is_user,
         sp.kind AS sender_kind,
         ${LOCAL_TS} AS local_ts,
         (substring(m.id::text, 15, 1) = '5') AS migrated
    FROM chat.messages m
    JOIN chat.conversations c ON c.id = m.conversation_id
    JOIN chat.user_conversation_states ucs
      ON ucs.conversation_id = c.id AND ucs.user_id = $1::uuid
    JOIN chat.participants sp ON sp.id = m.sender_participant_id
   WHERE c.owner_user_id = $1::uuid
     AND c.trial_expires_at IS NULL
     AND EXISTS (
       SELECT 1 FROM chat.participants up
        WHERE up.conversation_id = c.id AND up.kind = 'user' AND up.ref_id = $1::uuid
     )
     AND m.created_at >= $2::timestamptz
     AND m.created_at < $3::timestamptz
     AND m.status = 'normal'
     AND m.scope = 'normal'
     AND m.seq > ucs.cleared_through_seq
     AND NOT (COALESCE(m.labels, '{}'::text[]) && ARRAY['health', 'quirk_draft']::text[])
     AND NOT EXISTS (
       SELECT 1 FROM chat.hidden_messages h
        WHERE h.message_id = m.id AND h.user_id = $1::uuid
     )
)`;

interface TotalsRow {
  total_messages: number;
  user_messages: number;
  character_messages: number;
  group_messages: number;
  direct_messages: number;
  character_count: number;
  active_days: number;
  night_count: number;
  migrated_messages: number;
}
interface MonthRow {
  month: number;
  count: number;
}
interface DayRow {
  date: string;
  user_messages: number;
  total_messages: number;
}
interface CharacterRow {
  character_id: string;
  user_messages: number;
  last_message_at: Date;
}
interface NightRow {
  date: string;
  time: string;
  night_offset_minutes: number;
  conversation_id: string;
  character_id: string | null;
  at: Date;
}

@Injectable()
export class ChatRecapService implements ChatRecapReadPort {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async recapCandidates(
    input: ChatRecapWindow & { afterUserId?: string; limit: number },
  ): Promise<{ userIds: string[] }> {
    const limit = Math.trunc(input.limit);
    if (!Number.isFinite(limit) || limit < 1 || limit > 1000) throw new Error('limit 超出范围');
    if (input.afterUserId !== undefined) parseContract(Id, input.afterUserId);
    const { rows } = await this.db.query<{ user_id: string }>(
      `SELECT DISTINCT c.owner_user_id::text AS user_id
         FROM chat.messages m
         JOIN chat.conversations c ON c.id = m.conversation_id
         JOIN chat.user_conversation_states ucs
           ON ucs.conversation_id = c.id AND ucs.user_id = c.owner_user_id
         JOIN chat.participants sp ON sp.id = m.sender_participant_id
        WHERE c.trial_expires_at IS NULL
          AND ($4::uuid IS NULL OR c.owner_user_id > $4::uuid)
          AND m.created_at >= $2::timestamptz
          AND m.created_at < $3::timestamptz
          AND m.status = 'normal'
          AND m.scope = 'normal'
          AND m.seq > ucs.cleared_through_seq
          AND NOT (COALESCE(m.labels, '{}'::text[]) && ARRAY['health', 'quirk_draft']::text[])
          AND NOT EXISTS (
            SELECT 1 FROM chat.hidden_messages h
             WHERE h.message_id = m.id AND h.user_id = c.owner_user_id
          )
        ORDER BY 1
        LIMIT $5::int`,
      [null, input.fromIso, input.toIso, input.afterUserId ?? null, limit],
    );
    return { userIds: rows.map((row) => row.user_id) };
  }

  async recapAggregates(userId: string, window: ChatRecapWindow): Promise<ChatRecapAggregates> {
    parseContract(Id, userId);
    const params = [userId, window.fromIso, window.toIso];
    const [totals] = (
      await this.db.query<TotalsRow>(
        `${VISIBLE_CTE}
         SELECT count(*)::int AS total_messages,
                count(*) FILTER (WHERE is_user)::int AS user_messages,
                count(*) FILTER (WHERE sender_kind = 'character')::int AS character_messages,
                count(*) FILTER (WHERE conversation_type = 'group')::int AS group_messages,
                count(*) FILTER (WHERE conversation_type = 'direct')::int AS direct_messages,
                count(DISTINCT character_id) FILTER (WHERE conversation_type = 'direct')::int
                  AS character_count,
                count(DISTINCT ${LOCAL_TS}::date) FILTER (WHERE is_user)::int AS active_days,
                count(DISTINCT ${NIGHT_KEY}) FILTER (WHERE is_user AND ${IS_NIGHT})::int
                  AS night_count,
                count(*) FILTER (WHERE migrated)::int AS migrated_messages
           FROM visible`,
        params,
      )
    ).rows;
    const months = (
      await this.db.query<MonthRow>(
        `${VISIBLE_CTE}
         SELECT extract(month FROM local_ts)::int AS month, count(*)::int AS count
           FROM visible
          WHERE is_user
          GROUP BY 1
          ORDER BY 1`,
        params,
      )
    ).rows;
    const days = (
      await this.db.query<DayRow>(
        `${VISIBLE_CTE}
         SELECT to_char(local_ts::date, 'YYYY-MM-DD') AS date,
                count(*) FILTER (WHERE is_user)::int AS user_messages,
                count(*)::int AS total_messages
           FROM visible
          GROUP BY local_ts::date
          ORDER BY user_messages DESC, local_ts::date DESC
          LIMIT 5`,
        params,
      )
    ).rows;
    const characters = (
      await this.db.query<CharacterRow>(
        `${VISIBLE_CTE}
         SELECT character_id::text AS character_id,
                count(*)::int AS user_messages,
                max(created_at) AS last_message_at
           FROM visible
          WHERE is_user AND conversation_type = 'direct' AND character_id IS NOT NULL
          GROUP BY character_id
          ORDER BY user_messages DESC, last_message_at DESC
          LIMIT 5`,
        params,
      )
    ).rows;
    const nights = (
      await this.db.query<NightRow>(
        `${VISIBLE_CTE}
         SELECT to_char(local_ts::date, 'YYYY-MM-DD') AS date,
                to_char(local_ts, 'HH24:MI') AS time,
                (${NIGHT_OFFSET})::int AS night_offset_minutes,
                conversation_id::text AS conversation_id,
                character_id::text AS character_id,
                created_at AS at
           FROM visible
          WHERE is_user AND ${IS_NIGHT}
          ORDER BY night_offset_minutes DESC, created_at DESC
          LIMIT 10`,
        params,
      )
    ).rows;
    const dates = (
      await this.db.query<{ date: string }>(
        `${VISIBLE_CTE}
         SELECT to_char(local_ts::date, 'YYYY-MM-DD') AS date
           FROM visible
          WHERE is_user
          GROUP BY local_ts::date
          ORDER BY local_ts::date`,
        params,
      )
    ).rows;

    const monthly = new Map(months.map((row) => [row.month, row.count]));
    const nightCandidates: ChatRecapNightCandidate[] = nights.map((row) => ({
      date: row.date,
      time: row.time,
      nightOffsetMinutes: row.night_offset_minutes,
      conversationId: row.conversation_id,
      characterId: row.character_id,
      atIso: row.at.toISOString(),
    }));
    return {
      totalMessages: totals?.total_messages ?? 0,
      userMessages: totals?.user_messages ?? 0,
      characterMessages: totals?.character_messages ?? 0,
      groupMessages: totals?.group_messages ?? 0,
      directMessages: totals?.direct_messages ?? 0,
      characterCount: totals?.character_count ?? 0,
      activeDays: totals?.active_days ?? 0,
      monthlyUserMessages: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        count: monthly.get(index + 1) ?? 0,
      })),
      topCharacters: characters.map((row) => ({
        characterId: row.character_id,
        userMessages: row.user_messages,
        lastMessageAt: row.last_message_at.toISOString(),
      })),
      busiestDays: days.map((row) => ({
        date: row.date,
        userMessages: row.user_messages,
        totalMessages: row.total_messages,
      })),
      nightCandidates,
      nightCount: totals?.night_count ?? 0,
      activeDates: dates.map((row) => row.date),
      migratedMessages: totals?.migrated_messages ?? 0,
    };
  }
}
