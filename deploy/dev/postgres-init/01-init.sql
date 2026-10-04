-- 本机开发数据库首次初始化（仅在数据卷为空、第一次启动容器时执行一次）。
-- 维护：运维负责人。表结构不在这里建，由服务器的 Drizzle 迁移负责（apps/server/drizzle/）。

-- 1. 开发库开启 pgvector 扩展（向量检索，ADR-0003）
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 集成测试专用库：测试可以随意清空，不影响开发库里的数据
CREATE DATABASE weiban_test;
\connect weiban_test
CREATE EXTENSION IF NOT EXISTS vector;
