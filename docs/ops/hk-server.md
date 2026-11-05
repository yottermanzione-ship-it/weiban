# 香港服务器操作说明

> **2026-11-05 当前入口与记录**：用户端为 <https://app.weiban.online>，后台为 <https://admin.weiban.online>，均已使用加密连接和独立后台登录。下面“一、日常使用”“二、HTTP 期间的限制”是 10-13 的 IP 试运行历史，不作为当前入口，也不需要经理再开启旧后台隧道。当前来源、真实备份恢复演练与限制见[本批报告](../quality/2026-11-04-web-remaining.md)及[最新发布记录](../handoffs/2026-11-04-web-remaining.md)。

适用：服务器 `103.231.58.124`（Ubuntu 24.04，4 核 8G，系统盘 50G + 数据盘 40G）。2026-10-13 起运行微伴；当时的 IP 试运行记录见[历史交接](../handoffs/2026-10-13-devops-hk-server.md)，当前域名入口以上方更正为准。

## 一、旧 IP 试运行入口（历史）

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

## 二、旧 HTTP（无 HTTPS）期间的限制（历史）

- 浏览器地址栏会显示“不安全”，网络上的人理论上能看到传输内容（含登录密码）。**只适合自己试用，不要拉真实用户**。
- 浏览器在非 HTTPS 下禁用：麦克风/摄像头（语音通话、语音输入不可用）、安装为 App（PWA）、离线缓存、网页推送通知、部分复制到剪贴板。
- 有域名后：域名解析到本 IP → 运维改用生产 Caddy 自动签证书、开 443、去掉 `deploy/hk/compose.override.yml` 的 IP 模式。

## 三、备份

- 每天香港时间 04:00 自动加密备份到**系统盘** `/var/backups/weiban/weiban-时间-随机串/`，最多留 2 份、合计不超过 10G。发版前**只有这次含数据库迁移**（或 24 小时内没有完整备份）才额外备份一次，用同一脚本。备份时应用要停到数据库和媒体导出完为止（媒体约 3G，两三分钟），这也是要少备份的原因。空间预检、失败处理和保留规则见第六节。
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

**发版**（2026-11-03 起用仓库里的脚本，不再手写；手写时代的第 7 波脚本存档在 `docs/ops/reference/manual-release-20261103.sh`）：

1. 先把所有待发布改动合入 main。
2. 开发机（Git Bash，仓库根目录）：

   ```bash
   bash deploy/hk/upload-release.sh main
   ```

   它先跑只读闸门 `deploy/hk/Assert-ReleaseSource.ps1`（要发布的提交必须包含最新 origin/main 和线上版本；有未提交的业务文件也拒绝），再把该提交 `git archive` 打包，切成 4MB 分片逐片上传、逐片核对 SHA256（断了重跑会跳过已传好的分片），服务器上合并后再核对整包，最后打印下一步命令。闸门只核验源码，不代表获准发布。

3. 服务器（root），照第 2 步打印的命令执行：

   ```bash
   bash /tmp/rel-<完整提交号>.release.sh --pr <PR号> --note '<一句话说明>' <完整提交号>
   ```

   `deploy/hk/release.sh` 依次：解压到 `/srv/weiban/releases/<提交>` → 构建新镜像 `weiban-app:release-<提交>`、`weiban-edge:release-<提交>`（应用照常运行）→ 按需备份 → 当前镜像打 `before-<新短号>` 回滚标签、旧源码留 `src.before-<新短号>` 软链接 → 切换 `runtime.env` 镜像和 `src` 软链接 → `up -d --wait app caddy` → 写 `/srv/weiban/deployment-version.txt` 和发版历史 → 调用 `release-prune.sh` 清理。
   - **要不要备份**（总经理 11-03）：新旧版本的 `apps/server/drizzle/meta/_journal.json` 不同（含数据库迁移）→ 先备份；相同 → 24 小时内有完整备份就不备份，没有才备份。备份走 `systemctl start weiban-backup.service`（与每日备份同一脚本、目录、保留规则），期间停站两三分钟；备份失败发版就停，线上仍是原版本。要强制备份加 `--force-backup`。
   - **健康检查没过**：不含迁移时自动退回原版本；含迁移时不自动退（旧版本认不得新迁移），屏幕上会给出三种处理办法。
   - 想先看清理清单时加 `--no-prune`，之后手动运行 `bash /srv/weiban/src/deploy/hk/release-prune.sh --dry-run`，核对后去掉 `--dry-run` 再运行。

**回滚**（服务器，root）：

```bash
bash /srv/weiban/src/deploy/hk/rollback.sh --list    # 看有哪些版本可退，不改动
bash /srv/weiban/src/deploy/hk/rollback.sh 1         # 退回上一版；2 = 上上一版；也可写提交号。加 --dry-run 只检查不切换
```

