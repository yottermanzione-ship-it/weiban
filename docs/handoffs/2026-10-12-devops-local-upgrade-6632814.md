# 交接说明：本机部署升级到主干 6632814

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 日期 | 2026-10-12 |

## 做了什么

- 本机 Docker Desktop 原先未运行（8080/8081 不可用），启动后原部署自动恢复。
- 升级前给原镜像打回滚标签 `weiban-app:rollback-f8d5673`、`weiban-edge:rollback-f8d5673`。
- 加密备份（age，格式 2）：`C:\wb-local\backups\20261012-223445-783e6794bb2f4355a919ecd6e1f2e1a8`。
- 在 `C:\wb-dev\wb-int`（local/trunk，HEAD 66328143a1512efdefa8996a3cb175bd86596085，工作区干净）构建并 `up -d --wait`；迁移新执行 0082、0083，`schema_migrations` 最新为 0083。数据卷 `weiban-local_pgdata/media/caddy_*` 原样保留，密钥与账号未动；未创建模型/供应商，未调用 AI。
- 冒烟：两端 `/health`、首页及主脚本、管理员登录（app/admin 两种会话）、`/api/v1/me` 刷新、退出全部 ok。
- 更新 `C:\wb-local\deployment-version.txt`；旧记录另存 `C:\wb-local\deployment-history\pre-trunk-6632814-20261012.json`。

日志（仓库外）：`C:\wb-dev\closeout-logs\trunk-6632814-pre-upgrade-backup-round2.log`、`trunk-6632814-local-upgrade-round1.log`、`trunk-6632814-local-login-round1.log`。round1 备份日志是一次失败尝试（见遗留问题），生成的空目录已删除。

## 改了哪些文件

- 仓库内：仅本交接说明。未改代码。
- 仓库外：`C:\wb-local\deployment-version.txt`、`C:\wb-local\deployment-history\pre-trunk-6632814-20261012.json`、新备份目录。

## 遗留问题

- `deploy/local/*.ps1` 是无 BOM 的 UTF-8，本机只有 Windows PowerShell 5.1（无 pwsh 7），直接运行会因中文解析失败。本次以临时带 BOM 副本运行后删除。建议给这几个脚本加 BOM，或在 docs/ops/local-deploy.md 写明需 PowerShell 7。
- 在 PowerShell 5.1 中对脚本加 `*>&1` 重定向会把 docker 的普通提示当错误中断（脚本的 finally 会把应用重新拉起，不影响数据）。
- 本次只做基本冒烟，未跑测试套件、未做恢复演练（本备份未做解密恢复验证）。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给项目总负责人：本机已是 6632814；回滚办法为把 `C:\wb-local\runtime.env` 中 `APP_IMAGE/EDGE_IMAGE` 改为回滚标签后 `up -d`，若需回退数据用上述备份恢复（0082/0083 有 down 脚本）。
