-- Q028：历史改名审计曾复制旧/新账号名，注销只替换用户编号时会留下明文。
-- 只去掉这一个动作的两项账号名；保留事件、时间、操作人/对象及其余审计细节。
-- 覆盖已注销、已匿名化和仍活跃的账号，不需要读取或输出账号名。
UPDATE platform.audit_log
SET details = details - ARRAY['previous', 'username']
WHERE module = 'identity' AND action = 'alias.updated'
  AND details ?| ARRAY['previous', 'username'];
