# 交接说明：T-20261103i 备份与版本保留收紧、发版脚本入库

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead（契约与后台中文名也由本人完成） |
| 日期 | 2026-11-03 |
| 分支 | `ops/backup-retention-release-script-20261103`（已合并 origin/main `5e0d9186`） |
| 任务卡 | `docs/tasks/T-20261103i-backup-retention-release-script.md` |
| 契约 | 5.2 → **5.3**（`AdminAlertKind` 加 `host_disk_high`、`backup_failed`）；`minClientVersion` 不动 |
| 迁移 | 无（最新仍是 0155） |
| 服务器 | 未登录、未改动；服务器上的步骤见第 3 节，由总负责人执行。**本节已和 #50 交接第 3 节合并成一套**，#50 那一节不用再单独执行 |

## 结论

1. **备份次数少了**：每天 04:00 照常。发版前只有「这次含数据库迁移」才额外备份；不含迁移时用 24 小时内的完整备份，没有才备份。判断方法：比较新旧版本的 `apps/server/drizzle/meta/_journal.json`。
2. **备份放系统盘**：沿用 #50 的 `/var/backups/weiban`，发版前备份也走同一个 `weiban-backup.service`。
3. **保留口径**：
   - 程序版本只留**当前 + 2 个可回退版本**，镜像和 `/srv/weiban/releases` 目录同一口径；`:hk` 每次改指当前版本，不再多留一份 11-02 的旧镜像；旧 `.tar` 源码包、失效的 `src.before-*` 软链接一并清掉。
   - 备份最多 2 份、**合计不超过 10G**，超了从最早的删起；只剩一份也超时保留它，后台登记「严重」提醒。
4. **发版脚本入库**：`deploy/hk/upload-release.sh`（开发机上传）、`deploy/hk/release.sh`（服务器发版）、`deploy/hk/rollback.sh`（退回上一版 / 上上一版）。以后发版就是两条命令，不再手写。
5. **后台不再显示 `unsupported`**：磁盘、备份提醒的「类型」列显示「磁盘空间不足」「备份失败」。

## 1. 做了什么（按任务卡 1–5）

### 1.1 发版后清理：当前 + 2（第 1 项）

`deploy/hk/release-prune.sh` 重写了「保留谁」：

- **按部署先后排版本**：新增发版历史 `/srv/weiban/release-state/history.tsv`，`release.sh`、`rollback.sh` 每次成功后追加一行（时间、动作、提交、源码树、两个镜像名和镜像 ID、源码目录）。同一提交以最后一次部署为准。好处：回滚后再发版，刚退回过的好版本排在前面，不会因为构建时间早被清掉（只看构建时间做不到）。
- **第一次没有历史时**：`release.sh` 切换前按 `deployment-version.txt`（`sourceCommit`、`previousSourceCommit`）和上次手工发版打的 `before-<短号>` 标签、`src.before-<短号>` 软链接，补记「当前版」和「上一版」两行。所以第一次用 `release.sh` 发完，历史里正好是第 7 波、第 8 波和新版本三个。
- **历史不够 2 个时**：镜像按构建时间、源码目录按修改时间补足（和 #50 的做法一样，只是从 1 个改成 2 个）。
- **镜像**：保留当前、2 个可回退版本、任何容器在用的；其余 `weiban-app` / `weiban-edge` 标签删除，再清悬空镜像。`:hk` 先改指当前版本，原来那份 11-02 镜像没有别的标签了，就被当成悬空镜像清掉。
- **源码目录**：保留当前、2 个可回退版本、被任何容器挂载的（例如 postgres 挂载的初始化脚本目录）；其余删除。`releases/` 下的 `.tar` / `.tgz` 文件名里带保留版本目录名（前 12 位）的留下，其余删除；别的类型的文件不碰。
- **`src.before-*` 软链接**：指向已删除或已不存在目录的删除（只删链接）；指向保留目录的留下；指向 `releases` 以外仍存在目录的不动（人工判断）。
- 去掉了 #50 的 `ROLLBACK_APP_IMAGE` / `ROLLBACK_EDGE_IMAGE`（发版历史已经知道上一版是谁）；旧命令里带着这两个变量也不会出错，只是不起作用。
- 不变的安全措施：当前镜像找不到就拒绝；从不 `-f`；`src` 不是软链接时跳过源码目录清理；不碰数据库、媒体卷、备份、其他仓库镜像、`src.old*`、`/var/lib/weiban/releases`；有 `--dry-run`。
- `rollback.sh --list` 列出的就是清理时保留的那 2 个版本，两边共用 `ops-lib.sh` 里同一个函数 `rollback_versions`，口径不会走样。

