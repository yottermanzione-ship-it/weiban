# 香港服务器（仅 IP 试运行）操作说明

适用：服务器 `103.231.58.124`（Ubuntu 24.04，4 核 8G，系统盘 50G + 数据盘 40G）。2026-10-13 起运行微伴，**暂无域名、无 HTTPS**。部署记录见 [交接](../handoffs/2026-10-13-devops-hk-server.md)。

## 一、日常使用

**用户端**：浏览器打开 <http://103.231.58.124>。

**管理后台**（不对公网开放，要先开“隧道”）：

1. 在自己电脑打开 PowerShell，运行（窗口保持打开，关掉隧道就断）：

   ```powershell
   ssh -i ~/.ssh/weiban_deploy -N -L 9081:127.0.0.1:8081 root@103.231.58.124
   ```

   没有任何输出是正常的。
2. 浏览器打开 <http://localhost:9081>，用原来的管理员账号登录。
3. 用完在 PowerShell 窗口按 `Ctrl+C` 关闭隧道。

桌面快捷方式（可选）：桌面右键 → 新建 → 快捷方式，“对象位置”填下面一行，名称填「微伴后台隧道」。双击后保持黑色窗口打开，再用浏览器开 <http://localhost:9081>：

```text
C:\Windows\System32\OpenSSH\ssh.exe -i %USERPROFILE%\.ssh\weiban_deploy -N -L 9081:127.0.0.1:8081 root@103.231.58.124
```

“隧道”的意思：把服务器上只给自己看的 8081 端口，经加密的 SSH 连接搬到你电脑的 9081 端口。本机部署占用了 8081，所以这里用 9081。

## 二、HTTP（无 HTTPS）期间的限制

- 浏览器地址栏会显示“不安全”，网络上的人理论上能看到传输内容（含登录密码）。**只适合自己试用，不要拉真实用户**。
- 浏览器在非 HTTPS 下禁用：麦克风/摄像头（语音通话、语音输入不可用）、安装为 App（PWA）、离线缓存、网页推送通知、部分复制到剪贴板。
- 有域名后：域名解析到本 IP → 运维改用生产 Caddy 自动签证书、开 443、去掉 `deploy/hk/compose.override.yml` 的 IP 模式。

## 三、备份

- 每天香港时间 04:00 自动加密备份到**系统盘** `/var/backups/weiban/weiban-时间-随机串/`，只保留最近 2 份；发版前也用同一脚本备份一次。备份时应用要停到数据库和媒体导出完为止（媒体约 3G，以分钟计）。空间预检、失败处理和保留规则见第六节。
- 备份用你电脑上那把 age 公钥加密；**服务器上没有解密钥匙**，所以别人拿到备份文件也打不开。解密钥匙仍在你电脑 `C:\wb-offline-keys\local-backup.agekey`，请另存一份到 U 盘/密码管理器。
- 主密钥（KEK）在服务器 `/srv/weiban/secrets/kek`，与本机 `C:\wb-local\secrets\kek` 是同一把。丢了它，备份里的加密数据无法恢复，务必离线另存。

**把最新备份下载回自己电脑**（PowerShell）：

```powershell
# 1. 看看服务器上有哪些备份
ssh -i ~/.ssh/weiban_deploy root@103.231.58.124 "ls -1 /var/backups/weiban"
# 2. 下载最新一份到 D:\weiban-hk-backups（文件夹不存在会自动创建）
New-Item -ItemType Directory -Force D:\weiban-hk-backups | Out-Null
$latest = ssh -i ~/.ssh/weiban_deploy root@103.231.58.124 "ls -1d /var/backups/weiban/weiban-* | tail -1"
scp -i ~/.ssh/weiban_deploy -r "root@103.231.58.124:$latest" D:\weiban-hk-backups\
```

每份里有 `database.dump.age`、`media.tar.age`（加密）、`SHA256SUMS`、`manifest.txt`。

**立即手动备份一次**（会短暂停应用）：

```powershell
ssh -i ~/.ssh/weiban_deploy root@103.231.58.124 "systemctl start weiban-backup.service && journalctl -u weiban-backup.service -n 5 --no-pager"
```

## 四、运维命令（服务器上，root）

```bash
cd /srv/weiban/src
C="docker compose -p weiban-prod --env-file /srv/weiban/runtime.env -f deploy/prod/compose.yml -f deploy/hk/compose.override.yml"
$C ps                 # 状态
$C logs -f --tail 100 app   # 日志
$C restart app        # 重启应用
systemctl list-timers 'weiban-*'   # 下次备份、磁盘巡检时间
journalctl -t weiban-ops -n 20 --no-pager   # 最近的磁盘 / 备份告警
```

