-- Read-only, aggregate-only closeout probe. No chat, audio, prompts, identifiers or credentials.
-- Window starts at the actual realtime usage/pricing fix release, not at this audit.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT json_build_object('kind','voice-by-model','model',model_key,'status',status,
  'records',count(*),'known',bool_and(cost_known),'estimated',bool_or(estimated),
  'audioRecords',count(*) FILTER (WHERE coalesce((media_units->>'audioOutputTokens')::numeric,0)>0),
  'cloneRecords',count(*) FILTER (WHERE coalesce((media_units->>'voiceClones')::numeric,0)>0),
  'ttsRecords',count(*) FILTER (WHERE coalesce((media_units->>'ttsChars')::numeric,0)>0),
  'chargedMicros',sum(charged_micros),'ledgerRecords',count(ledger_entry_id))
FROM model_access.usage_records
WHERE created_at >= '2026-11-07T11:22:25Z'::timestamptz AND purpose='voice'
GROUP BY model_key,status;

-- Independently reproduce integer-microyuan pricing from the frozen version and discount.
-- Time-band rows and absent prices are explicitly excluded, never silently treated as verified.
WITH base AS (
  SELECT u.id,u.model_key,u.upstream_model_id,u.input_tokens,u.cached_input_tokens,
    u.output_tokens,u.cache_write_5m_tokens,u.cache_write_1h_tokens,u.media_units,
    u.charged_micros,u.ledger_entry_id,u.hold_id,u.price_version_id,
    h.discount_bp,h.postpaid,h.settlement_snapshot,
    EXISTS(SELECT 1 FROM billing.price_items b WHERE b.price_version_id=u.price_version_id
      AND b.model_key=u.model_key AND b.band IS NOT NULL) AS has_time_band
  FROM model_access.usage_records u LEFT JOIN billing.holds h ON h.id=u.hold_id
  WHERE u.created_at >= '2026-11-07T11:22:25Z'::timestamptz AND u.purpose='voice'
    AND u.status='succeeded' AND u.cost_known AND NOT u.estimated
), quantities AS (
  SELECT b.*,q.unit,q.amount,q.factor FROM base b CROSS JOIN LATERAL (VALUES
    ('input_tokens_per_million',b.input_tokens::numeric,3),
    ('cached_input_tokens_per_million',b.cached_input_tokens::numeric,3),
    ('cache_write_5m_tokens_per_million',b.cache_write_5m_tokens::numeric,3),
    ('cache_write_1h_tokens_per_million',b.cache_write_1h_tokens::numeric,3),
    ('output_tokens_per_million',CASE WHEN coalesce((b.media_units->>'audioOutputTokens')::numeric,0)>0
      AND (b.upstream_model_id ~ '^qwen3\.5-omni-.*-realtime(-|$)'
        OR b.upstream_model_id ~ '^qwen-audio-3\.[01]-realtime-(plus|flash)(-|$)')
      THEN 0 ELSE b.output_tokens END::numeric,3),
    ('audio_input_tokens_per_million',coalesce((b.media_units->>'audioInputTokens')::numeric,0),3),
    ('audio_output_tokens_per_million',coalesce((b.media_units->>'audioOutputTokens')::numeric,0),3),
    ('tts_10k_chars',coalesce((b.media_units->>'ttsChars')::numeric,0),300),
    ('asr_minute',coalesce((b.media_units->>'asrSeconds')::numeric,0),50000),
    ('realtime_minute',coalesce((b.media_units->>'realtimeSeconds')::numeric,0),50000),
    ('voice_clone',coalesce((b.media_units->>'voiceClones')::numeric,0),3000000),
    ('image',coalesce((b.media_units->>'images')::numeric,0),3000000),
    ('search_call',coalesce((b.media_units->>'searchCalls')::numeric,0),3000000)
  ) q(unit,amount,factor)
), priced AS (
  SELECT q.*,coalesce(p.price_micros,f.price_micros) AS rate
  FROM quantities q
  LEFT JOIN billing.price_items p ON p.price_version_id=q.price_version_id
    AND p.model_key=q.model_key AND p.unit=q.unit AND p.band IS NULL
  LEFT JOIN billing.price_items f ON f.price_version_id=q.price_version_id
    AND f.model_key=q.model_key AND f.unit='input_tokens_per_million' AND f.band IS NULL
    AND q.unit IN ('cached_input_tokens_per_million','cache_write_5m_tokens_per_million','cache_write_1h_tokens_per_million')
), per_record AS (
  SELECT id,model_key,bool_or(has_time_band) AS has_time_band,
    count(*) FILTER (WHERE amount>0 AND rate IS NULL) AS missing_rates,
    ceil(ceil(sum(ceil(amount)*coalesce(rate,0)*factor)/3000000)
      *least(10000,greatest(1,max(discount_bp)))/10000) AS expected_micros
  FROM priced GROUP BY id,model_key
)
SELECT json_build_object('kind','frozen-price-ledger-reconciliation','records',count(*),
  'excludedTimeBand',count(*) FILTER (WHERE p.has_time_band),
  'excludedMissingRate',count(*) FILTER (WHERE p.missing_rates>0),
  'postpaid',count(*) FILTER (WHERE b.postpaid),
  'missingHold',count(*) FILTER (WHERE b.discount_bp IS NULL),
  'verifiedExactPrice',count(*) FILTER (WHERE NOT p.has_time_band AND p.missing_rates=0 AND b.discount_bp IS NOT NULL AND p.expected_micros=b.charged_micros),
  'differentFromFullPrice',count(*) FILTER (WHERE NOT p.has_time_band AND p.missing_rates=0 AND b.discount_bp IS NOT NULL AND p.expected_micros<>b.charged_micros),
  'ledgerMissingOrDifferent',count(*) FILTER (WHERE l.id IS NULL OR l.type<>'charge' OR l.usage_record_id<>b.id OR l.hold_id<>b.hold_id OR -l.amount_micros<>b.charged_micros OR l.price_version_id<>b.price_version_id),
  'settlementSnapshotDifferent',count(*) FILTER (WHERE (b.settlement_snapshot->>'amountMicros')::numeric IS DISTINCT FROM b.charged_micros),
  'chargedMicros',sum(b.charged_micros),'expectedMicros',sum(p.expected_micros))
