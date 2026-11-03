# 交接说明：T-20261103f 香港服务器数据盘防写满

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 日期 | 2026-11-03 |
| 分支 | `ops/hk-disk-safety-20261103`（基于 origin/main `df822cb8`） |
| 任务卡 | `docs/tasks/T-20261103f-hk-disk-safety.md` |
| 契约 / 迁移 | 都不变 |
| 服务器 | 未登录、未改动；服务器上的步骤见第 3 节，由总负责人执行 |

## 结论

1. **备份不会再先停应用再写满盘**：`backup.sh` 开始前先估算空间（上一份完整备份 +20%，再留 1G 底线），不够就直接失败退出，这时应用还在运行，后台「运行提醒」会出现一条说明。
2. **任何失败都会把应用拉起来**：导出中途失败、超时、被 `systemctl stop` 时，先删掉本次半成品腾空间，再启动原应用容器并等它健康；应用没恢复健康会登记「严重」提醒，退出码非零。数据导出完就先恢复应用，再写校验和、清理旧备份，停站时间比原来短一点。
3. **备份改放系统盘** `/var/backups/weiban`（KEEP=2），和数据盘分开。迁移命令见第 3 节。
4. **发版后清理进了仓库**：`deploy/hk/release-prune.sh`，只留当前版本、上一版、`hk` 标签和任何容器在用的镜像，清 24 小时前的构建缓存和多余的源码目录，有 `--dry-run`。
5. **磁盘告警**：每 10 分钟检查数据盘和系统盘，≥80% 警告、≥90% 严重，写系统日志并登记到管理后台「运行提醒」。备份失败也走这个通道。
6. **CI 加了一步**「香港运维脚本检查」：shellcheck 加 60 多项行为用例（用假的 docker 模拟），守住上面几条。

## 1. 做了什么（按任务卡 1–5）

### 1.1 发版后清理（第 1 项）

仓库里原来没有服务器端发版脚本（发版用的是总负责人手写的服务器脚本），所以做成独立脚本，由发版脚本最后一步调用：

```bash
ROLLBACK_APP_IMAGE=weiban-app:before-<短号> ROLLBACK_EDGE_IMAGE=weiban-edge:before-<短号> \
  bash /srv/weiban/src/deploy/hk/release-prune.sh            # 加 --dry-run 只看清单
```

- **保留**：`runtime.env` 里 `APP_IMAGE` / `EDGE_IMAGE` 指向的当前版本；上一版（`ROLLBACK_*` 指定；没指定就取除当前外最新构建的一个）；`:hk` 标签；任何容器（包括已停止的）在用的镜像。保留按镜像 ID 判断，同一镜像的其他标签也一起留下。
- **删除**：当前镜像所在仓库（`weiban-app`、`weiban-edge`）里其余的标签，再 `docker image prune` 清悬空镜像；`docker builder prune --all --filter until=24h`（留最近一天的缓存，下次构建快；`BUILD_CACHE_UNTIL=` 设空则全清）；`/srv/weiban/releases/` 下当前版本和最近 1 个之外的源码目录。
- **安全措施**：当前镜像找不到就拒绝清理；从不加 `-f`，docker 本身也拒绝删容器在用的镜像；被任何容器挂载的源码目录不删（例如 postgres 挂载的初始化脚本目录，删了容器下次启动会失败）；`src` 不是软链接时跳过源码目录清理；不碰 postgres / caddy 等其他仓库的镜像、`/var/lib/weiban/releases`、`src.old*`。
- 刚回滚过的情况下「最新构建」可能是刚撤下的坏版本，所以发版脚本应始终显式传 `ROLLBACK_*`。

### 1.2 备份空间预检与失败恢复（第 2 项）

`deploy/hk/backup.sh` 重写了执行顺序（产物格式不变，仍可用 `deploy/prod/scripts/restore.sh` 恢复）：

