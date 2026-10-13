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

“隧道”的意思：把服务器上只给自己看的 8081 端口，经加密的 SSH 连接搬到你电脑的 9081 端口。本机部署占用了 8081，所以这里用 9081。

## 二、HTTP（无 HTTPS）期间的限制

- 浏览器地址栏会显示“不安全”，网络上的人理论上能看到传输内容（含登录密码）。**只适合自己试用，不要拉真实用户**。
- 浏览器在非 HTTPS 下禁用：麦克风/摄像头（语音通话、语音输入不可用）、安装为 App（PWA）、离线缓存、网页推送通知、部分复制到剪贴板。
- 有域名后：域名解析到本 IP → 运维改用生产 Caddy 自动签证书、开 443、去掉 `deploy/hk/compose.override.yml` 的 IP 模式。

## 三、备份

- 每天香港时间 04:00 自动加密备份到数据盘 `/srv/weiban/backups/weiban-时间-随机串/`，只保留最近 7 份。备份时应用会停几十秒。
- 备份用你电脑上那把 age 公钥加密；**服务器上没有解密钥匙**，所以别人拿到备份文件也打不开。解密钥匙仍在你电脑 `C:\wb-offline-keys\local-backup.agekey`，请另存一份到 U 盘/密码管理器。
- 主密钥（KEK）在服务器 `/srv/weiban/secrets/kek`，与本机 `C:\wb-local\secrets\kek` 是同一把。丢了它，备份里的加密数据无法恢复，务必离线另存。

**把最新备份下载回自己电脑**（PowerShell）：

```powershell
# 1. 看看服务器上有哪些备份
ssh -i ~/.ssh/weiban_deploy root@103.231.58.124 "ls -1 /srv/weiban/backups"
# 2. 下载最新一份到 D:\weiban-hk-backups（文件夹不存在会自动创建）
New-Item -ItemType Directory -Force D:\weiban-hk-backups | Out-Null
$latest = ssh -i ~/.ssh/weiban_deploy root@103.231.58.124 "ls -1d /srv/weiban/backups/weiban-* | tail -1"
scp -i ~/.ssh/weiban_deploy -r "root@103.231.58.124:$latest" D:\weiban-hk-backups\
```

每份里有 `database.dump.age`、`media.tar.age`（加密）、`SHA256SUMS`、`manifest.txt`。

