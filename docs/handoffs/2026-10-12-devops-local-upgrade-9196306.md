# 交接说明：本机部署升级到主干 9196306

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 日期 | 2026-10-12 |

## 做了什么

- 升级前回滚标签：`weiban-app:rollback-6632814`、`weiban-edge:rollback-6632814`。
- 加密备份（age，格式 2）：`C:\wb-local\backups\20261012-225236-94b47278b47740bb9a10f56246f9eb02`。加 BOM 后的 `Backup-Weiban.ps1` 已可在 Windows PowerShell 5.1 直接运行，无需绕过。
- 在 `C:\wb-dev\wb-int`（local/trunk，919630610d1c8fdaadcebf98d4f93f3124b21d99）构建并 `up -d --wait`；迁移输出「没有需要执行的迁移」，最新仍为 0083。账号、数据卷、密钥保留；未创建模型/供应商，未调用 AI。
- 冒烟：两端 `/health`、首页与主脚本、管理员登录（app/admin）、`/api/v1/me` 刷新、退出均 ok；浏览器打开 8080 注册页显示「微伴号 / 密码 / 邀请码（选填）」。
- 更新 `C:\wb-local\deployment-version.txt`（应用镜像 sha256:3a76864a91112199fcdd95494f7840973295538e7a8682e0c4f123ed688a6a06）；旧记录另存 `C:\wb-local\deployment-history\pre-trunk-9196306-20261012.json`。

日志（仓库外 `C:\wb-dev\closeout-logs`）：`trunk-9196306-pre-upgrade-backup-round1.log`、`trunk-9196306-local-upgrade-round1.log`、`trunk-9196306-local-login-round1.log`。

## 改了哪些文件

- 仓库内：仅本交接说明。未改代码。
- 仓库外：部署版本记录、历史记录、新备份目录。

## 遗留问题

- 未实际提交注册（不在本机生产库造测试账号），密码 8 位校验与无邀请码注册的端到端行为未在本机部署上验证。
- 未跑测试套件，未对本次备份做恢复演练。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给项目总负责人：本机已是 9196306。回滚：把 `C:\wb-local\runtime.env` 的 `APP_IMAGE/EDGE_IMAGE` 指向 rollback-6632814 标签后 `up -d`（本次无迁移，无需回退数据）。