「上一版」按发版历史的部署先后排，和发版后清理保留的是同一份名单。回滚只切换镜像和源码，不删东西、不备份。数据库里有目标版本不认识的迁移时会拒绝，并打印两种处理办法（用当前版本 `migrate.js down` 退掉这几个迁移，或用备份恢复），由人判断后执行。

**网页离线通知（2026-11-05 新增，需专用凭据存储授权）**：首次在正常已检查的发布命令加 `--enable-webpush`，新镜像构建后、应用切换前准备配置。凭据只在服务器 `/srv/weiban/keys/web-push/credentials.json` 生成，目录 root 0700、文件运行账号 1000:1000 / 0600，应用只读挂载 `/run/secrets/push_credentials`；运行环境只登记路径 `PUSH_CREDENTIALS_PATH`。重复准备复用已有合法密钥，不自动轮换；不读取或输出文件内容。

开通时安装 `/srv/weiban/ops/current` 两槽固定运维副本，并用服务覆盖文件把每日备份、磁盘检查指向它。以后发布、备份、回滚只要配置路径存在就保留 `deploy/prod/push.override.yml`；运维入口独立于应用版本，避免退到老应用后丢挂载。**开通后手动回滚统一用 `bash /srv/weiban/ops/current/rollback.sh --list` / `1`**，不要再从旧应用源码调用旧脚本。普通发布会在切换前更新固定副本；无需每次加开通参数。

准备阶段不重启应用，不调整通知偏好、不代用户授权。文件合法且服务健康仅证明服务配置，苹果主屏幕应用实际授权、送达和点击返回仍需设备验证。普通数据库/媒体备份不复制密钥；目前仅保存服务器受保护的一份，服务器完全丢失后须重新生成并重新订阅，不自行外传或备份该凭据。

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

> 2026-11-03 04:59–05:08 数据盘写满，停站约 10 分钟：旧备份脚本先停应用、再往同一块数据盘写备份，写满后应用起不来。下面的规则据此制定（任务 T-20261103f）；备份次数、备份放系统盘、保留口径按总经理 11-03 的三点要求收紧（任务 T-20261103i）。

### 磁盘布局

| 盘 | 挂载点 | 放什么 |
|---|---|---|
| 数据盘 `/dev/vdb1`，40G | `/srv/weiban`（fstab 用 UUID） | `docker/`（Docker 数据：数据库卷、媒体卷、容器、日志）、`containerd/`（镜像层，Docker 29 默认放这里）、`releases/<提交>`（发版源码，`src` 软链接指向当前版本，`src.before-<短号>` 指向回滚用的旧版本）、`release-state/`（发版历史 `history.tsv`、每次切换前的 `runtime.env` 副本）、`secrets/`（0700）、`keys/`（只有备份公钥）、`runtime.env`、`deployment-version.txt`。旧的 `backups/` 只剩发版状态等手工存档，不再放备份 |
| 系统盘 `/dev/vda2`，50G | `/` | 操作系统；`/var/backups/weiban/`（每日与发版前备份）；`/var/backups/weiban-archive/`（11-03 从数据盘移来的旧备份，按 T-20261103i 交接确认后删除） |

备份和数据分在两块盘：备份写满系统盘时，数据库和应用照常写数据盘；数据盘满了也不会让备份写不下去。

占用参考（11-03）：每份完整备份约 3.2G（数据库约 0.12G，媒体约 3.1G）；每个应用镜像约 1.28G（多数层共用）；每个发版源码目录约 70M。

### 备份保留

| 规则 | 值 | 在哪里改 |
|---|---|---|
| 目标目录 | `/var/backups/weiban` | `weiban-backup.service` 的 ExecStart 参数 |
| 保留份数 | 最多 2 份完整备份。只算 `weiban-*` 名字的目录，别的名字的手工备份不自动清理、也不计入合计 | `weiban-backup.service` 的 `Environment=KEEP=2` |
| 合计上限 | 所有完整备份加起来不超过 10G，超了从最早的删起。最新这一份始终保留；只剩它一份也超过 10G 时保留它，后台登记「严重」提醒（合并键 `backup_over_cap:hk`），备份本身算成功、不挡发版 | `weiban-backup.service` 的 `Environment=BACKUP_MAX_TOTAL=10G`（可写 `500M` 或字节数） |
| 发版前备份 | 只有这次发版含数据库迁移、或 24 小时内没有完整备份时才做，见第四节「发版」 | `deploy/hk/release.sh` |
| 空间预检 | 上一份完整备份大小加 20%，再留 1G 底线；目录里还没有完整备份时，按当前数据库加媒体的大小估算 | 环境变量 `BACKUP_SPACE_MARGIN_PERCENT`、`BACKUP_RESERVE_BYTES` |
| 超时 | 45 分钟 | `weiban-backup.service` 的 `TimeoutStartSec` |

