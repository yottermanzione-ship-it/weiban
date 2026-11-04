-- 0158（T-20261104e）：角色搜索第 3 步——站外候选快照、搜索实体关联、后台搜索别名
-- （docs/refactor/24-character-search.md「索引和身份」「与 S 的衔接及费用」、分步实现第 3 条）。
--
-- model_access.web_candidates：联网查找（S）结构化后的候选快照，点击时按候选 ID 重读，
--   不信任客户端提交的名字和网址。只存公开搜索结果（已过隐私词和公开人物 / 虚构作品过滤）：
--   显示名、标题、摘要、摘出的身份说明、出处、公开资料标识。不存查询原文、不存用户 ID；24 小时过期，
--   维护任务清理（与 S 的候选缓存同期）。候选 ID 由公开资料标识或规范化出处算出，同一条目每次都一样。
--
-- characters.search_entities / search_entity_identifiers / search_entity_characters：
--   后台登记的搜索实体。实体键 = 经核实的公开资料标识（baike:…、wiki:zh:… 等，从百科条目地址结构取）
--   或平台人工关联的 manual:<uuid>。一个实体可以有多个公开资料标识（人工合并）、关联多个官方角色；
--   一个标识、一个角色最多属于一个实体（主键保证），改归属必须显式合并 / 拆分。
--   只有这里登记过的标识才会把站外候选并到官方角色上；名字相同绝不自动合并。
--   不存操作人 ID（谁、何时、改了什么、原因写 platform.audit_log，注销时随审计一起匿名化）。
--
-- characters.search_aliases：后台为官方角色加的搜索别名（pending 待审核不进投影、approved 进投影），
--   以及从搜索里去掉的人设别名（blocked，不改人设本身）。
--
-- characters.search_terms 加 entity_key / source_url：投影带上实体键和第一条出处，站内聚合结果直接显示。
--
-- 投影刷新复用 0157 的待刷新登记：上面三张表的写入由触发器登记 characters.search_dirty
-- （与后台写入同一事务），服务端定时 / 搜索前分批刷新，刷新者只用 SKIP LOCKED，不会和后台写入互等。
CREATE TABLE model_access.web_candidates (
  candidate_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT web_candidates_id CHECK (candidate_id ~ '^web_[A-Za-z0-9_-]{22}$')
);
-- statement-breakpoint
CREATE INDEX web_candidates_expires_idx ON model_access.web_candidates (expires_at);
-- statement-breakpoint
CREATE TABLE characters.search_entities (
  entity_key text PRIMARY KEY,
  display_name text NOT NULL,
  identity text,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT search_entities_key CHECK (char_length(entity_key) BETWEEN 3 AND 120),
  CONSTRAINT search_entities_name CHECK (char_length(display_name) BETWEEN 1 AND 64),
  CONSTRAINT search_entities_identity CHECK (identity IS NULL OR char_length(identity) BETWEEN 1 AND 120),
  CONSTRAINT search_entities_sources CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) <= 5)
);
-- statement-breakpoint
CREATE INDEX search_entities_updated_idx ON characters.search_entities (updated_at DESC);
-- statement-breakpoint
CREATE TABLE characters.search_entity_identifiers (
  identifier text PRIMARY KEY,
  entity_key text NOT NULL REFERENCES characters.search_entities (entity_key) ON DELETE CASCADE,
  source_url text,
  created_at timestamptz NOT NULL,
  CONSTRAINT search_entity_identifiers_len CHECK (char_length(identifier) BETWEEN 3 AND 120)
);
-- statement-breakpoint
CREATE INDEX search_entity_identifiers_entity_idx ON characters.search_entity_identifiers (entity_key);
-- statement-breakpoint
CREATE TABLE characters.search_entity_characters (
  character_id uuid PRIMARY KEY REFERENCES characters.characters (id) ON DELETE CASCADE,
  entity_key text NOT NULL REFERENCES characters.search_entities (entity_key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
-- statement-breakpoint
CREATE INDEX search_entity_characters_entity_idx ON characters.search_entity_characters (entity_key);
-- statement-breakpoint
CREATE TABLE characters.search_aliases (
  character_id uuid NOT NULL REFERENCES characters.characters (id) ON DELETE CASCADE,
  alias_key text NOT NULL,
  alias text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  CONSTRAINT search_aliases_pkey PRIMARY KEY (character_id, alias_key),
  CONSTRAINT search_aliases_status CHECK (status IN ('pending', 'approved', 'blocked')),
  CONSTRAINT search_aliases_len CHECK (char_length(alias) BETWEEN 1 AND 64 AND char_length(alias_key) BETWEEN 1 AND 64)
);
-- statement-breakpoint
ALTER TABLE characters.search_terms ADD COLUMN entity_key text;
-- statement-breakpoint
ALTER TABLE characters.search_terms ADD COLUMN source_url text;
-- statement-breakpoint
-- 登记待刷新：别名、角色关联变化 → 对应角色；实体的显示名 / 身份说明 / 出处变化 → 关联的全部角色。
-- 级联删除（实体删掉、角色硬删）同样会触发行级触发器；角色本身被删时登记行随外键级联删除。
CREATE FUNCTION characters.mark_search_dirty_for(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO characters.search_dirty (character_id)
  SELECT id FROM characters.characters WHERE id = target
  ON CONFLICT (character_id) DO UPDATE
    SET version = characters.search_dirty.version + 1, marked_at = now();
END
$$;
-- statement-breakpoint
CREATE FUNCTION characters.mark_search_dirty_by_character() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM characters.mark_search_dirty_for(OLD.character_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM characters.mark_search_dirty_for(NEW.character_id);
  END IF;
  RETURN NULL;
END
$$;
-- statement-breakpoint
CREATE TRIGGER search_aliases_dirty
  AFTER INSERT OR UPDATE OR DELETE ON characters.search_aliases
  FOR EACH ROW EXECUTE FUNCTION characters.mark_search_dirty_by_character();
-- statement-breakpoint
CREATE TRIGGER search_entity_characters_dirty
  AFTER INSERT OR UPDATE OR DELETE ON characters.search_entity_characters
  FOR EACH ROW EXECUTE FUNCTION characters.mark_search_dirty_by_character();
-- statement-breakpoint
CREATE FUNCTION characters.mark_search_dirty_by_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.display_name IS NOT DISTINCT FROM OLD.display_name
     AND NEW.identity IS NOT DISTINCT FROM OLD.identity
     AND NEW.sources IS NOT DISTINCT FROM OLD.sources THEN
    RETURN NULL;
  END IF;
  INSERT INTO characters.search_dirty (character_id)
  SELECT character_id FROM characters.search_entity_characters WHERE entity_key = NEW.entity_key
  ON CONFLICT (character_id) DO UPDATE
    SET version = characters.search_dirty.version + 1, marked_at = now();
  RETURN NULL;
END
$$;
-- statement-breakpoint
CREATE TRIGGER search_entities_dirty
  AFTER UPDATE ON characters.search_entities
  FOR EACH ROW EXECUTE FUNCTION characters.mark_search_dirty_by_entity();
