-- 0156 回滚：删掉「不再发给模型」的登记表。回滚后这些消息重新进入模型上下文（可能再次被上游拦截）；
-- 回滚本迁移前须先回滚 T-20261103j 的代码（新代码会读写这张表）。
DROP TABLE IF EXISTS ai_runtime.model_blocked_messages;
