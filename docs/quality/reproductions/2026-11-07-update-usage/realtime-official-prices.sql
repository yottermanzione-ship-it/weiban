-- 北京官方实时通话售价。apply=false 预览；apply=true 发布新价版。采购成本、折扣、历史流水不改。
-- 来源：https://help.aliyun.com/zh/model-studio/model-pricing
-- https://help.aliyun.com/zh/model-studio/qwen-audio-3-1-realtime-plus
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
SELECT pg_advisory_xact_lock(hashtextextended('billing:price-publish',0));
SELECT set_config('weiban.realtime_price_apply', :'apply', true);
CREATE TEMP TABLE realtime_price_result(result jsonb) ON COMMIT DROP;
DO $repair$
DECLARE current_id uuid; new_id uuid; changed integer; total integer;
BEGIN
  SELECT id INTO STRICT current_id FROM billing.price_versions WHERE status='active' FOR UPDATE;
  CREATE TEMP TABLE realtime_official(model text,unit text,price bigint) ON COMMIT DROP;
  INSERT INTO realtime_official
  SELECT m.model,u.unit,(u.price*1000000)::bigint FROM
    (VALUES ('qwen3.8-omni-flash-realtime',1.5,6,4.5,12,0.01),
      ('qwen3.5-omni-plus-realtime',10,80,60,300,0.01),
      ('qwen-audio-3.1-realtime-plus',5,40,40,150,NULL)) m(model,ti,ai,ot,oa,clone)
    CROSS JOIN LATERAL (VALUES ('input_tokens_per_million',m.ti),('cached_input_tokens_per_million',m.ti),
      ('output_tokens_per_million',m.ot),('audio_input_tokens_per_million',m.ai),
      ('audio_output_tokens_per_million',m.oa),('voice_clone',m.clone)) u(unit,price)
  WHERE u.price IS NOT NULL;
  IF 3<>(SELECT count(*) FROM model_access.model_catalog m JOIN model_access.upstreams u ON u.id=m.upstream_id
    WHERE m.deleted_at IS NULL AND m.upstream_model_id IN (SELECT model FROM realtime_official)
      AND u.base_url LIKE 'https://dashscope.aliyuncs.com/%' AND u.kind='dashscope') THEN
    RAISE EXCEPTION 'REALTIME_MODEL_OR_REGION_CHANGED';
  END IF;
  CREATE TEMP TABLE realtime_corrections ON COMMIT DROP AS
    SELECT p.id,o.price FROM billing.price_items p JOIN model_access.model_catalog m ON m.model_key=p.model_key AND m.deleted_at IS NULL
    JOIN realtime_official o ON o.model=m.upstream_model_id AND o.unit=p.unit WHERE p.price_version_id=current_id;
  IF 17<>(SELECT count(*) FROM realtime_corrections) OR EXISTS(
    SELECT 1 FROM billing.price_items p JOIN realtime_corrections c ON c.id=p.id
    WHERE p.band IS NOT NULL OR p.price_micros NOT IN (c.price,ceil(c.price::numeric*13/10))) THEN
    RAISE EXCEPTION 'REALTIME_PRICES_CHANGED_REVIEW_REQUIRED';
  END IF;
  SELECT count(*) INTO total FROM billing.price_items WHERE price_version_id=current_id;
  SELECT count(*) INTO changed FROM realtime_corrections c JOIN billing.price_items p ON p.id=c.id WHERE p.price_micros<>c.price;
  IF changed>0 AND current_setting('weiban.realtime_price_apply')::boolean THEN
    new_id:=gen_random_uuid();
    INSERT INTO billing.price_versions(id,version_label,status,note,created_at)
    VALUES(new_id,'voice-official-20261107','draft','实时通话采用北京官方价，采购成本与历史账目保留',clock_timestamp());
    INSERT INTO billing.price_items(id,price_version_id,model_key,unit,band,price_micros,cost_micros,sort_order)
    SELECT gen_random_uuid(),new_id,p.model_key,p.unit,p.band,coalesce(c.price,p.price_micros),p.cost_micros,p.sort_order
    FROM billing.price_items p LEFT JOIN realtime_corrections c ON c.id=p.id WHERE p.price_version_id=current_id;
    UPDATE billing.price_versions SET status='retired',retired_at=clock_timestamp() WHERE id=current_id;
    UPDATE billing.price_versions SET status='active',effective_from=clock_timestamp() WHERE id=new_id;
    INSERT INTO platform.audit_log(id,occurred_at,module,action,actor_type,target_type,target_id,details)
    VALUES(gen_random_uuid(),clock_timestamp(),'billing','price_version.realtime_official_published','system','price_version',new_id::text,
      jsonb_build_object('replaced',current_id,'items',total,'changedItems',changed,'costsPreserved',true,'historicalLedgerUnchanged',true));
  END IF;
  INSERT INTO realtime_price_result VALUES(jsonb_build_object('applied',new_id IS NOT NULL,'changedItems',changed,'items',total,'costsPreserved',true,'historicalLedgerUnchanged',true));
END
$repair$;
SELECT result FROM realtime_price_result;
COMMIT;
