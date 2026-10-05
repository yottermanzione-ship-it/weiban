-- 回滚 0004_model_access：删除 model_access schema（上游与加密密钥、模型目录、用户模型选择、用量记录）。
-- 注意：平台上游密钥（密文）、用户的模型选择和全部用量记录会丢失。只用于开发 / 测试库；生产环境回滚前必须先备份。
DROP SCHEMA IF EXISTS "model_access" CASCADE;
