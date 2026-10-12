-- 0065_play_daily_question.sql（T-091）：新模块 play（上层，schema "play"）的第一批表——每日一问（PLAY-03）。
-- 题库（标签、上下架，ADM-04 第 5 条）、每天的回答（每用户每个当地日期一条，正文加密）、上次选的角色。
CREATE SCHEMA IF NOT EXISTS "play";
-- statement-breakpoint
CREATE TABLE "play"."daily_questions" (
  "id"         uuid        PRIMARY KEY,
  "text"       text        NOT NULL,
  "tags"       text[]      NOT NULL DEFAULT '{}'::text[],
  "listed"     boolean     NOT NULL DEFAULT true,
  "created_by" uuid,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "daily_question_text_len" CHECK (char_length("text") BETWEEN 1 AND 100),
  CONSTRAINT "daily_question_tags" CHECK ("tags" <@ ARRAY['romance','child_safe','work','family','childhood','light']::text[])
);
-- statement-breakpoint
CREATE INDEX "daily_questions_listed_idx" ON "play"."daily_questions" ("listed","created_at","id");
-- statement-breakpoint
CREATE TABLE "play"."daily_answers" (
  "id"                          uuid        PRIMARY KEY,
  "user_id"                     uuid        NOT NULL,
  "character_id"                uuid        NOT NULL,
  "local_date"                  date        NOT NULL,
  "question_id"                 uuid        NOT NULL,
  "question_text"               text        NOT NULL,
  "user_answer_ciphertext"      bytea       NOT NULL,
  "character_answer_ciphertext" bytea,
  "character_answer_status"     text        NOT NULL DEFAULT 'pending',
  "message_id"                  uuid,
  "client_request_id"           uuid        NOT NULL,
  "answered_at"                 timestamptz NOT NULL,
  "updated_at"                  timestamptz NOT NULL,
  CONSTRAINT "daily_answer_status" CHECK ("character_answer_status" IN ('pending','ready','waiting_balance'))
);
-- statement-breakpoint
CREATE UNIQUE INDEX "daily_answers_user_date_idx" ON "play"."daily_answers" ("user_id","local_date");
-- statement-breakpoint
CREATE UNIQUE INDEX "daily_answers_user_request_idx" ON "play"."daily_answers" ("user_id","client_request_id");
-- statement-breakpoint
CREATE INDEX "daily_answers_user_history_idx" ON "play"."daily_answers" ("user_id","local_date" DESC,"id" DESC);
-- statement-breakpoint
CREATE INDEX "daily_answers_status_idx" ON "play"."daily_answers" ("character_answer_status","user_id");
-- statement-breakpoint
CREATE TABLE "play"."daily_prefs" (
  "user_id"           uuid        PRIMARY KEY,
  "last_character_id" uuid        NOT NULL,
  "updated_at"        timestamptz NOT NULL
);
-- statement-breakpoint
-- 起步题库（管理员可在后台编辑、下架；没有任何题目时接口返回 404）。
INSERT INTO "play"."daily_questions" ("id","text","tags","listed","created_at","updated_at") VALUES
  (gen_random_uuid(), '如果明天放假一天，你会做什么？', ARRAY['light','child_safe'], true, now(), now()),
  (gen_random_uuid(), '最近让你开心的一件小事是什么？', ARRAY['light','child_safe'], true, now(), now()),
  (gen_random_uuid(), '小时候最喜欢的零食是什么？', ARRAY['childhood','child_safe'], true, now(), now()),
  (gen_random_uuid(), '你最喜欢一年里的哪个季节？为什么？', ARRAY['light','child_safe'], true, now(), now()),
  (gen_random_uuid(), '如果可以养任何一种动物，你想养什么？', ARRAY['light','child_safe'], true, now(), now()),
  (gen_random_uuid(), '家里谁做饭最好吃？', ARRAY['family','child_safe'], true, now(), now()),
  (gen_random_uuid(), '小时候的梦想是什么？现在还记得吗？', ARRAY['childhood'], true, now(), now()),
  (gen_random_uuid(), '最近一次被感动是因为什么？', ARRAY['light'], true, now(), now()),
  (gen_random_uuid(), '你理想中的约会是什么样的？', ARRAY['romance'], true, now(), now()),
  (gen_random_uuid(), '第一次心动是什么感觉？', ARRAY['romance'], true, now(), now()),
  (gen_random_uuid(), '这周工作上最忙的是哪一天？', ARRAY['work'], true, now(), now()),
  (gen_random_uuid(), '下雨天你最想待在哪里？', ARRAY['light','child_safe'], true, now(), now());
