-- 0157（T-20261104b）：站内角色搜索的名称 / 别名投影（docs/refactor/24-character-search.md 第 1、2 步）。
-- 不引入独立搜索集群；pg_trgm 已由 0062 启用，这里只给投影建索引（包含匹配用），不另建扩展。
--
-- 两个模块各管自己的投影，聚合层（plaza）经端口合并，不跨 schema 查询：
--   characters.search_terms：官方角色（已上架预设，scope = official）与本人角色（非试聊自定义，scope = own，
--     只按 owner_id 查）。只存角色 ID、可见范围、名字 / 经审核别名 / 关键词、拼音、简短身份说明和更新时间，
--     不存人设正文；私人卡片、导入资料只在 owner 自己的查询里出现。
--   plaza.search_terms：广场作品（名字、预设改版「基于的角色」）。
--
-- 写投影要在服务端算拼音（npm 库 pinyin-pro），数据库触发器算不了，所以分两步：
--   1. 触发器只在源表的相关列变化时登记「待刷新」（search_dirty，version 自增），与业务写入同一事务，
--      漏不掉任何写入路径（后台、导入 CLI、手工 SQL 都会登记）；
--   2. 服务端按批刷新（每分钟定时 + 每次搜索前顺手刷一小批），每个角色 / 作品一个短事务，
--      先 SKIP LOCKED 锁住待刷新行再换投影，不等任何锁，不会和业务写入互等。
-- 停用、撤稿、下架、软删、权限变化：刷新时把投影删掉；在刷新之前，查询也会再按源表核对资格
-- （同一模块内的 JOIN），所以旧投影不会让下架角色出现在结果里。硬删除随外键级联清掉。
--
-- 回填：本迁移只把现有可搜索的行登记为待刷新（一条 INSERT … SELECT，不长时间持锁），
-- 实际投影由服务端分批写入（每批 100 条、每条一个短事务）。
CREATE TABLE characters.search_terms (
  character_id uuid NOT NULL REFERENCES characters.characters (id) ON DELETE CASCADE,
  term_key text NOT NULL,
  term text NOT NULL,
  kind text NOT NULL,
  pinyin text NOT NULL DEFAULT '',
  initials text NOT NULL DEFAULT '',
  scope text NOT NULL,
  owner_id uuid,
  display_name text NOT NULL,
  identity text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_terms_pkey PRIMARY KEY (character_id, term_key),
  CONSTRAINT search_terms_kind CHECK (kind IN ('name', 'alias', 'keyword')),
  CONSTRAINT search_terms_scope CHECK (scope IN ('official', 'own')),
  CONSTRAINT search_terms_owner CHECK ((scope = 'own') = (owner_id IS NOT NULL))
);
-- statement-breakpoint
CREATE INDEX search_terms_key_idx ON characters.search_terms (term_key text_pattern_ops);
-- statement-breakpoint
CREATE INDEX search_terms_pinyin_idx ON characters.search_terms (pinyin text_pattern_ops) WHERE pinyin <> '';
-- statement-breakpoint
CREATE INDEX search_terms_initials_idx ON characters.search_terms (initials text_pattern_ops) WHERE initials <> '';
-- statement-breakpoint
CREATE INDEX search_terms_last_char_idx ON characters.search_terms ((right(term_key, 1)));
-- statement-breakpoint
CREATE INDEX search_terms_key_trgm_idx ON characters.search_terms USING gin (term_key gin_trgm_ops);
-- statement-breakpoint
CREATE INDEX search_terms_owner_idx ON characters.search_terms (owner_id) WHERE owner_id IS NOT NULL;
-- statement-breakpoint
CREATE TABLE characters.search_dirty (
  character_id uuid PRIMARY KEY REFERENCES characters.characters (id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  marked_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX search_dirty_marked_idx ON characters.search_dirty (marked_at);
-- statement-breakpoint
CREATE FUNCTION characters.mark_search_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_trial THEN RETURN NULL; END IF;
  ELSIF (OLD.is_trial AND NEW.is_trial)
     OR (NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.search_text IS NOT DISTINCT FROM OLD.search_text
     AND NEW.legacy_card IS NOT DISTINCT FROM OLD.legacy_card
     AND NEW.published_revision IS NOT DISTINCT FROM OLD.published_revision
     AND NEW.persona_version IS NOT DISTINCT FROM OLD.persona_version
     AND NEW.is_trial IS NOT DISTINCT FROM OLD.is_trial
     AND NEW.origin_kind IS NOT DISTINCT FROM OLD.origin_kind
     AND NEW.origin_import_job_id IS NOT DISTINCT FROM OLD.origin_import_job_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO characters.search_dirty (character_id) VALUES (NEW.id)
  ON CONFLICT (character_id) DO UPDATE
    SET version = characters.search_dirty.version + 1, marked_at = now();
  RETURN NULL;
END
$$;
-- statement-breakpoint
CREATE TRIGGER characters_search_dirty
  AFTER INSERT OR UPDATE ON characters.characters
  FOR EACH ROW EXECUTE FUNCTION characters.mark_search_dirty();
-- statement-breakpoint
INSERT INTO characters.search_dirty (character_id)
SELECT id FROM characters.characters
WHERE (kind = 'preset' AND status = 'published') OR (kind = 'custom' AND NOT is_trial)
ON CONFLICT (character_id) DO NOTHING;
-- statement-breakpoint
CREATE TABLE plaza.search_terms (
  work_id uuid NOT NULL REFERENCES plaza.works (id) ON DELETE CASCADE,
  term_key text NOT NULL,
  term text NOT NULL,
  kind text NOT NULL,
  pinyin text NOT NULL DEFAULT '',
  initials text NOT NULL DEFAULT '',
  author_user_id uuid NOT NULL,
  display_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plaza_search_terms_pkey PRIMARY KEY (work_id, term_key),
  CONSTRAINT plaza_search_terms_kind CHECK (kind IN ('name', 'based_on'))
);
-- statement-breakpoint
CREATE INDEX plaza_search_terms_key_idx ON plaza.search_terms (term_key text_pattern_ops);
-- statement-breakpoint
CREATE INDEX plaza_search_terms_pinyin_idx ON plaza.search_terms (pinyin text_pattern_ops) WHERE pinyin <> '';
-- statement-breakpoint
CREATE INDEX plaza_search_terms_initials_idx ON plaza.search_terms (initials text_pattern_ops) WHERE initials <> '';
-- statement-breakpoint
CREATE INDEX plaza_search_terms_last_char_idx ON plaza.search_terms ((right(term_key, 1)));
-- statement-breakpoint
CREATE INDEX plaza_search_terms_key_trgm_idx ON plaza.search_terms USING gin (term_key gin_trgm_ops);
-- statement-breakpoint
CREATE TABLE plaza.search_dirty (
  work_id uuid PRIMARY KEY REFERENCES plaza.works (id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  marked_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint
CREATE INDEX plaza_search_dirty_marked_idx ON plaza.search_dirty (marked_at);
-- statement-breakpoint
CREATE FUNCTION plaza.mark_search_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.based_on_preset_name IS NOT DISTINCT FROM OLD.based_on_preset_name
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.author_user_id IS NOT DISTINCT FROM OLD.author_user_id
     AND NEW.current_version IS NOT DISTINCT FROM OLD.current_version THEN
    RETURN NULL;
  END IF;
  INSERT INTO plaza.search_dirty (work_id) VALUES (NEW.id)
  ON CONFLICT (work_id) DO UPDATE
    SET version = plaza.search_dirty.version + 1, marked_at = now();
  RETURN NULL;
END
$$;
-- statement-breakpoint
CREATE TRIGGER works_search_dirty
  AFTER INSERT OR UPDATE ON plaza.works
  FOR EACH ROW EXECUTE FUNCTION plaza.mark_search_dirty();
-- statement-breakpoint
INSERT INTO plaza.search_dirty (work_id)
SELECT id FROM plaza.works WHERE status = 'listed'
ON CONFLICT (work_id) DO NOTHING;