FROM per_record p JOIN base b ON b.id=p.id LEFT JOIN billing.ledger_entries l ON l.id=b.ledger_entry_id;

SELECT json_build_object('kind','memory-by-template','template',prompt_template_version,
  'model',model_key,'status',status,'records',count(*))
FROM model_access.usage_records WHERE created_at >= '2026-11-07T11:22:25Z'::timestamptz AND purpose='memory'
GROUP BY prompt_template_version,model_key,status;
SELECT json_build_object('kind','memory-progress','states',count(*),
  'pending',count(*) FILTER (WHERE pending_count>0),'retryPending',count(*) FILTER (WHERE retry_after IS NOT NULL),
  'failedAttempts',count(*) FILTER (WHERE fact_attempts>0)) FROM ai_runtime.memory_states;
SELECT json_build_object('kind','summary-progress','states',count(*),
  'pending',count(*) FILTER (WHERE target_seq>covered_seq),'retryPending',count(*) FILTER (WHERE retry_after IS NOT NULL),
  'failedAttempts',count(*) FILTER (WHERE attempts>0),'expiredLease',count(*) FILTER (WHERE lease_until<now()))
FROM ai_runtime.chat_summary_states;
SELECT json_build_object('kind','chat-cache','records',count(*),'reportedHitRecords',count(*) FILTER (WHERE cached_input_tokens>0),
  'inputTokens',sum(input_tokens),'cachedInputTokens',sum(cached_input_tokens),'estimated',count(*) FILTER (WHERE estimated))
FROM model_access.usage_records WHERE created_at >= '2026-11-07T11:22:25Z'::timestamptz AND purpose='chat_reply' AND status='succeeded';
SELECT json_build_object('kind','upstream-bills-in-window','records',count(*)) FROM billing.upstream_bills WHERE period_end >= '2026-11-07';

-- Match the exact persisted logical call-memory key, without opening the encrypted input/result.
-- Each piece is 12,000 characters, at most 200,000; include the old no-offset key as well.
WITH job_keys AS (
  SELECT j.id,j.user_id,j.status,'call-memory:'||j.id::text||s.suffix AS logical_key
  FROM ai_runtime.call_memory_jobs j CROSS JOIN (
    SELECT '' AS suffix UNION ALL SELECT ':'||n::text FROM generate_series(0,192000,12000) n
  ) s
), primary_failures AS (
  SELECT f.id AS failure_id,k.id AS job_id,k.user_id,k.status,k.logical_key
  FROM job_keys k JOIN model_access.generation_results g ON g.user_id=k.user_id
    AND g.key_hash=encode(sha256(convert_to(k.user_id::text,'UTF8')||decode('00','hex')||convert_to(k.logical_key,'UTF8')),'hex')
  JOIN model_access.usage_records f ON f.id=g.usage_record_id
    AND f.purpose='memory' AND f.prompt_template_version='call-memory-v1' AND f.status='failed'
    AND f.created_at >= '2026-11-07T11:22:25Z'::timestamptz
), linked AS (
  SELECT DISTINCT f.failure_id,f.job_id,f.status
  FROM primary_failures f JOIN model_access.usage_records s ON s.user_id=f.user_id
    AND s.purpose='memory' AND s.prompt_template_version='call-memory-v1' AND s.status='succeeded'
    AND s.created_at >= '2026-11-07T11:22:25Z'::timestamptz
  JOIN model_access.generation_results g ON g.usage_record_id=s.id
    AND g.key_hash=encode(sha256(convert_to(f.user_id::text,'UTF8')||decode('00','hex')||convert_to('chatfallback:'||f.logical_key||':'||s.model_key,'UTF8')),'hex')
)
SELECT json_build_object('kind','exact-call-memory-fallback-link',
  'failedRecords',(SELECT count(*) FROM model_access.usage_records WHERE created_at >= '2026-11-07T11:22:25Z'::timestamptz AND purpose='memory' AND prompt_template_version='call-memory-v1' AND status='failed'),
  'matchedPrimaryFailures',(SELECT count(DISTINCT failure_id) FROM primary_failures),
  'matchedFallbackSuccesses',count(DISTINCT failure_id),'completedJobs',count(DISTINCT job_id) FILTER (WHERE status='done'),
  'cancelledJobs',count(DISTINCT job_id) FILTER (WHERE status='cancelled')) FROM linked;
