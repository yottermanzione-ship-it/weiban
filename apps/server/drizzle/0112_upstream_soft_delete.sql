-- 10-20 批 E1：上游账号可删除（软删）。删除后密钥密文清空、不再参与调度；行保留，历史调用记录仍能显示账号名。
ALTER TABLE model_access.upstreams ADD COLUMN deleted_at timestamptz;
