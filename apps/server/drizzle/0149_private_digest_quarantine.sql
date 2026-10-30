-- 旧私密切出概括保留内容和ID，只纠正已确认的来源范围。
-- 发布时必须先停旧 worker，再执行本迁移，避免旧进程再次生成 normal 概括。
UPDATE ai_runtime.memories m SET scope='adult'
WHERE m.scope='normal' AND EXISTS (
 SELECT 1 FROM ai_runtime.private_digests d
 WHERE d.memory_id=m.id AND d.user_id=m.user_id
 AND d.character_id=m.character_id AND d.conversation_id=m.conversation_id
);

-- 让旧冻结块和旧模型响应不能在升级后复活日常范围的私密资料。
UPDATE ai_runtime.memory_states s
SET revision=revision+1,window_block_ciphertext=NULL
WHERE EXISTS (
 SELECT 1 FROM ai_runtime.private_digests d
 WHERE d.memory_id IS NOT NULL AND d.user_id=s.user_id
 AND d.character_id=s.character_id AND d.conversation_id=s.conversation_id
);
UPDATE ai_runtime.reply_plans p
SET status=CASE WHEN next_bubble>0 THEN 'cancelled' ELSE 'queued' END,
 input_ciphertext=NULL,result_ciphertext=NULL,lease_id=NULL,lease_until=NULL,
 retry_epoch=retry_epoch+1,due_at=now()
WHERE p.status IN ('queued','generating','waiting','sending') AND EXISTS (
 SELECT 1 FROM ai_runtime.private_digests d
 WHERE d.memory_id IS NOT NULL AND d.user_id=p.user_id
 AND d.character_id=p.character_id AND d.conversation_id=p.conversation_id
);
-- 群计划的加密上下文没有可明文筛选的 character_id，按受影响用户保守作废。
UPDATE ai_runtime.group_reply_plans p
SET status=CASE WHEN next_ordinal>0 THEN 'cancelled' ELSE 'queued' END,
 plan_ciphertext=NULL,input_ciphertext=NULL,result_ciphertext=NULL,
 lease_id=NULL,lease_until=NULL,retry_epoch=retry_epoch+1,updated_at=now()
WHERE p.status IN ('queued','generating','waiting') AND EXISTS (
 SELECT 1 FROM ai_runtime.private_digests d
 WHERE d.memory_id IS NOT NULL AND d.user_id=p.user_id
);
UPDATE ai_runtime.group_memory_states s
SET prepared_ciphertext=NULL,result_ciphertext=NULL,generation=generation+1,
 lease_id=NULL,lease_until=NULL,retry_after=NULL
WHERE EXISTS (
 SELECT 1 FROM ai_runtime.private_digests d
 WHERE d.memory_id IS NOT NULL AND d.user_id=s.user_id
);
