-- 2026-11-05 总经理要求撤销成本加三成调价，并使固定私密模型使用 Astra 的售价。
-- psql -v apply=false 预览；apply=true 才发布。只复制价目，不改历史流水、旧报价或折扣。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT pg_advisory_xact_lock(hashtextextended('billing:price-publish', 0));
SELECT set_config('weiban.price_restore_apply', :'apply', true);
CREATE TEMP TABLE price_restore_result(result jsonb) ON COMMIT DROP;
DO $repair$
DECLARE
  current_id uuid;
  current_label text;
  previous_id uuid;
  receipt jsonb;
  private_key text;
  astra_key text;
  fx numeric;
  total_items integer;
  recorded_changes integer;
  changed_items integer;
  private_changed integer;
  new_id uuid;
  apply_change boolean := current_setting('weiban.price_restore_apply')::boolean;
BEGIN
  SELECT id,version_label INTO STRICT current_id,current_label
  FROM billing.price_versions WHERE status='active' FOR UPDATE;
  IF current_label='official-20261105-restore' THEN
    IF NOT EXISTS (SELECT 1 FROM platform.audit_log WHERE module='billing'
      AND action='price_version.official_restored' AND target_id=current_id::text
      AND details->>'incident'='2026-11-05-cost-plus-reversal') THEN
      RAISE EXCEPTION 'RESTORE_RECEIPT_MISSING';
    END IF;
    INSERT INTO price_restore_result VALUES(jsonb_build_object('applied',false,'alreadyApplied',true,'changedItems',0));
    RETURN;
  END IF;
  IF current_label NOT LIKE 'cost-plus-%' THEN RAISE EXCEPTION 'ACTIVE_PRICE_CHANGED'; END IF;
  SELECT details INTO STRICT receipt FROM platform.audit_log
  WHERE module='billing' AND action='price_version.cost_plus_published' AND target_id=current_id::text;
  previous_id := (receipt->>'replaced')::uuid;
  recorded_changes := (receipt->>'changedItems')::integer;
  IF previous_id IS NULL OR recorded_changes IS NULL OR recorded_changes<1
    OR NOT EXISTS(SELECT 1 FROM billing.price_versions WHERE id=previous_id AND status='retired') THEN
    RAISE EXCEPTION 'ORIGINAL_PRICE_NOT_VERIFIABLE';
  END IF;
  -- 只允许恢复本次错误政策直接生成、且之后没有被改过的价目。
  SELECT count(*) INTO total_items FROM billing.price_items WHERE price_version_id=previous_id;
  IF total_items=0 OR total_items<>(SELECT count(*) FROM billing.price_items WHERE price_version_id=current_id)
    OR EXISTS (
      (SELECT model_key,unit,band,cost_micros,sort_order FROM billing.price_items WHERE price_version_id=current_id
       EXCEPT ALL SELECT model_key,unit,band,cost_micros,sort_order FROM billing.price_items WHERE price_version_id=previous_id)
      UNION ALL
      (SELECT model_key,unit,band,cost_micros,sort_order FROM billing.price_items WHERE price_version_id=previous_id
       EXCEPT ALL SELECT model_key,unit,band,cost_micros,sort_order FROM billing.price_items WHERE price_version_id=current_id)
    )
    OR EXISTS (SELECT 1 FROM billing.price_items WHERE price_version_id=current_id
      AND price_micros<>ceil(cost_micros::numeric*13/10)) THEN
    RAISE EXCEPTION 'CURRENT_PRICE_NO_LONGER_MATCHES_INCIDENT';
  END IF;
  IF EXISTS (SELECT 1 FROM billing.price_items WHERE price_version_id=previous_id
    GROUP BY model_key,unit,band HAVING count(*)<>1) THEN RAISE EXCEPTION 'AMBIGUOUS_ORIGINAL_PRICE'; END IF;
  IF recorded_changes<>(SELECT count(*) FROM billing.price_items c JOIN billing.price_items p
    ON p.price_version_id=previous_id AND p.model_key=c.model_key AND p.unit=c.unit AND p.band IS NOT DISTINCT FROM c.band
    WHERE c.price_version_id=current_id AND c.price_micros<>p.price_micros) THEN
    RAISE EXCEPTION 'RECORDED_CHANGE_COUNT_MISMATCH';
  END IF;
  SELECT model_key INTO STRICT astra_key FROM model_access.model_catalog
  WHERE deleted_at IS NULL AND enabled AND lower(upstream_model_id)='gpt-6-astra';
  SELECT m.model_key INTO STRICT private_key FROM model_access.settings s
  JOIN model_access.model_catalog m ON m.model_key=s.value#>>'{fixed,private}'
  WHERE s.key='model_uses' AND m.deleted_at IS NULL AND m.enabled AND m.scenarios @> ARRAY['private']::text[];
  IF astra_key=private_key THEN RAISE EXCEPTION 'PRIVATE_REFERENCE_IS_SAME_MODEL'; END IF;
  SELECT coalesce((SELECT (value->>'usdCnyRate')::numeric FROM model_access.settings WHERE key='models_dev_settings'),7.2) INTO fx;
  IF fx<=0 THEN RAISE EXCEPTION 'INVALID_REFERENCE_EXCHANGE_RATE'; END IF;
  -- 2026-11-05 官方标准短上下文价：输入 10、缓存命中 1、输出 50 美元/百万。
  -- 先验证恢复源中的 Astra 三项与官方一致，防止把本次错误加价复制给私密模型。
  IF 3<>(SELECT count(*) FROM billing.price_items p
    JOIN (VALUES('input_tokens_per_million',10::numeric),('cached_input_tokens_per_million',1::numeric),('output_tokens_per_million',50::numeric)) o(unit,usd)
      ON o.unit=p.unit
    WHERE p.price_version_id=previous_id AND p.model_key=astra_key AND p.band IS NULL
      AND p.price_micros=round(o.usd*fx*1000000)) THEN
    RAISE EXCEPTION 'ASTRA_ORIGINAL_DOES_NOT_MATCH_OFFICIAL';
  END IF;
  IF EXISTS(SELECT 1 FROM billing.price_items WHERE price_version_id=previous_id
    AND model_key IN (astra_key,private_key) AND band IS NOT NULL)
    OR EXISTS (
      SELECT unit FROM billing.price_items WHERE price_version_id=previous_id AND model_key=private_key
      EXCEPT SELECT unit FROM billing.price_items WHERE price_version_id=previous_id AND model_key=astra_key
    ) THEN RAISE EXCEPTION 'PRIVATE_REFERENCE_PRICE_UNITS_DIFFER'; END IF;
  -- 只对齐私密模型已有的计价项；Astra 独有的缓存写入等项目不凭空添加采购成本。
  CREATE TEMP TABLE corrected_price_items ON COMMIT DROP AS
    SELECT p.model_key,p.unit,p.band,p.cost_micros,p.sort_order,
      CASE WHEN p.model_key=private_key THEN a.price_micros ELSE p.price_micros END AS price_micros
    FROM billing.price_items p LEFT JOIN billing.price_items a
      ON a.price_version_id=previous_id AND a.model_key=astra_key AND a.unit=p.unit AND a.band IS NULL
    WHERE p.price_version_id=previous_id;
  IF EXISTS(SELECT 1 FROM corrected_price_items WHERE price_micros IS NULL OR price_micros<0) THEN
    RAISE EXCEPTION 'CORRECTED_PRICE_MISSING';
  END IF;
  SELECT count(*),count(*) FILTER(WHERE n.model_key=private_key) INTO changed_items,private_changed
  FROM corrected_price_items n JOIN billing.price_items c ON c.price_version_id=current_id
    AND c.model_key=n.model_key AND c.unit=n.unit AND c.band IS NOT DISTINCT FROM n.band
  WHERE c.price_micros<>n.price_micros;
  IF apply_change THEN
    new_id := gen_random_uuid();
    INSERT INTO billing.price_versions(id,version_label,status,effective_from,note,created_at,created_by)
    VALUES(new_id,'official-20261105-restore','draft',NULL,'撤销错误的成本加三成调价；私密模型售价与 Astra 一致',clock_timestamp(),NULL);
    INSERT INTO billing.price_items(id,price_version_id,model_key,unit,band,price_micros,cost_micros,sort_order)
    SELECT gen_random_uuid(),new_id,model_key,unit,band,price_micros,cost_micros,sort_order FROM corrected_price_items;
    UPDATE billing.price_versions SET status='retired',retired_at=clock_timestamp() WHERE id=current_id;
    UPDATE billing.price_versions SET status='active',effective_from=clock_timestamp() WHERE id=new_id;
    INSERT INTO platform.audit_log(id,occurred_at,module,action,actor_type,actor_id,target_type,target_id,details)
    VALUES(gen_random_uuid(),clock_timestamp(),'billing','price_version.official_restored','system',NULL,'price_version',new_id::text,
      jsonb_build_object('incident','2026-11-05-cost-plus-reversal','replaced',current_id,'restoredFrom',previous_id,
        'items',total_items,'changedItems',changed_items,'privateChangedItems',private_changed,'astraReference',astra_key,
        'privateModel',private_key,'costsPreserved',true,'historicalLedgerUnchanged',true));
  END IF;
  INSERT INTO price_restore_result VALUES(jsonb_build_object('applied',apply_change,'alreadyApplied',false,
    'items',total_items,'changedItems',changed_items,'privateChangedItems',private_changed,
    'costsPreserved',true,'historicalLedgerUnchanged',true));
END
$repair$;
SELECT result FROM price_restore_result;
COMMIT;
