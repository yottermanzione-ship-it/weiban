-- 10-20 模型可删除（契约 3.23）：模型软删。
-- 删除时把这一行的 model_key 改成「原键#deleted:<随机>」腾出原键（同键可以重新添加，主键不变），
-- 原键存 original_model_key，删除时间存 deleted_at；行保留给历史调用记录、用量、对账显示模型名。
-- 线路、用户场景配置、角色设置、推荐 / 内部模型、折扣、价目表里的引用由应用层在同一操作里清掉。
ALTER TABLE model_access.model_catalog ADD COLUMN deleted_at timestamptz;
ALTER TABLE model_access.model_catalog ADD COLUMN original_model_key text;
ALTER TABLE model_access.model_catalog ADD CONSTRAINT model_catalog_deleted_check
  CHECK ((deleted_at IS NULL) = (original_model_key IS NULL) AND (deleted_at IS NULL OR NOT enabled));
CREATE INDEX model_catalog_original_key_idx ON model_access.model_catalog (original_model_key)
  WHERE original_model_key IS NOT NULL;