**立即手动备份一次**：

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
systemctl list-timers weiban-backup.timer   # 下次备份时间
```

**升级到新版本**：本机 `git archive --format=tar.gz -o src.tgz <版本>` → scp 到服务器 → 先手动备份 → 解压覆盖 `/srv/weiban/src` → `$C build && $C up -d --wait`。

**恢复**（只恢复到新的空项目，不覆盖在用的）：

```bash
export WEIBAN_DEPLOY_ENV=/srv/weiban/runtime.env WEIBAN_COMPOSE_PROJECT=weiban-restore-xxx
docker compose -p $WEIBAN_COMPOSE_PROJECT --env-file $WEIBAN_DEPLOY_ENV -f deploy/prod/compose.yml up -d --wait postgres
bash deploy/prod/scripts/restore.sh /srv/weiban/backups/weiban-某份 /临时放置的age身份文件
```

然后带 `deploy/hk/compose.override.yml` 启动 app 检查；age 身份用完立即删除。

## 五、重建服务器

1. `scp deploy/hk/server-setup.sh` 到新服务器并 `bash server-setup.sh`（挂载数据盘、装 Docker/ufw/fail2ban、安全更新；数据盘为空时需显式 `FORMAT_EMPTY_DISK=1` 才格式化）。
2. 上传源码到 `/srv/weiban/src`，复制 `deploy/hk/runtime.env.example` 为 `/srv/weiban/runtime.env`。
3. 恢复秘密：`/srv/weiban/secrets/kek`（属主 1000，600）、新生成 `postgres-password`（属主 999，600）与对应 `database-url`（属主 1000，600）。
4. 构建、启动 postgres、按第四节恢复数据、再 `up -d --wait`。
5. 安装备份定时器：复制 `deploy/hk/weiban-backup.{service,timer}` 到 `/etc/systemd/system/`，`systemctl enable --now weiban-backup.timer`；公钥放 `/srv/weiban/keys/backup-recipient.txt`。

## 六、磁盘布局

数据盘 `/dev/vdb1` 挂在 `/srv/weiban`（fstab 用 UUID）：`docker/`（Docker 数据，含数据库与媒体卷）、`containerd/`（镜像层）、`backups/`、`secrets/`（0700）、`keys/`（只有备份公钥）、`src/`（部署源码）、`runtime.env`。系统盘只放操作系统。

## 七、sub2api 模型中转（ADR-0031 验证阶段，2026-10-13 部署）

**打开 sub2api 后台**（PowerShell，窗口保持打开）：

```powershell
ssh -i ~/.ssh/weiban_deploy -N -L 9090:127.0.0.1:8090 root@103.231.58.124
```

浏览器开 <http://localhost:9090>。管理员邮箱和密码在服务器文件 `/srv/weiban/secrets/sub2api-admin.txt`，查看方法：

```powershell
ssh -i ~/.ssh/weiban_deploy root@103.231.58.124 "cat /srv/weiban/secrets/sub2api-admin.txt"
```

首次登录后：阅读并**亲自确认**《部署与运营合规承诺》（不确认，所有管理功能都被锁定）→ 开启两步验证（2FA）→ 再录入上游密钥。只接正规按量付费的 API Key，不接 Claude/ChatGPT 等订阅账号。

**桌面快捷方式**：桌面右键 → 新建 → 快捷方式，“对象位置”填下面一行，名称填「sub2api 后台」。双击后会打开一个黑色窗口（这就是隧道，别关），再用浏览器开 <http://localhost:9090>：

```text
C:\Windows\System32\OpenSSH\ssh.exe -i %USERPROFILE%\.ssh\weiban_deploy -N -L 9090:127.0.0.1:8090 root@103.231.58.124
```

微伴后台同理，把 `9090:127.0.0.1:8090` 换成 `9081:127.0.0.1:8081`，浏览器开 <http://localhost:9081>。

**服务器上的位置**：`/srv/weiban/sub2api/`（`compose.yml`、`.env` 秘密 600、`data/`、`postgres_data/`、`redis_data/`），独立 Compose 项目 `sub2api`，镜像固定 `weishaw/sub2api:0.2.15`、`postgres:18.6-alpine`、`redis:8.10.2-alpine`；只绑 `127.0.0.1:8090`；微伴 app 经内部网络 `weiban-llm` 用 `http://sub2api:8080` 访问。每日备份同时加密备份 sub2api 数据库（`sub2api.dump.age`）。`.env` 里的 JWT/TOTP 密钥与数据库口令不在备份内，和 KEK 一样需另行保管。

```bash
cd /srv/weiban/sub2api && docker compose -p sub2api ps        # 状态
docker compose -p sub2api logs --tail 100 sub2api               # 日志
```

升级：改 `deploy/hk/sub2api/compose.yml` 的版本号 → 先备份 → `bash deploy/hk/sub2api/setup.sh`。**不要用后台的“在线升级”按钮。**

## 八、安全现状

- 防火墙 ufw 只放行 22、80（443 预留未开）；后台只绑定服务器 127.0.0.1，数据库只在容器内部网络。
- 注意（2026-10-13 发现）：有人另装了宝塔面板并在 ufw 加开 20、21、443、888、11823、39000-40000，见 sub2api 交接。
- fail2ban 保护 SSH：10 分钟内失败 5 次封 1 小时。
- 系统自动安装安全更新（unattended-upgrades）。
- 尚未做（需总经理同意）：禁用 SSH 密码登录、改 SSH 端口、改 root 密码。
