-- 0063_characters_plaza.sql
-- T-088 characters 配合人设广场（persona-plaza.md 第 4、5 节，hard-boundaries.md 第 6 节）：
-- 自定义角色来源（created / plaza_copy）、来源作品与版本、复制幂等键；
-- 分类触发器扩展到复制品：除原有单向规则外，复制品禁止任何「横向」修改（虚构 ↔ 原创、真人子类互换），
-- 系统检测到的儿童特征只能从否变是，来源不可改。
ALTER TABLE "characters"."characters"
  ADD COLUMN "origin_kind" text NOT NULL DEFAULT 'created',
  ADD COLUMN "origin_import_job_id" uuid,
  ADD COLUMN "plaza_work_id" uuid,
  ADD COLUMN "plaza_version" integer,
  ADD COLUMN "plaza_author_name" text,
  ADD COLUMN "plaza_idempotency_key" text,
  ADD CONSTRAINT "characters_origin_kind" CHECK ("origin_kind" IN ('created','plaza_copy')),
  ADD CONSTRAINT "characters_plaza_origin" CHECK (
    "origin_kind" <> 'plaza_copy' OR ("plaza_work_id" IS NOT NULL AND "plaza_version" IS NOT NULL)
  );
-- statement-breakpoint
CREATE UNIQUE INDEX "characters_plaza_idem_idx" ON "characters"."characters" ("owner_id","plaza_idempotency_key")
  WHERE "plaza_idempotency_key" IS NOT NULL;
-- statement-breakpoint
CREATE INDEX "characters_plaza_work_idx" ON "characters"."characters" ("plaza_work_id")
  WHERE "plaza_work_id" IS NOT NULL;
-- statement-breakpoint
CREATE OR REPLACE FUNCTION characters.guard_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      RAISE EXCEPTION 'character ownership is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.kind = 'custom' AND (
      (OLD.basis = 'real_person' AND NEW.basis <> 'real_person') OR
      (OLD.age_setting = 'minor' AND NEW.age_setting <> 'minor') OR
      (OLD.child_appearance AND NOT NEW.child_appearance)
    ) THEN
      RAISE EXCEPTION 'classification_change_forbidden' USING ERRCODE = '23514';
    END IF;
    IF OLD.origin_kind = 'plaza_copy' THEN
      IF NEW.origin_kind IS DISTINCT FROM OLD.origin_kind THEN
        RAISE EXCEPTION 'plaza copy origin is immutable' USING ERRCODE = '23514';
      END IF;
      IF (OLD.basis <> 'real_person' AND NEW.basis <> 'real_person' AND NEW.basis <> OLD.basis) OR
         (OLD.basis = 'real_person' AND NEW.real_person_kind IS DISTINCT FROM OLD.real_person_kind) OR
         (OLD.child_features_detected AND NOT NEW.child_features_detected) THEN
        RAISE EXCEPTION 'classification_change_forbidden' USING ERRCODE = '23514';
      END IF;
    END IF;
    NEW.ever_private_person := OLD.ever_private_person OR NEW.ever_private_person;
  END IF;
  NEW.ever_private_person := NEW.ever_private_person OR NEW.real_person_kind IS NOT DISTINCT FROM 'private_person';
  RETURN NEW;
END;
$$;
