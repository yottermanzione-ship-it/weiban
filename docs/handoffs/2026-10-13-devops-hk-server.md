# 交接说明：香港服务器仅 IP 部署与本机数据迁移

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 日期 | 2026-10-13 |

## 做了什么

结论：微伴已在香港服务器 `103.231.58.124` 运行，用户端 <http://103.231.58.124>，管理后台只在服务器本机 127.0.0.1:8081，经 SSH 隧道访问。本机数据（账号、余额、MiMo 上游与模型目录、9 个预设角色）已迁移。每日加密备份已启用，并做过一次恢复演练。总经理操作说明：[docs/ops/hk-server.md](../ops/hk-server.md)。

1. **数据盘**：vdb **不是空盘**：有 DOS 分区表和 vdb1（ext4）。只读检查结果：文件系统创建于 2026-10-12 23:57:26（与云厂商初始化同一分钟），**从未挂载过**，里面只有 `lost+found`。没有格式化，直接把现有 ext4 按 UUID `8c22e75a-…` 写入 fstab（`nofail`），挂到 `/srv/weiban`。Docker data-root 设为 `/srv/weiban/docker`。Docker 29 默认用 containerd 镜像存储，所以 containerd 的 root 也移到了 `/srv/weiban/containerd`；旧目录改名为 `/var/lib/containerd.old` 后保留，约 2.6G，确认无误后可删。
2. **系统**：Docker 29.9.0、Compose v5.6.0（官方 apt 源），已装安全更新（unattended-upgrades，之后也会自动装）。ufw 只放行 22/80，443 未开。fail2ban 的 sshd 规则：10 分钟内失败 5 次封 1 小时。日志轮转 20MB×5。SSH 端口、密码登录、root 密码都没动。
3. **代码最小改动**（分支 `devops/hk-ip-deploy`，已快进合入 local/trunk）：
   - 服务器新增显式开关 `ALLOW_IP_HTTP`。只有媒体地址的主机名是 IPv4 地址时才放行 HTTP，域名仍强制 HTTPS。另补了一条配置单测，本次没有运行。
   - 用户网页 `apps/web/src/app/secure-context-polyfill.ts`：在 HTTP 公网 IP 下，浏览器不提供 `crypto.randomUUID`，发消息等功能会直接报错。这里用 `getRandomValues` 补了一个等价实现；HTTPS 和 localhost 下不生效。
   - 新增 `deploy/hk/`：`compose.override.yml`（Caddy `:80` 对公网、`127.0.0.1:8081` 给后台、`ADMIN_PUBLIC_ORIGIN=http://localhost:9081`）、`runtime.env.example`、`server-setup.sh`（可重复执行，盘不符合预期会停止）、`backup.sh`、`weiban-backup.{service,timer}`。
4. **构建**：源码 `git archive` 传到 `/srv/weiban/src`，在服务器上构建，镜像 `weiban-app:hk`（b145ff7edba8）、`weiban-edge:hk`（9283faab1832）。源码版本为 local/trunk 2fe518b 加上本次改动，业务代码与本机运行的 314ca3e 一致。
5. **迁移**：用 `Backup-Weiban.ps1` 做了新的本机加密备份 `C:\wb-local\backups\20261013-001052-925fbf2b6536486c8e03669378f02489`（本机 app 短暂停止后已自动恢复）。备份经 scp 传到服务器，sha256 与清单一致。在空的 `weiban-prod` 项目里只启动 postgres，单事务 `pg_restore`，媒体解到新卷后再启动。迁移结果「没有需要执行的迁移」，/health 中 database 和 crypto 均正常。数据核对：用户 2（含 lomjy3）、角色 9、上游 1、目录模型 1（MiMo V2.6 Flash）。解密用的明文临时文件已 shred；服务器上的 age 身份用完已 shred。
6. **机密**（只经 scp 传输，未打印）：`/srv/weiban/secrets/kek`（与本机同一把，属主 1000，600）、`postgres-password`（服务器新生成，属主 999，600）、`database-url`（属主 1000，600）、`/srv/weiban/runtime.env`（600）。`/srv/weiban/keys/` 只放备份公钥。
7. **备份**：systemd 定时器每天 04:00（香港/北京时间）运行 `deploy/hk/backup.sh`，格式与 `deploy/prod/scripts/backup.sh` 相同（v1），保留 7 份，存放在 `/srv/weiban/backups`。用总经理电脑上的 age 公钥加密，服务器上没有解密身份。已手动跑过一次（`weiban-20261012T164958Z-44C63I`）。
8. **恢复演练**：临时放入 age 身份，用 `deploy/prod/scripts/restore.sh` 把上面这份备份恢复到全新项目 `weiban-restore-check`。结果：app 健康，用户 2、lomjy3 1、角色 9、媒体文件 1。演练项目及其卷已删除，age 身份已 shred。
9. **验证**：公网首页 200（标题「微伴」）、`/health` ok；公网 8081 无法访问；用户域 `/admin` 返回 404。隧道 `localhost:9081` 后台首页 200（「微伴管理后台」）。原管理员账号的 admin 登录、`/api/v1/me`、上游/目录列表、退出均通过。没有创建账号，没有调用 AI。

