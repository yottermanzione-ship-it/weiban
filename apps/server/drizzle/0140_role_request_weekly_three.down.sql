-- 回滚 0140：只把仍停在这次写入值（3）的配置退回旧默认 2。
-- 管理员手工调成别的值（例如 5）时不动，避免回滚误改人工配置；没存过配置时不动。
UPDATE plaza.settings
   SET value = jsonb_set(value, '{proPlusWeeklyFreeCount}', '2'::jsonb, true),
       updated_at = now()
 WHERE key = 'role_request_config'
   AND jsonb_typeof(value) = 'object'
   AND value->>'proPlusWeeklyFreeCount' = '3';
