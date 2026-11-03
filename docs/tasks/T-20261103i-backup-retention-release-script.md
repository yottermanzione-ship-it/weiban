# T-20261103i 备份与版本保留按总经理口径收紧，手工发版脚本入库

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead（第 3 项契约部分由 backend 和 web 配合，本任务一人完成） |
| 分支 | `ops/backup-retention-release-script-20261103`（worktree `C:\wb-dev\wb-t1103i`） |
| 状态 | 待派发 |
| 来源 | 总经理 2026-11-03 对备份的三点要求；T-20261103f（PR #50）交接遗留 1、2 |
| 必读 | `docs/handoffs/2026-11-03-hk-disk-safety.md`、`deploy/hk/backup.sh`、`deploy/hk/release-prune.sh`、`deploy/hk/ops-lib.sh`、`docs/ops/hk-server.md` 第六节、`docs/ops/reference/manual-release-20261103.sh`（总负责人目前在服务器上用的手工发版脚本，原样存档，供参考） |

## 总经理的三点要求（2026-11-03）

1. **备份次数要少**：每天 04:00 的定时备份照常。发版前**只有这次发版包含数据库迁移**时才额外备份；不含迁移时，用最近一份定时备份（要求 24 小时内有一份完整备份，没有就照常备份）。备份期间要停服两三分钟，这也是要少备份的原因。
2. **备份放系统盘**：沿用 #50 的 `/var/backups/weiban`，数据盘只放程序和数据。
3. **保留口径**：
   - 程序版本：只留**当前版本和最近 2 个可回退版本**，包括镜像和 `/srv/weiban/releases` 目录，多的删掉。#50 只留了 1 个回退版本，要改成 2 个。
   - 备份：最多 2 份，而且**合计不超过 10G**，超了先删最早的。只有一份也超过 10G 时保留它，并发严重告警。

## 要求

1. 改 `release-prune.sh`：保留当前版本加 2 个回退版本，回退版本按部署时间排序，可以从 `deployment-version.txt` 的历史或 `before-*` 标签推断，方法由你定。
2. 改 `backup.sh`：保留规则在 `KEEP=2` 之外加 10G 合计上限，阈值做成可配置的常量。
3. **手工发版脚本入库**：参照 `docs/ops/reference/manual-release-20261103.sh`，写成 `deploy/hk/release.sh <commit>`。步骤保持现有布局：
   - 解压到 `releases/<sha>`；
   - 构建；
   - 按第 1 点决定是否备份，判断「是否含迁移」可以比较新旧源码的 `apps/server/drizzle/meta/_journal.json`；
   - 打 `before-<短号>` 回滚标签；
   - 切换 `runtime.env` 和 `src` 软链接；
   - `up -d --wait`；
   - 写 `deployment-version.txt`，沿用现有字段；
   - 调用 `release-prune.sh`。

   上传方式（git archive、分片、校验）可以写成 `deploy/hk/upload-release.sh`，由开发机执行，也可以只写进文档，由你定。还要提供 `rollback.sh`，退回到上一版或上上一版。
4. **告警种类进契约**：#50 写进 `push.admin_alerts` 的 `host_disk_high`、`backup_failed`，在后台显示成 `unsupported`。按契约规则做次版本升级，在 `AdminAlertKind` 里加上这两种，后台补中文名「磁盘空间不足」「备份失败」。
   - 契约当前是 5.2。开工时如果别的分支已经升过版本，取 main 上的最新版本再加一。
   - 同步 version.ts、README 变更记录、版本断言、Android 生成产物（`pnpm android:generate`）。
5. **文档**：`docs/ops/hk-server.md` 写清新的保留口径和发版流程。

## 规矩

- 分支 → PR（base main）→ CI。不推 main、不合并、不部署。**不要 ssh**；服务器上的变更写进交接，由总负责人执行。
- 本机只跑一次相关检查，其余交给 CI。
- 交接写 `docs/handoffs/2026-11-03-backup-retention-release-script.md`，内容包括需要总负责人在服务器上按顺序执行的命令，并写明和 #50 交接第 3 节的步骤怎么衔接（#50 的服务器步骤还没执行，可以合并成一套）。
