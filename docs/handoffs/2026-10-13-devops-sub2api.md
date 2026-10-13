# 交接说明：香港服务器部署 sub2api（ADR-0031 方案 A 第 1 天验证·运维部分）

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 日期 | 2026-10-13 |

## 做了什么

结论：sub2api 已在香港服务器运行，只绑定服务器本机 127.0.0.1:8090，公网访问不到。微伴 app 可以通过内部网络访问它（`http://sub2api:8080`）。没有密钥也能检查的项都已检查完，**但开户三步被卡住了**：sub2api 所有管理员接口在总经理确认合规承诺之前都返回 423（锁定），所以「管理员建用户 → 登录 → 建 Key」要等总经理确认后才能验证。另外在只读检查中发现：有人在服务器上装了宝塔面板，并加开了多个公网端口（见第 4 节）。

### 1. 部署

- 动手前先做了微伴加密备份：`/srv/weiban/backups/weiban-20261013T040441Z-Oj87mi`。
- 基于官方 `docker-compose.local.yml`（v0.2.15）改写为 `deploy/hk/sub2api/compose.yml`，三个镜像都固定了版本：
  - `weishaw/sub2api:0.2.15`（`sha256:da0fd94daebf…`）
  - `postgres:18.6-alpine`（`sha256:77f585114c32…`）
  - `redis:8.10.2-alpine`（`sha256:3811787313eb…`）
- 部署方式：独立 Compose 项目 `sub2api`，独立的 PostgreSQL 和 Redis。数据放在数据盘 `/srv/weiban/sub2api/`（`data/`、`postgres_data/`、`redis_data/`）。
- 资源上限：sub2api 512M、PostgreSQL 512M、Redis 128M（Redis 另设 maxmemory 96mb）。实际占用约 22M + 127M + 6M，CPU 低于 1%。
- 秘密由 `deploy/hk/sub2api/setup.sh` 随机生成，写入 `/srv/weiban/sub2api/.env`（root 600），包括数据库口令、Redis 口令、JWT、TOTP 密钥、管理员邮箱和密码。
- **管理员登录资料：`/srv/weiban/secrets/sub2api-admin.txt`（root 600）**，未打印，也未写进仓库。管理员邮箱是随机的、不可猜。
- 新建 `--internal` 网络 `weiban-llm`（不能出公网），sub2api 以别名 `sub2api` 加入。`deploy/hk/compose.override.yml` 让微伴 app 也加入这个网络；app 已重建，微伴健康检查正常。
- 每日备份 `deploy/hk/backup.sh` 增加了 sub2api 数据库的 age 加密 dump（`sub2api.dump.age`，计入 SHA256SUMS）。手动跑了一次，三份文件校验都 OK。

### 2. 验证结果（对照 05 文档第 6 节）

