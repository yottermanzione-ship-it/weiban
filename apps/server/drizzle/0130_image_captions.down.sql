-- 回滚 0130：删除图片描述存档表（之后图片在历史里回到「之前发过一张图片」）。
DROP TABLE IF EXISTS ai_runtime.image_captions;
