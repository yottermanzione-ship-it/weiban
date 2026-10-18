-- 香港服务器「临时验证库」首次初始化（只在数据卷为空、第一次启动时执行一次）。
-- 用途：部署前跑迁移脚本和需要真实 PostgreSQL 的集成测试。
-- 边界：与生产库 weiban 完全分离；表结构由 apps/server/drizzle 的迁移建立，不在这里写。
-- 登记与清理：docs/ops/hk-dryrun-db.md

-- 1. 验证库开启 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 集成测试专用库（测试会删表重建，可随意清空）
CREATE DATABASE weiban_dryrun_test;
\connect weiban_dryrun_test
CREATE EXTENSION IF NOT EXISTS vector;
