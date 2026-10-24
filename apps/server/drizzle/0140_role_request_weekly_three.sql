-- 会员 v6（2026-10-25）：角色制作的 PRO+ 权益由「终身 3 次 + 每周 2 次」改成「每周 3 次」。
-- 线上若已存过旧配置（proPlusWeeklyFreeCount 还停在旧默认 2），会盖住契约里新的默认值 3，
-- 所以这里只把这一项改成 3；enabled / pointsCost / maxOpenPerUser / lifetimeFreeCount 一律不动。
-- 没存过配置（没有这一行）时不插行：服务器 DEFAULT_CONFIG 的 proPlusWeeklyFreeCount 已经是 3。
UPDATE plaza.settings
   SET value = jsonb_set(value, '{proPlusWeeklyFreeCount}', '3'::jsonb, true),
       updated_at = now()
 WHERE key = 'role_request_config'
   AND jsonb_typeof(value) = 'object';