SELECT json_build_object('kind','call-memory-job-status','status',status,'records',count(*))
FROM ai_runtime.call_memory_jobs WHERE created_at >= '2026-11-07T11:22:25Z'::timestamptz GROUP BY status;
SELECT json_build_object('kind','recent-cancelled-call-memory-current-fences','records',count(*),
  'revisionChanged',count(*) FILTER (WHERE coalesce(m.revision,0)<>j.revision),
  'contactInactiveOrAbsent',count(*) FILTER (WHERE c.status IS DISTINCT FROM 'active'),
  'sourceCallAbsent',count(*) FILTER (WHERE s.id IS NULL))
FROM ai_runtime.call_memory_jobs j
LEFT JOIN ai_runtime.memory_states m ON m.user_id=j.user_id AND m.character_id=j.character_id AND m.conversation_id=j.conversation_id
LEFT JOIN contacts.contacts c ON c.user_id=j.user_id AND c.character_id=j.character_id
LEFT JOIN calls.call_sessions s ON s.id=j.id
WHERE j.created_at >= '2026-11-07T11:22:25Z'::timestamptz AND j.status='cancelled';
SELECT json_build_object('kind','summary-pending-age',
  'pendingRetryInFuture',count(*) FILTER (WHERE target_seq>covered_seq AND retry_after>now()),
  'pendingRetryOverdue',count(*) FILTER (WHERE target_seq>covered_seq AND retry_after<=now()),
  'pendingUpdatedBeforeUsageFix',count(*) FILTER (WHERE target_seq>covered_seq AND updated_at<'2026-11-07T11:22:25Z'::timestamptz))
FROM ai_runtime.chat_summary_states;

-- Official Beijing list prices for three models; cached input remains the existing full-input
-- reference rate (separate from the official published non-cached token/clone prices).
WITH expected AS (
  SELECT m.model,u.unit,(u.price*1000000)::bigint AS price FROM
    (VALUES ('qwen3.8-omni-flash-realtime',1.5,6,4.5,12,0.01),
      ('qwen3.5-omni-plus-realtime',10,80,60,300,0.01),
      ('qwen-audio-3.1-realtime-plus',5,40,40,150,NULL)) m(model,ti,ai,ot,oa,clone)
    CROSS JOIN LATERAL (VALUES ('input_tokens_per_million',m.ti),('cached_input_tokens_per_million',m.ti),
      ('output_tokens_per_million',m.ot),('audio_input_tokens_per_million',m.ai),
      ('audio_output_tokens_per_million',m.oa),('voice_clone',m.clone)) u(unit,price)
  WHERE u.price IS NOT NULL
), actual AS (
  SELECT m.upstream_model_id AS model,p.unit,p.price_micros,p.band,u.kind,
    u.base_url LIKE 'https://dashscope.aliyuncs.com/%' AS beijing
  FROM billing.price_versions v JOIN billing.price_items p ON p.price_version_id=v.id
  JOIN model_access.model_catalog m ON m.model_key=p.model_key AND m.deleted_at IS NULL
  JOIN model_access.upstreams u ON u.id=m.upstream_id WHERE v.status='active'
)
SELECT json_build_object('kind','active-realtime-price-comparison','expectedItems',count(*),
  'matchingItems',count(*) FILTER (WHERE a.price_micros=e.price AND a.band IS NULL),
  'missingOrDifferent',count(*) FILTER (WHERE a.price_micros IS DISTINCT FROM e.price OR a.band IS NOT NULL),
  'beijingDashscopeItems',count(*) FILTER (WHERE a.beijing AND a.kind='dashscope'))
FROM expected e LEFT JOIN actual a ON a.model=e.model AND a.unit=e.unit;
ROLLBACK;
