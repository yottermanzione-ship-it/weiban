-- 旧卡完整版本快照（2026-10-25 总经理批准 0143，只用于角色资料可追溯 / 恢复）。
-- 保存或恢复前，在同一事务里先把「当前完整状态」留一份；恢复时按 (character_id, revision) 取回。
-- 与旧卡同等权限：只给后台角色管理读，不经过 platform.audit_log 的通用脱敏，因此快照里的长字母数字、
-- URL、未识别旧字段都按原样保存。这里不存头像的短效签名 URL，只存 media id 与展示参数。
-- 不存上架状态与资格标注：恢复不还原这两项，也不改角色 ID / 联系人 / 消息。
CREATE TABLE characters.legacy_character_revisions (
  character_id uuid NOT NULL REFERENCES characters.characters (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  source text NOT NULL,
  operator_user_id uuid,
  note text,
  name text NOT NULL,
  search_text text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  signature text NOT NULL DEFAULT '',
  legacy_card jsonb NOT NULL,
  avatar_media_id uuid,
  avatar_display jsonb NOT NULL DEFAULT '{}'::jsonb,
  lorebook jsonb NOT NULL DEFAULT '[]'::jsonb,
  examples jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT legacy_character_revisions_pk PRIMARY KEY (character_id, revision),
  CONSTRAINT legacy_character_revisions_source_check CHECK (source IN ('save', 'restore'))
);
COMMENT ON TABLE characters.legacy_character_revisions IS
  '旧卡保存/恢复前的完整快照；不经审计脱敏，供同角色历史查看与恢复';
COMMENT ON COLUMN characters.legacy_character_revisions.revision IS
  '快照对应的角色 revision（保存/恢复前的那一刻）';
COMMENT ON COLUMN characters.legacy_character_revisions.source IS
  'save = 保存前留存；restore = 恢复前留存';
COMMENT ON COLUMN characters.legacy_character_revisions.legacy_card IS
  'characters_v2 整行原样（含未识别字段），不是 WB-Card';
COMMENT ON COLUMN characters.legacy_character_revisions.lorebook IS
  '世界书条目数组 [{id, payload}]，保留原 id 与原 payload';
COMMENT ON COLUMN characters.legacy_character_revisions.examples IS
  '对话示例数组 [{id, sortOrder, payload}]，保留原 id 与原 payload';
CREATE INDEX legacy_character_revisions_created_idx
  ON characters.legacy_character_revisions (character_id, created_at DESC);
