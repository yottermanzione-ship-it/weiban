-- 0141_recap_year_recaps.sql（10-25 会员 v6：年度回忆，PRO+ 权益）
--
-- 每年 12 月 31 日 22:00（北京时间）由 recap.year_end 任务生成一份，统计窗口是当年
-- 1 月 1 日 00:00 至 12 月 31 日 22:00（含头不含尾），不宣称包含最后一秒。
-- 整份载荷（统计 + 文案）按该用户 DEK 信封加密后存在 payload_ciphertext；表里没有明文正文、没有角色名。
-- 唯一键 (user_id, year) 保证重试 / 多实例 / 重启补跑都只会有一份；seen_at = null 表示还没被本人看过。
-- 没有手动生成 / 列表入口，读取只有「待展示的那一份」+ 已读确认。

CREATE SCHEMA IF NOT EXISTS recap;

CREATE TABLE recap.year_recaps (
  id                  uuid        PRIMARY KEY,
  user_id             uuid        NOT NULL,
  year                integer     NOT NULL,
  payload_ciphertext  bytea       NOT NULL,
  generated_at        timestamptz NOT NULL,
  delivered_at        timestamptz,
  seen_at             timestamptz,
  version             integer     NOT NULL DEFAULT 1,
  CONSTRAINT year_recaps_owner_year UNIQUE (user_id, year),
  CONSTRAINT year_recaps_year_range CHECK (year BETWEEN 2026 AND 9999),
  CONSTRAINT year_recaps_version CHECK (version >= 1)
);

CREATE INDEX year_recaps_pending_idx ON recap.year_recaps (user_id, generated_at DESC);
