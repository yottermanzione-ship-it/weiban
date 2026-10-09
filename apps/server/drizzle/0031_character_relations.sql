-- 0031_character_relations.sql
-- T-063 关系网（SOC-01、ADM-02）。一条关系双向生效：character_a_id < character_b_id（服务器规范化）。
-- 预设角色之间：owner_user_id 为空、evidence（公开依据）必填；自定义角色之间：owner_user_id 为设定的用户、evidence 为空。
-- statement-breakpoint
CREATE TABLE "characters"."relations" (
  "id"             uuid        PRIMARY KEY,
  "character_a_id" uuid        NOT NULL REFERENCES "characters"."characters"("id") ON DELETE CASCADE,
  "character_b_id" uuid        NOT NULL REFERENCES "characters"."characters"("id") ON DELETE CASCADE,
  "type"           text        NOT NULL,
  "label"          text,
  "closeness"      text        NOT NULL,
  "evidence"       text,
  "owner_user_id"  uuid,
  "created_by"     uuid,
  "created_at"     timestamptz NOT NULL,
  "updated_at"     timestamptz NOT NULL,
  CONSTRAINT "relations_order_check" CHECK ("character_a_id" < "character_b_id"),
  CONSTRAINT "relations_type_check" CHECK ("type" IN ('groupmate','costar','friend','mentor','family','colleague','in_work','other')),
  CONSTRAINT "relations_closeness_check" CHECK ("closeness" IN ('acquaintance','familiar','close')),
  CONSTRAINT "relations_label_check" CHECK ("label" IS NULL OR char_length("label") <= 30),
  CONSTRAINT "relations_evidence_check" CHECK (
    ("owner_user_id" IS NULL AND "evidence" IS NOT NULL AND char_length("evidence") BETWEEN 1 AND 500)
    OR ("owner_user_id" IS NOT NULL AND "evidence" IS NULL)
  )
);
-- statement-breakpoint
CREATE UNIQUE INDEX "relations_pair_idx" ON "characters"."relations" ("character_a_id", "character_b_id");
-- statement-breakpoint
CREATE INDEX "relations_b_idx" ON "characters"."relations" ("character_b_id");
-- statement-breakpoint
CREATE INDEX "relations_owner_idx" ON "characters"."relations" ("owner_user_id") WHERE "owner_user_id" IS NOT NULL;