## 改了哪些文件

- 新增：`deploy/hk/compose.override.yml`、`deploy/hk/runtime.env.example`、`deploy/hk/server-setup.sh`、`deploy/hk/backup.sh`、`deploy/hk/weiban-backup.service`、`deploy/hk/weiban-backup.timer`、`apps/web/src/app/secure-context-polyfill.ts`、`docs/ops/hk-server.md`、本交接
- 修改：`apps/server/src/platform/config/config.ts`、`apps/server/src/platform/config/config.test.ts`、`apps/web/src/main.tsx`、`deploy/README.md`
- 仓库外（服务器）：`/etc/fstab`、`/etc/docker/daemon.json`、`/etc/containerd/config.toml`、`/etc/fail2ban/jail.d/sshd.local`、ufw 规则、`/etc/systemd/system/weiban-backup.*`、`/srv/weiban/*`

## 遗留问题

- **纯 HTTP**：登录密码和聊天内容以明文在公网传输。浏览器在 HTTP 下禁用麦克风/摄像头（语音通话、语音输入）、PWA 安装、离线缓存、网页推送和部分剪贴板功能。只适合总经理自己试用。
- 用户端只做了首页和 health 检查，没有在浏览器里实际登录、发消息（任务要求不调用 AI）。randomUUID 兜底只经过构建，尚未在真实 HTTP 页面里点击验证。
- 没有跑测试套件，新加的配置单测也未运行，以 CI 为准。
- 备份只存在服务器同一块数据盘上，没有异地副本，需要总经理定期下载（见操作说明第三节）。
- 没有监控告警（如服务宕机通知），没有做重启服务器后的自启实测（各容器均设了 `restart: unless-stopped`）。
- `/var/lib/containerd.old`（约 2.6G）和 `/srv/weiban/migration/`（本机格式 2 加密备份副本）留在服务器，可以删除。
- 本机 `Backup-Weiban.ps1` 如果在 PowerShell 5.1 里加 `2>&1` 运行，docker 的提示输出会被当成错误而中断；脚本会自动把 app 拉起来，但会留下一个空目录（本次已删除）。直接运行（不加重定向）正常。
- 收尾时为关闭本地隧道执行了 `taskkill /IM ssh.exe`，可能顺带关掉了总经理电脑上当时打开的其他 ssh 窗口，如有请重新连接。

## 需要总经理决定的事

- 是否同意加固 SSH：禁用密码登录（只留密钥）。目前只有 fail2ban 防暴力破解。改端口、改 root 密码同样需要同意。
- 域名：有域名后才能上 HTTPS，解决上面的明文传输和功能限制。

## 给其他负责人的交接

- 给项目总负责人：服务器部署信息以 `docs/ops/hk-server.md` 为准。本机部署未改动，仍在运行。现在两边各有一份数据，**以后会各自变化**，需要决定以哪边为主，建议今后只用服务器。
- 给后端：新增环境变量 `ALLOW_IP_HTTP`（只放行 IPv4 主机名的 HTTP 媒体地址），位于 `apps/server/src/platform/config/config.ts`。
- 给 Web：新增 `secure-context-polyfill.ts`。如果以后网页用到其他只在安全上下文可用的 API，在 HTTP 试运行下需要降级处理。
- 给 Codex：本次改动未经独立验收。