**升级到新版本（防旧分支覆盖）**：先把所有待发布改动合入 main，在干净的整合副本执行 `& .\deploy\hk\Assert-ReleaseSource.ps1 -Ref main`。此只读闸门会拉取最新 main 并读取服务器发布清单；缺少 main 或线上提交的旧任务分支、未提交业务文件均拒绝发布。通过后才可对已核准的完整 SHA 执行 `git archive` / 传输 / 构建；不可直接从任一旧任务副本覆盖线上源码。

正式切换采用独立版本目录，先校验与 Git 源码摘要一致、隔离库迁移可执行、备份完整，再更新 `/srv/weiban/src` 版本链接和固定项目的镜像。保留上一版源码与镜像，更新 `/srv/weiban/deployment-version.txt` 中的完整 sourceCommit；不要覆盖在用源码目录后才开始构建。本次范例和证据见 [10-22 统一发布交接](../handoffs/2026-10-22-consolidated-release.md)。该闸门仅核验，不授予后续发布权限。

发版前备份用 `systemctl start weiban-backup.service`（与每日备份同一目录和保留份数；失败时命令返回非零，发版必须停下）。新版本健康检查通过后执行发版后清理：

```bash
ROLLBACK_APP_IMAGE=weiban-app:before-<短号> ROLLBACK_EDGE_IMAGE=weiban-edge:before-<短号> \
  bash /srv/weiban/src/deploy/hk/release-prune.sh
```

清理规则见第六节；第一次或不确定时先加 `--dry-run` 只看清单。

**恢复**（只恢复到新的空项目，不覆盖在用的）：

```bash
export WEIBAN_DEPLOY_ENV=/srv/weiban/runtime.env WEIBAN_COMPOSE_PROJECT=weiban-restore-xxx
docker compose -p $WEIBAN_COMPOSE_PROJECT --env-file $WEIBAN_DEPLOY_ENV -f deploy/prod/compose.yml up -d --wait postgres
bash deploy/prod/scripts/restore.sh /var/backups/weiban/weiban-某份 /临时放置的age身份文件
```

然后带 `deploy/hk/compose.override.yml` 启动 app 检查；age 身份用完立即删除。

## 五、重建服务器

1. `scp deploy/hk/server-setup.sh` 到新服务器并 `bash server-setup.sh`（挂载数据盘、装 Docker/ufw/fail2ban、安全更新；数据盘为空时需显式 `FORMAT_EMPTY_DISK=1` 才格式化）。
2. 上传源码到 `/srv/weiban/src`，复制 `deploy/hk/runtime.env.example` 为 `/srv/weiban/runtime.env`。
3. 恢复秘密：`/srv/weiban/secrets/kek`（属主 1000，600）、新生成 `postgres-password`（属主 999，600）与对应 `database-url`（属主 1000，600）。
4. 构建、启动 postgres、按第四节恢复数据、再 `up -d --wait`。
5. 安装定时器：复制 `deploy/hk/weiban-backup.{service,timer}` 与 `deploy/hk/weiban-disk-check.{service,timer}` 到 `/etc/systemd/system/`，`systemctl daemon-reload && systemctl enable --now weiban-backup.timer weiban-disk-check.timer`；公钥放 `/srv/weiban/keys/backup-recipient.txt`。

## 六、磁盘、备份与清理

> 2026-11-03 04:59–05:08 数据盘写满，停站约 10 分钟：旧备份脚本先停应用、再往同一块数据盘写备份，写满后应用起不来。下面的规则据此制定（任务 T-20261103f）。

### 磁盘布局

| 盘 | 挂载点 | 放什么 |
|---|---|---|
| 数据盘 `/dev/vdb1`，40G | `/srv/weiban`（fstab 用 UUID） | `docker/`（Docker 数据：数据库卷、媒体卷、容器、日志）、`containerd/`（镜像层，Docker 29 默认放这里）、`releases/<提交>`（发版源码，`src` 软链接指向当前版本）、`secrets/`（0700）、`keys/`（只有备份公钥）、`runtime.env`。旧的 `backups/` 只剩发版状态等手工存档，不再放每日备份 |
| 系统盘 `/dev/vda2`，50G | `/` | 操作系统；`/var/backups/weiban/`（每日与发版前备份）；`/var/backups/weiban-archive/`（11-03 从数据盘移来的旧备份，待处理） |

备份和数据分在两块盘：备份写满系统盘时，数据库和应用照常写数据盘；数据盘满了也不会让备份写不下去。

占用参考（11-03）：每份完整备份约 3.2G（数据库约 0.12G，媒体约 3.1G）；每个应用镜像约 1.28G（多数层共用）；每个发版源码目录约 70M。

### 备份保留

