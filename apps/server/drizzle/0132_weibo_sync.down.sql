-- Financial history must be exported/resolved before removing this capability.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM billing.shared_search_calls WHERE state <> 'cancelled')
 OR EXISTS(SELECT 1 FROM billing.shared_search_carries WHERE carry_micros <> 0)
 OR EXISTS(SELECT 1 FROM ai_runtime.weibo_items)
 OR EXISTS(SELECT 1 FROM characters.public_updates WHERE source='weibo_sync')
 THEN RAISE EXCEPTION 'Shared search financial records require explicit resolution before rollback'; END IF;
END; $$;
DROP TABLE model_access.shared_search_receipts;
DROP INDEX characters.public_updates_weibo_key_idx;
ALTER TABLE characters.public_updates DROP CONSTRAINT public_updates_source_check;
ALTER TABLE characters.public_updates ADD CONSTRAINT public_updates_source_check CHECK(source IN ('manual','auto_search'));
DROP TABLE ai_runtime.weibo_deliveries;
DROP TABLE ai_runtime.weibo_items;
DROP TABLE ai_runtime.weibo_sync_states;
DROP TABLE billing.shared_search_carries;
DROP TABLE billing.shared_search_members;
DROP TABLE billing.shared_search_calls;