| 项 | 结果 |
|---|---|
| 服务起来 / 健康检查地址 | 通过。`GET /health` 返回 `{"status":"ok"}`，服务器本机约 40ms，微伴 app 容器内访问约 80ms（含首次连接） |
| 资源占用 | 通过。三个容器合计约 155MB |
| 只绑本机、不开放公网 | 通过。只监听 `127.0.0.1:8090`，公网 `:8090` 无响应；经隧道打开后台首页 200，标题「Sub2API - AI API Gateway」 |
| 微伴 app 内网访问 | 通过。app 访问 `http://sub2api:8080/health` 返回 200；不带 Key 访问 `/v1/models` 返回 401 `API_KEY_REQUIRED`，转发链路是通的 |
| 管理员登录（脚本方式） | 通过。`POST /api/v1/auth/login` 无验证码，直接拿到 JWT |
| 验证码 / 邮箱验证是否拦截 | 不拦截。默认设置下 turnstile、腾讯、阿里验证码都关闭，邮箱验证关闭，邀请码关闭，后端模式关闭，**公开注册关闭**（正合方案要求） |
| 管理员 API 可用 | **被锁**。`/api/v1/admin/compliance` 显示 required=true（版本 v2026.06.10）；建用户、查用户、查分组、读设置都返回 423 `ADMIN_COMPLIANCE_ACK_REQUIRED`。管理员 API Key 也只能在后台生成，同样被锁 |
| 开户三步（建用户 → 登录 → custom_key 建 Key）、重复执行幂等 | **待总经理确认合规承诺后验证**。目前能确认的是：登录接口无验证码；公开注册关闭，所以用户只能由管理员建。我没有建任何用户 |
| 上游凭据是否静态加密 | 读源码：`accounts.credentials` 是 JSONB，**未见加密**（与 ADR 记载一致）。录入密钥后再查库确认一次 |
| 内容留存 | 内容审核（content moderation）默认关闭，库里没有对应设置行。后台审计日志会保存脱敏后的请求体（最多 16KB），从路由看只覆盖管理操作，网关调用是否被记录待录入密钥后实测 |
| MiMo 经 sub2api 非流式 / 流式、usage、思考关闭透传、识图 | **待总经理录入密钥后验证** |
| 按用户查用量 / 成本按渠道价 | **待总经理录入密钥后验证** |
| 标准模式预置余额扣减、不触发 403；对比 simple 模式 | **待验证**，需要管理员 API 和密钥。当前为 `RUN_MODE=standard` |
| 转发延迟 | 内网单跳毫秒级（health 约几十毫秒）；真实转发延迟**待录入密钥后测** |

### 3. 发现的阻塞点（交后端 / 架构）

- **微伴生产环境拒绝 `http://` 上游地址。** `apps/server/src/modules/model-access/domain/rules.ts` 中的 `checkBaseUrl` 规定生产只允许 https。所以 05 文档规划的上游地址 `http://sub2api:8080/v1` 现在登记不进去。需要在 CR-31-1 里给 `sub2api` 类型或内部网络地址开个口子，例如只放行指定的内部主机名。我没有改代码。

### 4. 宝塔面板（只读检查，未做任何处理）

- **谁装的**：2026-10-13 01:41:11，root 的 `authorized_keys` 被加入第二把公钥，备注为 `hatch`（指纹 `SHA256:457nBbV6Bonyml6dJXxaF9tb3WMSdqnVQryn8fm+i88`）。01:41～01:49 这把钥匙从 `104.29.x.x` 段（6 个不同 IP）登录了 8 次。宝塔在 01:42:54～01:43:40 安装（安装日志 `/tmp/btpanel-install.log`，宝塔 9.0 LTS 稳定版）。时间完全吻合，**是持有 `hatch` 钥匙的人装的**。这不是我们的部署钥匙（我们的是 `weiban-deploy@lomjy3-pc`），我无法判断是谁。
- **另有一次 root 密码登录**：02:11:13 从 `43.198.175.167` 用**密码**登录成功。说明有人知道 root 密码；可能是总经理或云厂商网页控制台，需要确认。今天另有约 180 次失败的密码尝试，fail2ban 累计封禁 40 个 IP。
- **宝塔改了什么**：
  - 加开 ufw 端口 20、21、443、888、11823、39000-40000（IPv4 和 IPv6）。
  - 新建系统用户 `www`（uid 1000，不能登录）。
  - 改了 `/etc/hosts`、`/etc/apt/sources.list`、`/etc/wgetrc`。
  - 新增 `site_total.service`、`BT-Panel`、`BT-Task` 进程。
- **对公网是否可达**：是。`BT-Panel` 监听 `0.0.0.0:11823`，ufw 已放行，云厂商安全组也没拦：从外网 `https://103.231.58.124:11823/` 能连上（返回 404，这是宝塔安全入口路径之外的正常响应）。888 端口在 ufw 中放行，但目前没有服务在监听。
- **对微伴的影响**：`www` 用户的 uid 1000 与微伴容器内 node 用户相同，所以 `/srv/weiban/secrets/kek`、`database-url` 在宿主机上显示属主为 `www`。但 `secrets/` 目录是 0700 root，`www` 进不去，目前读不到。宝塔一旦安装网站环境（nginx/php 以 www 身份运行），需要重新评估。
- 运维 `hk-server.md` 原来写的「ufw 只放行 22/80」已经不成立，已加注。

