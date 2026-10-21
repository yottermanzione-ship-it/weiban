-- 回滚 0129：删除切出私密模式的整理任务表（已写入的「私密模式期间整理」记忆是普通记忆，保留）。
DROP TABLE IF EXISTS ai_runtime.private_digests;