| 规则 | 值 | 在哪里改 |
|---|---|---|
| 目标目录 | `/var/backups/weiban` | `weiban-backup.service` 的 ExecStart 参数 |
| 保留份数 | 最近 2 份完整备份。只算 `weiban-*` 名字的目录，别的名字的手工备份不自动清理 | `weiban-backup.service` 的 `Environment=KEEP=2` |
| 空间预检 | 上一份完整备份大小加 20%，再留 1G 底线；目录里还没有完整备份时，按当前数据库加媒体的大小估算 | 环境变量 `BACKUP_SPACE_MARGIN_PERCENT`、`BACKUP_RESERVE_BYTES` |
| 超时 | 45 分钟 | `weiban-backup.service` 的 `TimeoutStartSec` |

`deploy/hk/backup.sh` 的执行顺序：

1. 空间预检。不够就失败退出，**这时应用还没停**；后台出现「备份未完成：备份盘……空间不足……没有停应用」。
2. 停应用 → 导出数据库与媒体 → 马上恢复应用 → 写校验和与清单 → 删除超出 2 份的旧备份。旧备份在新备份完成后才删，所以写备份那一刻最多同时有 3 份（约 10G）。
3. 中途任何一步失败、超时或被 `systemctl stop`：先删掉本次半成品，再启动原应用容器并等它健康，后台登记提醒；应用没能恢复健康时登记为「严重」。
4. 同一时间只跑一个备份（锁文件 `/run/lock/weiban-backup.lock`），撞上时后来的直接失败退出。

### 发版后清理

新版本切换并通过健康检查后运行 `deploy/hk/release-prune.sh`（命令见第四节；第一次建议先加 `--dry-run` 看清单）：

| 对象 | 保留 | 其余 |
|---|---|---|
| `weiban-app` / `weiban-edge` 镜像 | `runtime.env` 里 `APP_IMAGE` / `EDGE_IMAGE` 指向的当前版本；上一版（`ROLLBACK_APP_IMAGE` / `ROLLBACK_EDGE_IMAGE` 指定，没指定就取除当前外最新构建的一个）；`:hk` 标签；任何容器（包括已停止的）在用的镜像 | 删除标签，再清悬空镜像 |
| 构建缓存 | 24 小时内用过的（下次构建更快） | `docker builder prune` 清掉；`BUILD_CACHE_UNTIL=`（设为空）则全清 |
| `/srv/weiban/releases/` 源码目录 | `src` 指向的当前版本、最近 1 个其他版本、被任何容器挂载的目录 | 删除（份数用 `KEEP_PREVIOUS_RELEASES` 调） |

不碰：数据库、媒体卷、备份、postgres / caddy 等其他仓库的镜像、`/var/lib/weiban/releases`、`src.old*` 等历史目录（这些要人工判断）。刚回滚过时必须显式指定 `ROLLBACK_*`，否则「最新构建」可能正是刚撤下的坏版本。

### 磁盘告警

| 项 | 值 |
|---|---|
| 检查对象 | 数据盘 `/srv/weiban`、系统盘 `/` |
| 频率 | 每 10 分钟（`weiban-disk-check.timer` → `deploy/hk/disk-check.sh`） |
| 阈值 | 达到 80% 警告，达到 90% 严重（环境变量 `DISK_ALERT_PERCENT`、`DISK_CRITICAL_PERCENT`） |
| 在哪看 | 管理后台「运行提醒」；服务器上 `journalctl -t weiban-ops` |

备份失败也走同一个通道（合并键 `backup_failed:hk`、`backup_app_down:hk`）。注意：

- 这些提醒由服务器脚本直接写进数据库表 `push.admin_alerts`。契约里还没有这两个种类，后台「类型」列暂时显示 `unsupported`，看「说明」列即可；同一问题没点「已处理」之前只累加次数。
- **不会推送到手机**，要打开后台才看得到。
- 数据盘真的写满时数据库也写不进，只剩系统日志，所以阈值定在 80%，留出处理时间。

收到磁盘告警怎么处理（服务器上，root）：

```bash
df -h / /srv/weiban
du -xh -d1 /srv/weiban | sort -h | tail          # 数据盘上谁最大
docker system df                                  # 镜像、构建缓存各占多少
bash /srv/weiban/src/deploy/hk/release-prune.sh --dry-run   # 先看会清什么，确认后去掉 --dry-run
du -sh /var/backups/weiban/* /var/backups/weiban-archive 2>/dev/null   # 系统盘上的备份
```

处理完在后台「运行提醒」点「已处理」。

## 七、安全现状

- 防火墙 ufw 只放行 22、80（443 预留未开）；后台只绑定服务器 127.0.0.1，数据库只在容器内部网络。
- 注意（2026-10-13 发现）：有人另装了宝塔面板并在 ufw 加开 20、21、443、888、11823、39000-40000，总经理已确认宝塔面板、hatch 钥匙与 2026-10-13 02:11 的密码登录均为本人操作。
- fail2ban 保护 SSH：10 分钟内失败 5 次封 1 小时。
- 系统自动安装安全更新（unattended-upgrades）。
- 尚未做（需总经理同意）：禁用 SSH 密码登录、改 SSH 端口、改 root 密码。
