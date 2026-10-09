-- 0021_proactive.sql（恢复未提交草稿，尚未发布的新迁移）
-- T-052：主动消息与节日事件后端（D-L3-02，SIM-05～09）。
--
-- 1. proactive.holidays：节日/纪念日清单（SIM-09 第 1 条），管理员维护。
--    - dateType = 'once'：一次性，dateValue 为 YYYY-MM-DD。
--    - dateType = 'annual'：每年重复，dateValue 为 MM-DD。
-- 2. proactive.daily_events：角色日常事件（SIM-01），ai-runtime 写入，后端存储。
--    时间线保留最近 90 天（SIM-11 第 4 条），清理由应用层定时任务负责。
-- 3. proactive.proactive_sent_log：主动消息每日发送记录（SIM-05 第 4 条计数）。
--    幂等键防止重复计数；每日上限统计用 local_date（用户本地日期）。
-- 4. proactive.proactive_pending_reply：待回复状态（SIM-05 第 6 条）。
--    用户未回复时同角色不再发新的主动消息（节日纪念日祝福例外）。
-- statement-breakpoint
CREATE SCHEMA "proactive";

-- statement-breakpoint
CREATE TABLE "proactive"."holidays" (
  "id"          uuid        PRIMARY KEY,
  "name"        text        NOT NULL,
  "date_type"   text        NOT NULL,
  "date_value"  text        NOT NULL,
  "romantic"    boolean     NOT NULL DEFAULT false,
  "enabled"     boolean     NOT NULL DEFAULT true,
  "created_at"  timestamptz NOT NULL,
  "updated_at"  timestamptz NOT NULL,
  CONSTRAINT "holidays_date_type_check" CHECK ("date_type" IN ('once', 'annual')),
  CONSTRAINT "holidays_date_value_once_check" CHECK (
    "date_type" != 'once' OR "date_value" ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  CONSTRAINT "holidays_date_value_annual_check" CHECK (
    "date_type" != 'annual' OR "date_value" ~ '^\d{2}-\d{2}$'
  )
);

-- statement-breakpoint
CREATE INDEX "holidays_enabled_idx"     ON "proactive"."holidays" ("enabled");
CREATE INDEX "holidays_date_value_idx"  ON "proactive"."holidays" ("date_type", "date_value");

-- statement-breakpoint
CREATE TABLE "proactive"."daily_events" (
  "id"                 uuid        PRIMARY KEY,
  "user_id"            uuid        NOT NULL,
  "character_id"       uuid        NOT NULL,
  "event_date"         date        NOT NULL,
  "event_time"         text,
  "summary"            text        NOT NULL,
  "with_character_id"  uuid,
  "mood_effect"        text,
  "source"             text        NOT NULL,
  "created_at"         timestamptz NOT NULL,
  CONSTRAINT "daily_events_source_check" CHECK ("source" IN ('simulation', 'public_feed'))
);

-- statement-breakpoint
CREATE INDEX "daily_events_user_char_date_idx" ON "proactive"."daily_events" ("user_id", "character_id", "event_date");
CREATE INDEX "daily_events_user_date_idx"       ON "proactive"."daily_events" ("user_id", "event_date");
CREATE INDEX "daily_events_created_at_idx"      ON "proactive"."daily_events" ("created_at");

-- statement-breakpoint
CREATE TABLE "proactive"."proactive_sent_log" (
  "id"                uuid        PRIMARY KEY,
  "user_id"           uuid        NOT NULL,
  "character_id"      uuid        NOT NULL,
  "local_date"        date        NOT NULL,
  "reason"            text        NOT NULL,
  "idempotency_key"   text        NOT NULL,
  "sent_at"           timestamptz NOT NULL
);

-- statement-breakpoint
CREATE UNIQUE INDEX "proactive_sent_idempotency_key"   ON "proactive"."proactive_sent_log" ("user_id", "idempotency_key");
CREATE        INDEX "proactive_sent_user_char_date_idx" ON "proactive"."proactive_sent_log" ("user_id", "character_id", "local_date");
CREATE        INDEX "proactive_sent_user_date_idx"      ON "proactive"."proactive_sent_log" ("user_id", "local_date");

-- statement-breakpoint
CREATE TABLE "proactive"."proactive_pending_reply" (
  "user_id"        uuid        NOT NULL,
  "character_id"   uuid        NOT NULL,
  "sent_log_id"    uuid        NOT NULL,
  "is_holiday"     boolean     NOT NULL DEFAULT false,
  "created_at"     timestamptz NOT NULL,
  CONSTRAINT "proactive_pending_reply_pk" PRIMARY KEY ("user_id", "character_id")
);

-- statement-breakpoint
-- 初始预置节日（SIM-09 第 1 条，「由产品维护在 ADM 中」，这里预置常见节日方便开发测试）
INSERT INTO "proactive"."holidays" ("id", "name", "date_type", "date_value", "romantic", "enabled", "created_at", "updated_at") VALUES
  (gen_random_uuid(), '元旦',   'annual', '01-01', false, true, now(), now()),
  (gen_random_uuid(), '情人节', 'annual', '02-14', true,  true, now(), now()),
  (gen_random_uuid(), '劳动节', 'annual', '05-01', false, true, now(), now()),
  (gen_random_uuid(), '国庆节', 'annual', '10-01', false, true, now(), now()),
  (gen_random_uuid(), '圣诞节', 'annual', '12-25', false, true, now(), now());