### 1.2 备份合计上限（第 2 项）

`deploy/hk/backup.sh` 在 `KEEP=2` 之后再按合计大小清理：所有完整备份（`weiban-*` 且有 `manifest.txt`）加起来超过 `BACKUP_MAX_TOTAL`（默认 `10G`，可写 `500M` 或字节数）就从最早的删起，最新这一份始终保留。只剩它一份也超过上限时：保留、登记「严重」提醒（合并键 `backup_over_cap:hk`，种类 `backup_failed`），**退出码仍是 0**（备份本身是好的，不挡发版）。上限写在 `weiban-backup.service` 的 `Environment=BACKUP_MAX_TOTAL=10G`，脚本里同名常量做默认值。格式写错时在停应用之前就失败退出。

### 1.3 发版脚本入库（第 3 项）

参照 `docs/ops/reference/manual-release-20261103.sh`（第 7 波）和第 8 波的改法（先构建、再备份、再切换），布局不变：

| 脚本 | 在哪跑 | 做什么 |
|---|---|---|
| `deploy/hk/upload-release.sh <提交>` | 开发机 Git Bash | 先跑只读闸门 `Assert-ReleaseSource.ps1`；`git archive` 打包，切 4MB 分片逐片上传、逐片核对 SHA256（断点续传，坏片最多重传一次）；服务器上合并后核对整包，写 `/tmp/rel-<提交>.meta`（提交号、源码树、SHA256、字节数），再放一份同版本的 `/tmp/rel-<提交>.release.sh`；最后打印服务器命令 |
| `deploy/hk/release.sh [--pr 号] [--note 说明] [--no-prune] [--force-backup] <完整提交号>` | 服务器 root | ① 检查、加锁 → ② 核对校验和后解压到 `releases/<提交>`（目录已在就直接用）→ ③ 检查数据盘至少 4G 可用，构建 `weiban-app:release-<提交>`、`weiban-edge:release-<提交>`（应用照常运行）→ ④ 按需备份（`systemctl start weiban-backup.service`）→ ⑤ 打 `before-<新短号>` 标签、留 `src.before-<新短号>`、存一份 `runtime.env` → ⑥ 切换 `runtime.env` 和 `src`（原子改名），`up -d --wait app caddy` → ⑦ 写 `deployment-version.txt`（字段沿用手工发版）和发版历史 → ⑧ 调用新版本的 `release-prune.sh` |
| `deploy/hk/rollback.sh --list \| [--dry-run] 1\|2\|<提交号>` | 服务器 root | 按发版历史退回上一版或上上一版：只切换镜像和源码，不删、不备份、不清理。先查数据库：已执行、但目标版本不认识的迁移会让旧版本的 migrate 拒绝启动，有就拒绝回滚，打印两种处理办法（用当前版本 `migrate.js down N`，或用备份恢复） |

几个设计点：

- `release.sh` 健康检查没过时：**不含迁移就自动退回**原版本（恢复 `runtime.env` 和 `src`，再 `up --wait`）；**含迁移不自动退**，因为旧版本的 migrate 认不得已执行的新迁移，自动退也起不来，屏幕上给出三种处理办法。
- 备份失败发版就停，这时还没切换，线上仍是原版本，新镜像已构建好，修好后重跑会直接用已解压的目录。
- 辅助函数（`ops-lib.sh`）和清理脚本都从**新版本目录**里取，所以从 `/tmp/rel-<提交>.release.sh` 或 `/srv/weiban/src/deploy/hk/release.sh` 运行效果一样；第一次（服务器上的当前版本还没有 `release.sh`）也不用特殊处理。
- 发版和回滚共用锁 `/run/lock/weiban-release.lock`，不会两个一起跑。没有拿备份锁：04:00 前后不要发版（和以前一样）。

