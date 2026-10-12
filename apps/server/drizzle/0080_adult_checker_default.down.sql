UPDATE model_access.model_catalog SET default_for = array_remove(default_for, 'adult_check')
WHERE 'adult_check' = ANY(default_for);
--> statement-breakpoint
ALTER TABLE model_access.model_catalog DROP CONSTRAINT model_catalog_adult_not_default;
--> statement-breakpoint
ALTER TABLE model_access.model_catalog ADD CONSTRAINT model_catalog_adult_not_default
CHECK (NOT ('adult_content' = ANY(capabilities) AND cardinality(default_for) > 0));
