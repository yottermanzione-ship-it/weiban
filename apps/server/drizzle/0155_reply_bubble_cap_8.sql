-- 0155：私聊回复条数放宽（T-20261103h，总经理 2026-11-03 调整）。
-- 产品参数 P-02 改为：文字气泡最多 6 条；加上表情包、照片、作品链接，以及「撤回」草稿、「打错字」更正
-- 这类小习惯多出来的条，总共最多 8 条（原为总共 4 条）。代码里的唯一定义处是
-- apps/server/src/platform/config/product-params.ts 的 P02_SPLIT_BUBBLES.maxTotalBubbles。
-- reply_plans.next_bubble 记「这次回复已经发出几条」，上限随总上限从 4 放宽到 8。
-- 只放宽约束，不动已有数据。约束名与 schema.ts 的 check 名一致（reply_plan_counters，0012 建表时生成），
-- trigger_seq、retry_epoch 两项条件原样保留。
ALTER TABLE ai_runtime.reply_plans DROP CONSTRAINT reply_plan_counters;
ALTER TABLE ai_runtime.reply_plans ADD CONSTRAINT reply_plan_counters CHECK (trigger_seq >= 0 AND trigger_seq <= 9007199254740991 AND next_bubble >= 0 AND next_bubble <= 8 AND retry_epoch >= 0);