### 5. 给总经理的命令

- 打开 sub2api 后台：`ssh -i ~/.ssh/weiban_deploy -N -L 9090:127.0.0.1:8090 root@103.231.58.124`，然后浏览器开 http://localhost:9090
- 查看管理员登录资料：`ssh -i ~/.ssh/weiban_deploy root@103.231.58.124 "cat /srv/weiban/secrets/sub2api-admin.txt"`
- 桌面快捷方式模板（新建快捷方式 → 对象位置）：

  ```text
  C:\Windows\System32\OpenSSH\ssh.exe -i %USERPROFILE%\.ssh\weiban_deploy -N -L 9090:127.0.0.1:8090 root@103.231.58.124
  ```

  名称填「sub2api 后台」。双击后保持黑色窗口打开，浏览器开 http://localhost:9090。微伴后台的快捷方式把 `9090:127.0.0.1:8090` 换成 `9081:127.0.0.1:8081`。

## 改了哪些文件

- 新增：`deploy/hk/sub2api/compose.yml`、`deploy/hk/sub2api/setup.sh`、本交接
- 修改：`deploy/hk/compose.override.yml`（app 加入 `weiban-llm`）、`deploy/hk/backup.sh`（备份 sub2api 数据库）、`docs/ops/hk-server.md`（新增 sub2api 一节、桌面快捷方式说明、安全现状加注）
- 服务器：`/srv/weiban/sub2api/*`、`/srv/weiban/secrets/sub2api-admin.txt`、Docker 网络 `weiban-llm`、上述脚本同步到 `/srv/weiban/src`

## 遗留问题

- 第 2 节标「待…」的各项都要等总经理确认合规承诺、录入 MiMo 密钥之后，由运维和后端继续验证；之后还要在 sub2api 里建 `weiban-platform`、`weiban-unassigned` 两个用户。
- sub2api 的 `.env`（JWT/TOTP/数据库口令）不在备份里，需要另行离线保管。sub2api 备份还没做恢复演练（目前是空库）。
- 上游 URL 白名单（`SECURITY_URL_ALLOWLIST_*`）保持官方默认（关闭），等确定 MiMo 域名后再开。
- 第 3 节「微伴拒绝 http 上游」不解决，就无法把微伴接到 sub2api。
- 本地 Docker 镜像和本机部署没有加 sub2api；05 文档第 7 节第 2 步说「本机部署同样加一份」，本次未做。

## 需要总经理决定的事

- **服务器上的宝塔面板和 `hatch` 钥匙是不是您装的？** 02:11 那次 root 密码登录是不是您？如果都不是，服务器可能已被他人控制，应立即在云厂商控制台改 root 密码、删除 `hatch` 钥匙并排查。如果是您装的：宝塔管理端口 11823 和 FTP 21 现在对公网开放，建议只在需要时开放，或者卸载宝塔。另外，宝塔与 Docker 部署的微伴混装有冲突风险（端口 80/443、用户 uid 1000）。
- 是否同意禁用 SSH 密码登录（今天约 180 次暴力尝试，而且有一次密码登录成功）。
- 在 sub2api 后台亲自确认合规承诺、开启两步验证、录入 MiMo 密钥（05 文档第 9 节）。

## 给其他负责人的交接

- 给项目总负责人：sub2api 已部署，验证卡在合规承诺。宝塔和陌生钥匙的问题请尽快向总经理确认。
- 给后端 / 架构：`checkBaseUrl` 在生产环境拒绝 http 上游（第 3 节），CR-31-1 需要处理。sub2api 登录接口无验证码、公开注册已关闭，开户流程必须走管理员建用户这条路；登录接口限流 20 次/分钟。
- 给运维（后续）：总经理确认合规承诺后，跑开户三步和幂等检查，并做 sub2api 恢复演练。