1. 参数与工具检查、加锁（`/run/lock/weiban-backup.lock`，定时备份和发版前备份撞上时后来的直接失败）。
2. **空间预检**：目录里有完整备份时，用最新一份的大小；没有时（例如刚迁到新目录），用当前数据库大小加媒体目录大小。需要 = 估算 ×1.2 + 1G。用 `df` 查备份目录所在盘的可用空间，不够就 `fail`：写提醒、退出 1，**没有任何停应用的动作**。
3. 记下正在运行的 app 容器 → 建本次目录 → 装 `EXIT` 处理和 `TERM/INT/HUP` 处理 → 停 app → 导出数据库 → 导出媒体 → **马上恢复 app** → 写 `SHA256SUMS`、`manifest.txt` → 删超出 KEEP 份的旧备份和超过 1 天的残留。
4. **EXIT 处理**（成功、失败、收到信号都会走）：本次没完成就删半成品；应用还没恢复就 `docker start` 原容器并等健康（默认 120 秒）；恢复失败登记「严重」；其余失败登记「备份失败」。保留了 10-27 的修法：直接启动原容器，不经 `compose start`。
5. systemd 单元：`TimeoutStartSec=45min`（卡住超过 45 分钟由 systemd 发停止信号，脚本收尾）；`TimeoutStopSec=5min`（给收尾留时间）。默认 `KillMode` 会把停止信号同时发给 docker 命令子进程，导出管道会结束，bash 随即执行收尾，这一点比只发给主进程更可靠。

原脚本的问题：没有空间检查；新备份写完才删旧备份，峰值是 KEEP+1 份都放在数据盘；失败时半成品要等一天后才清，盘一直满；恢复失败时退出码仍可能是 0。以上都已处理。

### 1.3 备份放系统盘（第 3 项）

- `weiban-backup.service` 改为 `backup.sh /var/backups/weiban`，`Environment=KEEP=2` 写在单元里，路径和份数只在这里定义一处。
- `backup.sh` 不带参数时默认也是 `/var/backups/weiban`；旧单元带 `/srv/weiban/backups` 参数调用时照样能跑（同样有空间预检），所以新源码上线早于单元更新也不会出问题。
- `server-setup.sh` 改为在系统盘建 `/var/backups/weiban`，数据盘不再建 `backups/`。

### 1.4 磁盘告警（第 4 项）

项目现有的告警通道是管理后台「运行提醒」（表 `push.admin_alerts`，接口 `GET /api/v1/admin/alerts`）。主机脚本没法调用后端内部的 `AdminAlertService`，所以 `deploy/hk/ops-lib.sh` 的 `ops_alert` 通过 `docker compose exec postgres psql` 直接写这张表，按与后台相同的规则合并：同一合并键还没点「已处理」时只累加次数、更新说明，级别只升不降。同时写系统日志（`journalctl -t weiban-ops`）。

| 合并键 | 种类 | 何时 |
|---|---|---|
| `host_disk_high:/srv/weiban`、`host_disk_high:/` | `host_disk_high` | 使用率 ≥80% 警告、≥90% 严重 |
| `backup_failed:hk` | `backup_failed` | 备份没做成（含空间不足） |
| `backup_app_down:hk` | `backup_failed` | 备份后应用没能恢复健康（严重） |

限制（已写进运维文档）：

- 契约 `AdminAlertKind` 里没有这两个种类。响应用的是接收端容错枚举，后台「类型」列会显示 `unsupported`，「说明」列正常显示，不会报错。正式加种类属于契约变更，见第 5 节。
- 这条路径**不发手机推送**，要打开后台才看得到。
- 数据盘真写满时数据库也写不进，只剩系统日志，所以阈值定在 80%。

### 1.5 文档（第 5 项）

- `docs/ops/hk-server.md`：第六节改为「磁盘、备份与清理」，包含磁盘布局、备份保留、发版后清理、磁盘告警、收到告警怎么处理；第三节备份路径与份数改正（原写「保留 7 份」，与脚本 KEEP=2 不符）；第四节加发版前备份和发版后清理的用法；第五节重建步骤加磁盘巡检定时器。
- `docs/ops/ci.md`、`deploy/README.md`：登记新的 CI 步骤和 hk 目录内容。

