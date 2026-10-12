-- 成人检查只可供有资格角色使用；生成默认仍不能选择无审查模型。
ALTER TABLE model_access.model_catalog DROP CONSTRAINT model_catalog_adult_not_default;
--> statement-breakpoint
ALTER TABLE model_access.model_catalog ADD CONSTRAINT model_catalog_adult_not_default
CHECK (NOT ('adult_content' = ANY(capabilities)) OR default_for <@ ARRAY['adult_check']::text[]);
