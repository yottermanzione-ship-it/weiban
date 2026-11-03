-- 0155 回滚：reply_plans.next_bubble 的上限收回 4（回到 0012 的约束）。
-- 放宽期间已经发到第 5 条以后的计划（next_bubble > 4）要先压回 4，否则加约束会失败：
-- - 还在发送中的（status = 'sending'）一并收尾为 done、清掉密文，剩下没发的不再发。
--   与 #48 对「已发到上限」计划的处理一致：旧代码见到 next_bubble ≥ 4 也是直接收尾、不再发。
--   记 done 而不是 cancelled：这次回复已经发出去了，回复上下文按 done 认为这条用户消息已回复过。
-- - 已经结束的（done / cancelled）只改计数，状态不动。
-- queued / generating / waiting 的 next_bubble 总是 0（重新排队要求还没发出任何一条），不受影响。
-- 注意：只回滚数据库、代码不回滚时，新代码仍会尝试写 next_bubble 5～8，会违反约束而作废计划；
-- 回滚本迁移前须先回滚 T-20261103h 的代码（P02_SPLIT_BUBBLES 回到 maxBubbles: 4）。
UPDATE ai_runtime.reply_plans
   SET next_bubble = 4,
       status = CASE WHEN status = 'sending' THEN 'done' ELSE status END,
       input_ciphertext = CASE WHEN status = 'sending' THEN NULL ELSE input_ciphertext END,
       result_ciphertext = CASE WHEN status = 'sending' THEN NULL ELSE result_ciphertext END
 WHERE next_bubble > 4;
ALTER TABLE ai_runtime.reply_plans DROP CONSTRAINT reply_plan_counters;
ALTER TABLE ai_runtime.reply_plans ADD CONSTRAINT reply_plan_counters CHECK (trigger_seq >= 0 AND trigger_seq <= 9007199254740991 AND next_bubble >= 0 AND next_bubble <= 4 AND retry_epoch >= 0);
