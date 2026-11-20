ALTER TABLE model_access.usage_records ADD COLUMN task_key uuid;
CREATE TABLE model_access.task_outcomes (
  task_key uuid PRIMARY KEY, user_id uuid NOT NULL, purpose text NOT NULL,
  state text NOT NULL CHECK (state IN ('delivered','displayed','saved','filtered','deferred','blocked','cancelled','failed')),
  reason text CHECK (reason ~ '^[a-z][a-z0-9_]{0,79}$'), usage_record_id uuid, retry_at timestamptz,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
-- 每个历史调用只按既有生成外键或完整结构化幂等键归属。
UPDATE model_access.usage_records u SET task_key=a.generation_id
FROM model_access.generation_attempts a WHERE a.usage_record_id=u.id AND a.user_id=u.user_id;
UPDATE model_access.usage_records u SET task_key=split_part(u.idempotency_key,':',2)::uuid
WHERE task_key IS NULL AND idempotency_key ~ '^gateway:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:attempt:[0-9]+$';
CREATE INDEX usage_records_task_idx ON model_access.usage_records(task_key,created_at,id);
CREATE INDEX task_outcomes_created_idx ON model_access.task_outcomes(created_at,task_key);
CREATE INDEX task_outcomes_user_idx ON model_access.task_outcomes(user_id);

-- 只复制结构化关联和采纳事实。历史缓存已清理的生成不靠时间邻近、名字或正文推断。
CREATE FUNCTION pg_temp.model_task_key(owner_id uuid, source_key text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT AS $$
  WITH raw AS (SELECT substring(sha256(convert_to('weiban:model-task:v1:'||owner_id::text||':'||source_key,'UTF8')) FROM 1 FOR 16) b)
  SELECT encode(set_byte(set_byte(b,6,(get_byte(b,6)&15)|128),8,(get_byte(b,8)&63)|128),'hex')::uuid FROM raw;
$$;
CREATE TEMP TABLE task_0168_generations ON COMMIT DROP AS
SELECT DISTINCT g.id gid,g.user_id,g.key_hash,g.created_at,u.model_key,u.purpose,u.character_id,u.conversation_id,u.prompt_template_version
FROM model_access.generation_results g JOIN model_access.usage_records u ON u.task_key=g.id AND u.user_id=g.user_id;
CREATE INDEX ON task_0168_generations(user_id,character_id,purpose,created_at);
ANALYZE task_0168_generations;

-- 只在仍有精确幂等哈希的生成范围内枚举源键，以哈希全等作为归属判据。
CREATE TEMP TABLE task_0168_matches ON COMMIT DROP AS
WITH candidates AS (
 SELECT g.*,p.id source_id,'reply:'||p.id::text source_key,
   format('ai:%s:%s:%s',p.id,e,suffix) wire_key,'reply' kind
 FROM task_0168_generations g JOIN ai_runtime.reply_plans p ON p.user_id=g.user_id AND p.character_id=g.character_id
    AND p.conversation_id=g.conversation_id AND g.created_at>=p.created_at AND g.created_at<p.due_at+interval '1 day'
 CROSS JOIN LATERAL generate_series(0,p.retry_epoch) e
 CROSS JOIN unnest(ARRAY['reply','reply-blind','names','guard','reply:meta-retry','reply-blind:meta-retry','names:meta-retry','guard:meta-retry']) suffix
 WHERE g.purpose='chat_reply'
 UNION ALL
 SELECT g.*,p.id,'proactive:'||p.id::text,'proactive:'||p.id::text||suffix,'proactive'
 FROM task_0168_generations g JOIN ai_runtime.proactive_plans p ON p.user_id=g.user_id AND p.character_id=g.character_id
    AND g.created_at>=p.created_at AND g.created_at<=p.updated_at+interval '1 day'
 CROSS JOIN unnest(ARRAY['',':care-normal',':meta-retry',':care-normal:meta-retry']) suffix WHERE g.purpose='proactive'
 UNION ALL
 SELECT g.*,p.id,'eco:murmur:'||p.id::text,'eco:murmur:'||p.id::text,'murmur'
 FROM task_0168_generations g JOIN ai_runtime.ecology_runs p ON p.user_id=g.user_id AND p.character_id=g.character_id
   AND g.created_at>=p.created_at AND g.created_at<coalesce(p.finished_at,p.started_at,p.created_at)+interval '1 day'
 WHERE g.prompt_template_version='ecology-murmur-v1'
 UNION ALL
 SELECT g.*,s.id,CASE WHEN v=s.version THEN format('summary:%s:%s:%s:%s',s.id,v,s.covered_seq,s.partial_offset) ELSE format('legacy-summary:%s:%s',s.id,v) END,format('chat-summary:%s:%s:%s',s.id,v,n),'summary'
 FROM task_0168_generations g JOIN ai_runtime.memory_states m USING(user_id,character_id,conversation_id)
 JOIN ai_runtime.chat_summary_states s ON s.parent_id=m.id
 CROSS JOIN LATERAL generate_series(greatest(s.version-10,0),s.version) v CROSS JOIN generate_series(1,4) n
 WHERE g.prompt_template_version='chat-summary-v2'
), exact AS (
 SELECT DISTINCT gid,user_id,source_key,source_id,kind,CASE WHEN kind='summary' THEN split_part(wire_key,':',3)::integer END summary_version FROM candidates c
 CROSS JOIN LATERAL (VALUES (wire_key),
 (CASE WHEN wire_key ~ ':(reply|reply-blind|guard|names)$' THEN regexp_replace(wire_key,':(reply|reply-blind|guard|names)$',':chatfallback-'||c.model_key||':\1')
       ELSE 'chatfallback:'||wire_key||':'||c.model_key END)) keys(value)
 WHERE c.key_hash=encode(sha256(convert_to(c.user_id::text,'UTF8')||decode('00','hex')||convert_to(keys.value,'UTF8')),'hex')
)
SELECT gid,user_id,pg_temp.model_task_key(user_id,source_key) task_key,source_id,kind,summary_version FROM exact;
CREATE UNIQUE INDEX ON task_0168_matches(gid);
UPDATE model_access.usage_records u SET task_key=m.task_key FROM task_0168_matches m WHERE u.task_key=m.gid AND u.user_id=m.user_id;

-- 消息用量外键比生成缓存保留得久。没有归属歧义时，用消息键恢复整个原生成的尝试。
WITH known AS (
 SELECT DISTINCT u.task_key old_key,u.user_id,pg_temp.model_task_key(u.user_id,'reply:'||p.id::text) new_key
 FROM chat.messages msg JOIN model_access.usage_records u ON u.id=msg.usage_record_id AND u.conversation_id=msg.conversation_id
 JOIN ai_runtime.reply_plans p ON p.user_id=u.user_id AND p.conversation_id=u.conversation_id AND p.character_id=u.character_id
 AND msg.client_msg_id LIKE 'reply:'||p.trigger_id::text||':%' WHERE msg.sender_kind='character' AND u.purpose='chat_reply'
 UNION
 SELECT DISTINCT u.task_key,u.user_id,pg_temp.model_task_key(u.user_id,'proactive:'||p.id::text)
 FROM ai_runtime.proactive_plans p JOIN chat.messages msg ON msg.id=p.message_id AND msg.sender_kind='character'
 JOIN model_access.usage_records u ON u.id=msg.usage_record_id AND u.user_id=p.user_id AND u.character_id=p.character_id AND u.purpose='proactive'
), unique_match AS (
 SELECT old_key,user_id,(array_agg(new_key))[1] new_key FROM known GROUP BY old_key,user_id HAVING count(DISTINCT new_key)=1
)
UPDATE model_access.usage_records u SET task_key=m.new_key FROM unique_match m
 WHERE u.user_id=m.user_id AND u.task_key=m.old_key AND m.new_key<>m.old_key;

WITH facts AS (
 SELECT u.task_key,u.user_id,u.purpose,'delivered' state,u.id usage_id,msg.created_at at
 FROM chat.messages msg JOIN model_access.usage_records u ON u.id=msg.usage_record_id AND u.conversation_id=msg.conversation_id
 JOIN chat.conversations c ON c.id=msg.conversation_id AND c.owner_user_id=u.user_id
 WHERE u.purpose IN ('chat_reply','proactive') AND u.status='succeeded' AND msg.sender_kind='character'
 UNION ALL
 SELECT m.task_key,m.user_id,u.purpose,'displayed',u.id,r.finished_at
 FROM task_0168_matches m JOIN model_access.generation_attempts a ON a.generation_id=m.gid
 JOIN model_access.usage_records u ON u.id=a.usage_record_id AND u.status='succeeded'
 JOIN ai_runtime.ecology_runs r ON r.id=m.source_id AND r.user_id=m.user_id
 WHERE m.kind='murmur' AND r.murmur_ciphertext IS NOT NULL AND r.finished_at IS NOT NULL
), latest AS (
 SELECT DISTINCT ON(task_key) * FROM facts WHERE task_key IS NOT NULL ORDER BY task_key,at DESC,usage_id DESC
)
INSERT INTO model_access.task_outcomes(task_key,user_id,purpose,state,usage_record_id,created_at,updated_at)
 SELECT f.task_key,f.user_id,f.purpose,f.state,f.usage_id,
    (SELECT min(u.created_at) FROM model_access.usage_records u WHERE u.task_key=f.task_key), f.at FROM latest f;
-- 计划的明确终态、摘要版本和当前重试证据。旧摘要版本未持有采用的 usage ID，不猜哪次成功产生了它。
WITH history AS (
  SELECT m.task_key,m.user_id,u.purpose,
    CASE WHEN m.kind='summary' AND v.id IS NOT NULL THEN 'saved'
         WHEN m.kind='summary' AND st.version=m.summary_version AND st.retry_after IS NOT NULL THEN 'deferred'
         WHEN m.kind='reply' AND rp.status='cancelled' AND rp.next_bubble=0 THEN CASE WHEN rp.failure IS NULL THEN 'cancelled' ELSE 'failed' END
         WHEN m.kind='proactive' AND pp.status='dropped' THEN 'cancelled'
         WHEN m.kind='proactive' AND pp.status='sent' AND pp.message_id IS NOT NULL AND msg.sender_kind='character' THEN 'delivered' END state,
    CASE WHEN m.kind='summary' THEN COALESCE(v.created_at,st.updated_at)
         WHEN m.kind='proactive' THEN pp.updated_at ELSE u.completed_at END updated,
    CASE WHEN m.kind='summary' AND v.id IS NULL AND st.version=m.summary_version THEN st.retry_after END retry_at
  FROM task_0168_matches m JOIN model_access.usage_records u ON u.task_key=m.task_key AND u.user_id=m.user_id
  LEFT JOIN ai_runtime.chat_summary_states st ON st.id=m.source_id AND m.kind='summary'
  LEFT JOIN ai_runtime.chat_summary_versions v ON v.state_id=st.id AND v.version=m.summary_version+1
  LEFT JOIN ai_runtime.reply_plans rp ON rp.id=m.source_id AND m.kind='reply' AND rp.user_id=u.user_id
  LEFT JOIN ai_runtime.proactive_plans pp ON pp.id=m.source_id AND m.kind='proactive' AND pp.user_id=u.user_id
  LEFT JOIN chat.messages msg ON msg.id=pp.message_id AND msg.conversation_id=u.conversation_id
), confirmed AS (
  SELECT DISTINCT ON(task_key) * FROM history WHERE state IS NOT NULL AND updated IS NOT NULL ORDER BY task_key,updated DESC
)
INSERT INTO model_access.task_outcomes(task_key,user_id,purpose,state,retry_at,created_at,updated_at)
  SELECT t.task_key,t.user_id,t.purpose,t.state,t.retry_at,(SELECT min(created_at) FROM model_access.usage_records u WHERE u.task_key=t.task_key), t.updated
  FROM confirmed t ON CONFLICT(task_key) DO NOTHING;
DROP FUNCTION pg_temp.model_task_key(uuid,text);