### 1.4 告警种类进契约（第 4 项）

- `packages/contracts/src/http/push.ts`：`AdminAlertKind` 加 `host_disk_high`、`backup_failed`，注释写明发出方、级别、合并键、不推送。
- 契约 5.2 → 5.3：开工时确认 main 和所有远端分支都没升过 5.3。同步 `version.ts`、README 变更记录、版本断言（`service-unit-pricing.test.ts`）、新增一条契约测试（两种新种类按正式种类读出，不再是 `unsupported`）、`pnpm android:generate`（只有版本号两处变化，Kotlin 里 `AdminAlertKind` 是字符串别名）。
- 管理后台 `apps/admin/src/features/alerts.tsx`：`KIND_LABELS` 加「磁盘空间不足」「备份失败」。
- `docs/architecture/billing.md` 8.4 节提醒种类表补两行。
- 服务器端代码不用改：后端读这张表时种类是字符串，响应用接收端容错枚举。

### 1.5 文档（第 5 项）

`docs/ops/hk-server.md`：第三节备份次数与保留；第四节换成新的发版、回滚流程；第六节磁盘布局补 `release-state/`、备份保留表加合计上限和发版前备份两行、「发版后清理」改为「程序版本保留与发版后清理」（新口径、发版历史说明、保留表）、告警种类说明更新。另改 `docs/ops/ci.md`、`deploy/README.md`、CI 步骤名。

## 2. 改了哪些文件

- `deploy/hk/release.sh`、`deploy/hk/rollback.sh`、`deploy/hk/upload-release.sh`（新）
- `deploy/hk/release-prune.sh`（保留口径重写）、`deploy/hk/ops-lib.sh`（发版历史与公共小工具）、`deploy/hk/backup.sh`（合计上限）、`deploy/hk/weiban-backup.service`（`BACKUP_MAX_TOTAL=10G`）
- `.github/scripts/check-hk-ops.sh`（用例扩充）、`.github/workflows/ci.yml`（步骤名）
- `packages/contracts/src/http/push.ts`、`packages/contracts/src/version.ts`、`packages/contracts/README.md`、`packages/contracts/test/schemas.test.ts`、`packages/contracts/test/service-unit-pricing.test.ts`
- `apps/android/core/contracts-generated/…/Contracts.kt`、`…/contracts.json`（生成产物）
- `apps/admin/src/features/alerts.tsx`
- `docs/ops/hk-server.md`、`docs/ops/ci.md`、`deploy/README.md`、`docs/architecture/billing.md`
- 本交接

## 3. 服务器上要执行的命令（总负责人按顺序执行，root）

和 #50 交接第 3 节的对应关系：#50 第 0 步已做过（drop-in 在用）；#50 第 1 步 = 本节第 1 步；#50 第 2 步 = 本节第 2 步；**#50 第 3 步（把数据盘上的备份搬到系统盘）不做了**：`/var/backups/weiban` 里已经有第 8 波发版前备份和之后的每日备份，数据盘那两份 11-03 的更旧，按「最多 2 份」是多余的，在第 6 步删除；#50 第 4、5 步 = 本节第 4、5 步；#50 第 6 步（改手工发版脚本）由 `release.sh` 取代；#50 第 7 步 = 本节第 6 步。

**会停服的步骤**：第 1.2 步（`up` 重建 app 和 caddy，十几秒；只有含迁移或 24 小时内没有完整备份时才另外备份，停两三分钟）、第 5.3 步（可选的真实备份，两三分钟）。其余都不停服。

**会删除东西的步骤**：第 3 步（旧镜像标签、旧源码目录与源码包、失效软链接、24 小时前的构建缓存）、第 6 步（旧备份）。第 4 步只删一个配置文件（drop-in），不删数据。

### 第 1 步：合并后发版（第一次用新脚本）

1.1 开发机，在干净的 main 整合副本里（Git Bash）：

```bash
git fetch origin && git checkout main && git merge --ff-only origin/main
bash deploy/hk/upload-release.sh main
```