## 2. 改了哪些文件

- `deploy/hk/backup.sh`：重写，加空间预检、失败恢复、半成品清理、锁、告警
- `deploy/hk/ops-lib.sh`（新）：公共 compose 命令与 `ops_alert`
- `deploy/hk/disk-check.sh`（新）：磁盘巡检
- `deploy/hk/release-prune.sh`（新）：发版后清理
- `deploy/hk/weiban-backup.service`：目标改系统盘，加 KEEP 与超时
- `deploy/hk/weiban-disk-check.service`、`deploy/hk/weiban-disk-check.timer`（新）
- `deploy/hk/server-setup.sh`：备份目录改到系统盘
- `.github/scripts/check-hk-ops.sh`（新）、`.github/workflows/ci.yml`：新增 CI 步骤
- `docs/ops/hk-server.md`、`docs/ops/ci.md`、`deploy/README.md`
- `docs/tasks/T-20261103f-hk-disk-safety.md`：任务卡原样带上（与 PR #49 中的同一文件内容一致）
- 本交接

## 3. 服务器上要执行的命令（总负责人按顺序执行，root）

### 第 0 步（可选，合并前止血，不依赖本 PR）

如果本 PR 赶不上下一次 04:00 备份之前上线，可以先把每日备份改写到系统盘。旧脚本仍然先停应用，但系统盘还有约 28G，风险小很多：

```bash
install -d -m 0700 /var/backups/weiban
mkdir -p /etc/systemd/system/weiban-backup.service.d
cat >/etc/systemd/system/weiban-backup.service.d/target.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/bin/bash /srv/weiban/src/deploy/hk/backup.sh /var/backups/weiban
EOF
systemctl daemon-reload
systemctl cat weiban-backup.service | grep ExecStart
```

### 第 1 步：合并并随下一次正常发版上线

脚本都是从 `/srv/weiban/src/deploy/hk/` 运行的，跟着下一次包含本提交的正常发版到服务器即可，不需要单独构建镜像。之后的步骤都在新版本切换完成后做。

### 第 2 步：只读检查前提

```bash
S=/srv/weiban/src/deploy/hk
ls "$S"/ops-lib.sh "$S"/disk-check.sh "$S"/release-prune.sh "$S"/weiban-disk-check.timer   # 新文件都在
grep ExecStart "$S"/weiban-backup.service        # 应为 ... backup.sh /var/backups/weiban
findmnt -no SOURCE,TARGET -T /var/backups         # 应为 /dev/vda2 /（系统盘）
df -h / /srv/weiban
systemctl is-active weiban-backup.service         # 应为 inactive：现在没有备份在跑
ls -la /srv/weiban/backups /var/backups/weiban-archive
```

### 第 3 步：停每日备份定时器，把数据盘上最近 2 份完整备份搬到系统盘

搬过去有两个作用：新目录里有完整备份，空间预检就有估算依据；KEEP=2 的清理也从这里接着算。复制后先用 `SHA256SUMS` 校验，校验通过才删原件。

```bash
systemctl stop weiban-backup.timer
install -d -m 0700 /var/backups/weiban
mapfile -t olds < <(ls -1d /srv/weiban/backups/weiban-*/manifest.txt 2>/dev/null | xargs -r -n1 dirname | sort | tail -n 2)
printf '准备搬：%s\n' "${olds[@]}"
du -shc "${olds[@]}"; df -h /                     # 确认系统盘放得下
for d in "${olds[@]}"; do
  n=$(basename "$d")
  cp -a -- "$d" /var/backups/weiban/ &&
    (cd "/var/backups/weiban/$n" && sha256sum -c --quiet SHA256SUMS) &&
    rm -rf -- "$d" && echo "已迁移 $n"
done
ls -la /var/backups/weiban /srv/weiban/backups
```