`deploy/hk/backup.sh` 的执行顺序：

1. 空间预检。不够就失败退出，**这时应用还没停**；后台出现「备份未完成：备份盘……空间不足……没有停应用」。
2. 停应用 → 导出数据库与媒体 → 马上恢复应用 → 写校验和与清单 → 删除超出 2 份或合计超过 10G 的旧备份（从最早的删起）。旧备份在新备份完成后才删，所以写备份那一刻最多同时有 3 份（约 10G）。
3. 中途任何一步失败、超时或被 `systemctl stop`：先删掉本次半成品，再启动原应用容器并等它健康，后台登记提醒；应用没能恢复健康时登记为「严重」。
4. 同一时间只跑一个备份（锁文件 `/run/lock/weiban-backup.lock`），撞上时后来的直接失败退出。

### 程序版本保留与发版后清理

口径（总经理 11-03）：**只留当前版本和最近 2 个可回退版本**，镜像和 `/srv/weiban/releases` 源码目录同一口径，多的删掉。`release.sh` 最后一步自动运行 `deploy/hk/release-prune.sh`；收到磁盘告警时也可以手动运行（先加 `--dry-run` 看清单）。

「可回退版本」按发版历史 `/srv/weiban/release-state/history.tsv` 的部署先后排：`release.sh`、`rollback.sh` 每次成功后追加一行（时间、动作、提交、源码树、两个镜像名和镜像 ID、源码目录），同一提交以最后一次部署为准。这样回滚后再发版，刚退回过的好版本排在前面，不会因为构建时间早就被清掉。第一次用 `release.sh` 时，它按 `deployment-version.txt` 和上次打的 `before-<短号>` 标签补记当前版和上一版。`rollback.sh --list` 列出的就是这份名单。

| 对象 | 保留 | 其余 |
|---|---|---|
| `weiban-app` / `weiban-edge` 镜像 | `runtime.env` 里 `APP_IMAGE` / `EDGE_IMAGE` 指向的当前版本；按发版历史最近 2 个可回退版本（历史里不够 2 个时按构建时间补足）；任何容器（包括已停止的）在用的镜像 | 删除标签，再清悬空镜像 |
| `:hk` 标签 | 每次清理都改指当前版本（它只是 `runtime.env.example` 的兜底名） | 原来指的旧镜像没有别的标签时作为悬空镜像清掉 |
| 构建缓存 | 24 小时内用过的（下次构建更快） | `docker builder prune` 清掉；`BUILD_CACHE_UNTIL=`（设为空）则全清 |
| `/srv/weiban/releases/` 源码目录 | 当前版本和 2 个可回退版本的目录（历史不够时按修改时间补足）、被任何容器挂载的目录 | 删除 |
| `releases/` 下的 `.tar` / `.tgz` 源码包 | 文件名里带保留版本目录名（前 12 位）的 | 删除；其他类型的文件不碰 |
| `/srv/weiban/src.before-*` 软链接 | 指向保留目录的；指向 `releases` 以外、仍存在的目录的（人工判断） | 指向已删除或已不存在目录的删除（只删链接本身） |

保留个数用环境变量 `KEEP_ROLLBACK_VERSIONS` 调（默认 2）。不碰：数据库、媒体卷、备份、postgres / caddy 等其他仓库的镜像、`/var/lib/weiban/releases`、`src.old*` 等历史目录（这些要人工判断）。

### 磁盘告警

| 项 | 值 |
|---|---|
| 检查对象 | 数据盘 `/srv/weiban`、系统盘 `/` |
| 频率 | 每 10 分钟（`weiban-disk-check.timer` → `deploy/hk/disk-check.sh`） |
| 阈值 | 达到 80% 警告，达到 90% 严重（环境变量 `DISK_ALERT_PERCENT`、`DISK_CRITICAL_PERCENT`） |
| 在哪看 | 管理后台「运行提醒」；服务器上 `journalctl -t weiban-ops` |

备份失败也走同一个通道（合并键 `backup_failed:hk`、`backup_app_down:hk`、`backup_over_cap:hk`）。注意：

- 这些提醒由服务器脚本直接写进数据库表 `push.admin_alerts`。契约 5.3 起后台「类型」列显示「磁盘空间不足」「备份失败」（更早的后台显示 `unsupported`，看「说明」列即可）；同一问题没点「已处理」之前只累加次数。
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