1.2 服务器，照 1.1 最后打印的命令执行，**第一次加 `--no-prune`**（清理放到第 3 步先演练再做）：

```bash
cat /srv/weiban/deployment-version.txt                 # 先看一眼：应是第 8 波 5e0d9186，previousSourceCommit 是第 7 波
docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep '^weiban-'   # 应有 before-5e0d9186
bash /tmp/rel-<完整提交号>.release.sh --no-prune --pr <PR号> --note '<一句话说明>' <完整提交号>
```

预期输出里有「发版历史还没有，已按现状补记」；如果本批没有迁移，应显示「不含数据库迁移，用 24 小时内的完整备份 …，不再备份」；最后「已上线 …」「按 --no-prune 跳过清理」。如果第 8 波的 `deployment-version.txt` 没有 `previousSourceCommit` 或没有 `before-5e0d9186` 标签，补记里只有第 8 波一行，第 3 步清理时会按构建时间补足第 2 个可回退版本，结果一样。

### 第 2 步：只读检查

```bash
S=/srv/weiban/src/deploy/hk
ls "$S"/ops-lib.sh "$S"/disk-check.sh "$S"/release-prune.sh "$S"/release.sh "$S"/rollback.sh "$S"/weiban-disk-check.timer
grep -E 'ExecStart|Environment' "$S"/weiban-backup.service   # backup.sh /var/backups/weiban、KEEP=2、BACKUP_MAX_TOTAL=10G
findmnt -no SOURCE,TARGET -T /var/backups                      # 应为 /dev/vda2 /（系统盘）
df -h / /srv/weiban
systemctl is-active weiban-backup.service                      # 应为 inactive：现在没有备份在跑
cat /srv/weiban/release-state/history.tsv                      # 3 行：第 7 波 seed、第 8 波 seed、本次 release
bash "$S"/rollback.sh --list                                   # 1 = 第 8 波，2 = 第 7 波
ls -la /srv/weiban/backups /var/backups/weiban /var/backups/weiban-archive
du -sh /srv/weiban/backups/* /var/backups/weiban/* /var/backups/weiban-archive/* 2>/dev/null
```

### 第 3 步【删除】发版后清理：先演练，核对后执行

```bash
S=/srv/weiban/src/deploy/hk
bash "$S"/release-prune.sh --dry-run | tee /root/prune-dryrun-$(date +%F).txt
```

演练清单应该是：

- 保留：当前版本、第 8 波（`before-<本次短号>`）、第 7 波（`before-5e0d9186`）的镜像和源码目录；任何容器在用的镜像；被容器挂载的源码目录（会写「有容器挂载了其中的文件」）。
- `[演练] 将把 weiban-app:hk / weiban-edge:hk 改指当前版本`（11-02 那份旧镜像随后作为悬空镜像清掉）。
- `[演练] 将删除`：第 6 波及更早的 `weiban-app` / `weiban-edge` 标签；`/srv/weiban/releases` 里其余约 30 个源码目录和 `.tar` 文件（约 2.4G）；指向这些目录或已不存在目录的 `src.before-*`（例如 `src.before-final-20261022`）。

**为什么可以删**：总经理定的口径是只留当前 + 2 个可回退版本；保留的两个版本正是 `rollback.sh --list` 列出的两个，回滚能力不受影响；docker 本身拒绝删除容器在用的镜像；不碰数据库、媒体、备份。删掉的源码目录和镜像都能从 Git 提交重新构建出来。

核对没问题后执行：

```bash
bash "$S"/release-prune.sh
docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep '^weiban-'
ls /srv/weiban/releases; ls -la /srv/weiban/ | grep src
df -h /srv/weiban
```

如果演练清单里出现了「保留」该删的或「删除」该留的，先别执行，把 `/root/prune-dryrun-*.txt` 发给运维。

### 第 4 步：安装新的 systemd 单元（#50 第 4 步）

```bash
S=/srv/weiban/src/deploy/hk
rm -rf /etc/systemd/system/weiban-backup.service.d     # 删掉 #50 第 0 步加的 drop-in（只是配置文件）；新单元自带同样的目标目录
install -m 0644 "$S"/weiban-backup.service "$S"/weiban-backup.timer \
  "$S"/weiban-disk-check.service "$S"/weiban-disk-check.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now weiban-backup.timer weiban-disk-check.timer
systemctl list-timers 'weiban-*' --no-pager
systemctl cat weiban-backup.service | grep -E 'ExecStart|Environment'
```