`/srv/weiban/backups` 里剩下的：`release-state-*` 等发版状态目录很小，留着；还有更早的 `weiban-*` 完整备份可以 `mv` 到 `/var/backups/weiban-archive/`；没有 `manifest.txt` 的 `weiban-*` 目录是失败残留，可以删除。

### 第 4 步：安装新的 systemd 单元

```bash
S=/srv/weiban/src/deploy/hk
rm -rf /etc/systemd/system/weiban-backup.service.d   # 做过第 0 步才有，没有也无妨
install -m 0644 "$S"/weiban-backup.service "$S"/weiban-backup.timer \
  "$S"/weiban-disk-check.service "$S"/weiban-disk-check.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now weiban-backup.timer weiban-disk-check.timer
systemctl list-timers 'weiban-*' --no-pager
```

### 第 5 步：验证（这一步不停应用）

```bash
S=/srv/weiban/src/deploy/hk
# 5.1 磁盘巡检跑一次：打印两块盘的用量，低于 80% 不告警
systemctl start weiban-disk-check.service
journalctl -u weiban-disk-check.service -n 5 --no-pager

# 5.2 验证「空间不够不停应用」和告警通道：把余量调到 100000%，预检必然失败
docker ps --filter name=weiban-prod-app --format '{{.Names}} {{.Status}}'   # 记下 Up 多久
BACKUP_SPACE_MARGIN_PERCENT=100000 bash "$S"/backup.sh /var/backups/weiban; echo "退出码 $?"
docker ps --filter name=weiban-prod-app --format '{{.Names}} {{.Status}}'   # Up 时长接着涨，没被重启
```

5.2 预期：退出码 1，输出最后一行是「……空间不足（需要 …，可用 …），没有停应用」。然后打开管理后台「运行提醒」，应看到一条「备份未完成：……没有停应用」（类型列显示 `unsupported`），点「已处理」。看不到的话执行 `journalctl -t weiban-ops -n 5`，把输出发给运维。

5.3（可选，会停应用 1–2 分钟，选低峰时段）真实备份一次；不做的话，第二天早上看 04:00 那次的结果，命令相同：

```bash
systemctl start weiban-backup.service
journalctl -u weiban-backup.service -n 20 --no-pager   # 有「空间预检」「已完成加密备份」两行
ls -la /var/backups/weiban
```

### 第 6 步：改手工发版脚本

1. **发版前备份**改成 `systemctl start weiban-backup.service`（与每日备份同一目录、同一保留份数；失败时命令返回非零，发版必须停下）。不要再写死 `/srv/weiban/backups`。
2. **末尾手写的镜像与缓存清理**换成下面这一行，`<短号>` 是本次发版打的回滚标签：

   ```bash
   ROLLBACK_APP_IMAGE=weiban-app:before-<短号> ROLLBACK_EDGE_IMAGE=weiban-edge:before-<短号> \
     bash /srv/weiban/src/deploy/hk/release-prune.sh
   ```

   第一次先加 `--dry-run`，和手写脚本的保留结果对照；一致后去掉。

### 第 7 步：旧备份怎么处理

- `/var/backups/weiban-archive`（11-03 移来的）：建议等 `/var/backups/weiban` 里有了两份新脚本做的完整备份（两个晚上之后），并且至少下载过一份到总经理电脑（`hk-server.md` 第三节的命令），再整个删除：`du -sh /var/backups/weiban-archive && rm -rf /var/backups/weiban-archive`。这些都是更早的同类加密快照，新备份验证过后就没有用处了。删除不可恢复，由总负责人确认后执行。
- `/srv/weiban/backups`：按第 3 步末尾的说明处理。

### 回退办法

