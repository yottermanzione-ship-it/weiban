-- 仅修改经理要求的模型/厂商显示名称；模型键、供应商型号、路由、价格、启用状态不变。
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
SELECT pg_advisory_xact_lock(72270008);
SELECT set_config('weiban.english_names_apply', :'apply', true);
CREATE TEMP TABLE english_names_result(result jsonb) ON COMMIT DROP;
DO $rename$
DECLARE changed integer; affected integer;
BEGIN
  CREATE TEMP TABLE english_names(key text,old_name text,old_vendor text,new_name text,new_vendor text) ON COMMIT DROP;
  INSERT INTO english_names VALUES
    ('deepseek/deepseek-search','联网搜索','DeepSeek','DeepSeek Search','DeepSeek'),
    ('qwen/qwen3.5-omni-plus-realtime','千问 Omni 3.5 Plus 实时通话','阿里云百炼','Qwen Omni 3.5 Plus Realtime','Alibaba Cloud'),
    ('qwen/qwen3.8-omni-flash-realtime','千问 Omni 3.8 Flash 实时通话','阿里云百炼','Qwen Omni 3.8 Flash Realtime','Alibaba Cloud'),
    ('qwen/qwen-audio-3.0-realtime-plus#deleted:01a182e1','千问 Audio 3.0 Plus 实时通话','阿里云百炼','Qwen Audio 3.0 Plus Realtime','Alibaba Cloud'),
    ('qwen/qwen-audio-3.1-realtime-plus','千问 Audio 3.1 Plus 实时通话','阿里云百炼','Qwen Audio 3.1 Plus Realtime','Alibaba Cloud'),
    ('qwen/qwen-audio-3.1-tts-flash','千问 3.1 TTS Flash','阿里云百炼','Qwen Audio 3.1 TTS Flash','Alibaba Cloud'),
    ('siliconflow/sensevoice-small','SenseVoice Asr','硅基流动','SenseVoice ASR','SiliconFlow'),
    ('siliconflow/telespeech-asr','TeleSpeech 语音识别','硅基流动','TeleSpeech ASR','SiliconFlow'),
    ('xiaomi/mimo-v2.5-asr','MiMo 语音识别','小米 MiMo','MiMo V2.5 ASR','Xiaomi'),
    ('xiaomi/mimo-v2.6-flash','mimo-v2.6-flash','小米','MiMo V2.6 Flash','Xiaomi');
  PERFORM 1 FROM model_access.model_catalog m JOIN english_names n ON n.key=m.model_key FOR UPDATE OF m;
  IF 10<>(SELECT count(*) FROM model_access.model_catalog m JOIN english_names n ON n.key=m.model_key)
    OR EXISTS(SELECT 1 FROM model_access.model_catalog m JOIN english_names n ON n.key=m.model_key
      WHERE ROW(m.display_name,m.vendor_name) NOT IN(ROW(n.old_name,n.old_vendor),ROW(n.new_name,n.new_vendor))) THEN
    RAISE EXCEPTION 'MODEL_NAMES_CHANGED_REVIEW_REQUIRED';
  END IF;
  SELECT count(*) INTO changed FROM model_access.model_catalog m JOIN english_names n ON n.key=m.model_key
    WHERE m.display_name<>n.new_name OR m.vendor_name<>n.new_vendor;
  IF current_setting('weiban.english_names_apply')::boolean AND changed>0 THEN
    UPDATE model_access.model_catalog m SET display_name=n.new_name,vendor_name=n.new_vendor,updated_at=clock_timestamp()
    FROM english_names n WHERE n.key=m.model_key AND (m.display_name<>n.new_name OR m.vendor_name<>n.new_vendor);
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>changed THEN RAISE EXCEPTION 'MODEL_RENAME_COUNT_CHANGED'; END IF;
    INSERT INTO platform.audit_log(id,occurred_at,module,action,actor_type,target_type,target_id,details)
    VALUES(gen_random_uuid(),clock_timestamp(),'model_access','catalog.english_names_applied','system','model_catalog',NULL,jsonb_build_object('changedItems',changed,'keysAndRoutesPreserved',true));
  END IF;
  INSERT INTO english_names_result VALUES(jsonb_build_object('applied',coalesce(affected,0)>0,'changedItems',changed,'keysAndRoutesPreserved',true));
END
$rename$;
SELECT result FROM english_names_result;
COMMIT;