### 第 5 步：验证（5.1、5.2 不停服）

```bash
S=/srv/weiban/src/deploy/hk
# 5.1 磁盘巡检跑一次：打印两块盘的用量，低于 80% 不告警
systemctl start weiban-disk-check.service
journalctl -u weiban-disk-check.service -n 5 --no-pager

# 5.2 「空间不够不停应用」和告警通道：余量调到 100000%，预检必然失败
docker ps --filter name=weiban-prod-app --format '{{.Names}} {{.Status}}'   # 记下 Up 多久
BACKUP_SPACE_MARGIN_PERCENT=100000 bash "$S"/backup.sh /var/backups/weiban; echo "退出码 $?"
docker ps --filter name=weiban-prod-app --format '{{.Names}} {{.Status}}'   # Up 时长接着涨，没被重启
```

5.2 预期：退出码 1，最后一行「……空间不足（需要 …，可用 …），没有停应用」。管理后台「运行提醒」出现一条，**「类型」列显示「备份失败」**（不再是 `unsupported`），点「已处理」。看不到时执行 `journalctl -t weiban-ops -n 5` 并把输出发给运维。

5.3（可选，**停站两三分钟**，选低峰）真实备份一次；不做就第二天早上看 04:00 那次，命令相同：

```bash
systemctl start weiban-backup.service
journalctl -u weiban-backup.service -n 20 --no-pager   # 有「空间预检」「已完成加密备份」「保留 N 份完整备份，合计 …（上限 2 份、10G）」
ls -la /var/backups/weiban
```

### 第 6 步【删除】旧备份（等第 5 步做完、`/var/backups/weiban` 里的备份校验通过之后）

6.1 先确认系统盘上的备份是好的（全部输出 OK 才继续）：

```bash
for d in /var/backups/weiban/weiban-*/; do (cd "$d" && sha256sum -c --quiet SHA256SUMS && echo "OK $d"); done
```

建议（不强制）：先按 `hk-server.md` 第三节把最新一份下载到总经理电脑。

6.2 看清单：

```bash
ls -la /srv/weiban/backups; du -sh /srv/weiban/backups/* 2>/dev/null
ls -la /var/backups/weiban-archive; du -sh /var/backups/weiban-archive 2>/dev/null
```

6.3 删除（不可恢复）：

| 删什么 | 为什么可以删 |
|---|---|
| `/srv/weiban/backups/weiban-*`：11-03 的两份完整备份（各约 3.2G），以及更早的或没有 `manifest.txt` 的 `weiban-*` 目录 | 比 `/var/backups/weiban` 里校验通过的备份更旧；按「最多 2 份、合计 ≤10G」是多余的；数据盘只放程序和数据 |
| `/srv/weiban/backups` 里 10 月的几份小型临时备份（名字不是 `weiban-*`、也不是 `release-state-*` 的，看 6.2 清单逐个确认） | 都是更早的临时快照，已被每日备份取代 |
| `/var/backups/weiban-archive` 整个目录（事故时挪过去的 6 份旧备份） | 同类加密快照，比现有备份旧，新备份已验证 |

```bash
rm -rf -- /srv/weiban/backups/weiban-*
rm -rf -- /srv/weiban/backups/<10 月临时备份名1> /srv/weiban/backups/<名2>   # 按 6.2 清单逐个写名字
rm -rf -- /var/backups/weiban-archive
df -h / /srv/weiban
```

`/srv/weiban/backups/release-state-*`（10 月手工发版的状态记录，很小）建议留着，不占地方，以后要删也行。

### 第 7 步：以后发版和回滚

- 发版：开发机 `bash deploy/hk/upload-release.sh main`，服务器照打印的命令执行（不再加 `--no-prune`）。
- 回滚：`bash /srv/weiban/src/deploy/hk/rollback.sh --list`，再 `rollback.sh 1` 或 `2`。

### 回退办法