- 备份目标改回数据盘：`systemctl edit weiban-backup.service`，把 ExecStart 的参数改回 `/srv/weiban/backups`。新脚本两种路径都能用。
- 停用磁盘巡检：`systemctl disable --now weiban-disk-check.timer`。
- 告警写进数据库的只是普通提醒记录，在后台点「已处理」即可，90 天后自动清理。

## 4. 自测结果（开发自测，不是独立验收）

- 本机（Windows Git Bash）运行一次 `bash .github/scripts/check-hk-ops.sh`：全部通过。覆盖：首次无备份时按数据库加媒体估算；空间不足时不停应用、不导出、登记提醒、不建目录；媒体导出失败时先停后启、删半成品、旧备份还在；KEEP=2 保留；应用原本没运行时不去启动；应用恢复后不健康时登记严重、退出码非零、备份仍保留；导出中收到 SIGTERM 时退出码 143、应用被拉起、半成品已删；磁盘 50% / 85% / 93% 三档；发版清理的演练模式、实际清理（当前、上一版、hk、已停止容器在用的都保留，旧标签删除，不碰 pgvector）、显式回滚镜像、当前镜像缺失时拒绝。
- 本机没有 shellcheck，Windows 也建不了软链接，所以 shellcheck 和「源码目录清理」4 项用例只在 CI（ubuntu-24.04）上跑，以 CI 结果为准。
- `deploy/README.md`、`ci.yml` 用 prettier 检查通过。
- 没有在真服务器上运行。真实 docker 的输出格式（containerd 镜像存储下的 `docker image ls`、容器 `.Image`）按文档推断，第 6 步第一次 `--dry-run` 就是在真机上核对这一点。

## 5. 遗留问题

1. **后台类型显示 `unsupported`、不推送**：建议提契约变更（次版本）：`AdminAlertKind` 加 `host_disk_high`、`backup_failed`；后台 `apps/admin/src/features/alerts.tsx` 的 `KIND_LABELS` 加「服务器磁盘」「备份失败」；如需手机推送，后端要提供主机脚本可调用的登记方式（例如只在本机回环开放的内部命令 `node dist/... raise-alert`），由后端走正常的提醒与推送流程，主机脚本改为调用它。
2. **手工发版脚本不在仓库里**：建议把它整理成 `deploy/hk/release.sh` 入库，备份、切换、清理都固定调用仓库脚本，不再靠人记。总负责人把现用脚本给运维即可整理。
3. **备份时仍要停应用**：媒体约 3.1G，每次都整包 tar 加 age 加密，停站以分钟计，而且随媒体增长变长。后续可以考虑媒体增量备份，或在不停应用的前提下导出（数据库用 pg_dump 本身就是一致快照）。
4. **10-24 只读审查提到的其他磁盘占用**（`/var/lib/weiban/releases`、`src.old*`、`incoming-*`、`import-staging`）不在自动清理范围内，需要人工看一遍。
5. **没有外部探活**：应用卡死、整机宕机时目前没人通知（10-24 审查 D4），不在本任务范围。
6. `hk-server.md` 第一、二节仍是「仅 IP、无 HTTPS」时期的说法（10-26 已上域名 HTTPS），不在本任务范围，没改。

## 6. 需要总经理决定的事

无。旧备份是否删除属于普通运维决策，建议见第 3 节第 7 步，由总负责人确认。

## 7. 给其他负责人的交接

- 给总负责人：按第 3 节执行服务器步骤；把第 5 节第 1 条转给架构 / 后端 / Web 评估；考虑第 2 条把手工发版脚本交给运维入库；`docs/status.md` 由你更新。
- 给架构 / 后端：第 5 节第 1 条的契约变更申请（新增两个提醒种类；可选的主机侧登记入口）。
- 给 Web（管理后台）：契约加种类后，在 `KIND_LABELS` 补中文名。
- 给 Codex 质量负责人：验收时重点看 `deploy/hk/backup.sh` 的顺序和收尾逻辑、`release-prune.sh` 的保留规则；行为用例在 `.github/scripts/check-hk-ops.sh`。