- 新脚本出问题：手工发版仍可参照 `docs/ops/reference/manual-release-20261103.sh`；手工发完后把 `history.tsv` 删掉即可（清理脚本会退回按构建时间判断）。
- 备份上限要调：`systemctl edit weiban-backup.service`，加 `[Service]` 和 `Environment=BACKUP_MAX_TOTAL=15G`。
- 暂时不想自动清理：`release.sh` 加 `--no-prune`。
- 停用磁盘巡检：`systemctl disable --now weiban-disk-check.timer`。

## 4. 自测结果（开发自测，不是独立验收）

- 契约：`pnpm --filter @weiban/contracts typecheck`、管理后台类型检查通过；`vitest run packages/contracts apps/admin/src/features/alerts`：8 个文件 90 项通过。`pnpm android:generate` 已运行，产物只有版本号两处变化。
- 运维脚本：全部 `bash -n` 通过。本机（Windows Git Bash）跑了一次 `bash .github/scripts/check-hk-ops.sh`：备份（含新加的合计上限 3 组）、磁盘巡检、清理的镜像部分、分片上传（含坏分片重传）全部通过。
- **以 CI 为准的部分**：本机没有 shellcheck，Windows 也建不了软链接，所以 shellcheck、清理的源码目录 / 源码包 / 软链接用例、`release.sh`（不含迁移、健康检查失败自动退回、含迁移先备份）、`rollback.sh`（列表、拒绝、成功）只在 CI（ubuntu-24.04）上跑。本机跑完之后又修了几处「文件不存在时 `set -e` 会提前退出」的健壮性问题（`kv_get`、`contract_version`、`latest_backup`、`df`、`du`），这部分只做了 `bash -n`，以 CI 为准。
- 没有在真服务器上运行。真实 docker 的输出格式按 #50 的推断沿用；第 3 步第一次 `--dry-run` 就是在真机上核对。

## 5. 遗留问题

1. **提醒仍不推送到手机**：主机脚本直接写表，要打开后台才看得到。要推送需要后端提供主机可调用的登记入口（#50 遗留 1 的后半段，未做）。
2. **备份仍要停应用两三分钟**：媒体整包 tar 加 age 加密，时长随媒体增长。后续可考虑媒体增量备份或不停应用导出（#50 遗留 3）。
3. **单份超上限的提醒借用了 `backup_failed` 种类**（后台显示「备份失败」，说明里写明「备份已完成，但……超过合计上限」）。要单独的中文名需要再加一个种类（契约次版本）。
4. **含迁移的版本回滚要人工执行 down**：`rollback.sh` 会拒绝并给出命令；down 会丢新表、新列里的数据，所以没做成自动。
5. `upload-release.sh` 的闸门依赖 `powershell.exe`（Windows 开发机）；在别的系统上跑需要先移植闸门。
6. `release-state/` 里的 `runtime.env.before-*`、`rel-<提交>.meta` 每次发版各多一个 KB 级小文件，没有自动清理。
7. #50 遗留 4（`/var/lib/weiban/releases`、`src.old*`、`incoming-*`、`import-staging` 等人工检查）、遗留 5（外部探活）、遗留 6（`hk-server.md` 第一、二节仍是「仅 IP」时期的说法）不在本任务范围，没动。

## 6. 需要总经理决定的事

无。旧备份删除属于普通运维决策，按第 3 节第 6 步由总负责人确认后执行。

## 7. 给其他负责人的交接

- 给总负责人：按第 3 节执行服务器步骤（#50 第 3 节不用再单独做）；第 3 步、第 6 步是删除，演练清单和删除清单请先过目；`docs/status.md` 由你更新。
- 给后端 / Web：契约 5.3 只加了两个提醒种类，服务器代码无需改动；网页用户端不涉及。
- 给 Android：生成产物已同步到 5.3，管理员提醒不在安卓端展示，无需改动。
- 给 Codex 质量负责人：验收重点是 `release-prune.sh` 的保留规则（发版历史 + 补足 + 安全底线）、`release.sh` 的备份判断与失败处理、`rollback.sh` 的迁移检查、`backup.sh` 的合计上限；行为用例在 `.github/scripts/check-hk-ops.sh`。
