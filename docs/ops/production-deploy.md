# 香港单机部署底座（T-033 / D-L0-14、15）

这一部分是可构建与本机恢复演练的部署交付。域名、香港节点、供应商密钥、TLS公网签发及真实S3需要配置后的部署实测，不能以本机自测代替。产品尚在开发，PR保持草稿，不直接将本分支发布给正式用户。

## 文件与网络

`deploy/prod/Dockerfile`用固定Node24.19.0/pnpm11.28.4、冻结锁文件构建服务及两套网页；`pnpm deploy --prod --legacy`生成只含生产依赖、dist和迁移的运行包。app以node用户运行，只读根文件系统、无额外capability，媒体与/tmp单独可写。Caddy2.10.2独立镜像包含网页静态产物，同域`/api`反向代理、TLS、安全头和SPA回退；用户网页与管理后台不同域名。数据库只在内部Docker网络，app另有出口网络调用供应商；只有Caddy对公网开放80/443。

配置文件复制`deploy/prod/runtime.env.example`到仓库外，例如`/srv/weiban/runtime.env`，填实际域名和平台每日成本上限。秘密放`SECRETS_DIR`：`postgres-password`（数据库密码）、`database-url`（完整连接串，密码URL编码）、`kek`（32字节随机数的base64/hex）。app UID1000必须能读后两份秘密文件，主目录限制其他用户访问；本机Compose秘密挂载保留宿主权限，不能只依靠YAML的mode。密码不进入镜像、Compose环境输出或日志。秘密备份与数据库备份分开。

## 初始化与升级

以下命令在仓库根目录，`prod`表示已完成的实际配置文件：

```bash
docker compose --env-file /srv/weiban/runtime.env -f deploy/prod/compose.yml build
docker compose --env-file /srv/weiban/runtime.env -f deploy/prod/compose.yml up -d --wait
```

postgres首次只建生产库并开启vector；migrate一次性任务持咨询锁执行未运行迁移，成功后app才启动；app健康检查校验数据库和主密钥，Caddy等app健康。正式升级先完成加密备份，停止写入，拉取通过CI的明确版本，重建镜像并重新执行migrate，再启动。数据库迁移通常不可只靠旧镜像回退：如新版本验证失败，保持服务停止，从升级前数据库/媒体备份恢复到新卷并使用匹配KEK。不要对真实卷执行`down -v`。

首次管理员：`docker compose ... exec app node dist/identity.js create-admin 管理员账号`，交互输入密码，不把密码写进参数。登录管理后台登记并测试供应商、核实价格后发布、再启用目录模型。种子价只是草稿，DeepSeek分时价格和所有真实供应商要先核实，不能直接计费。初始化验证：用户/管理两个域名静态页、`/health`、管理员登录、加余额、上游实测、建角色/真实评测和用户页面。

## 备份与恢复

运维节点安装`age`（BSD-3-Clause）、Docker Compose和系统tar/sha256sum。age公钥在节点上，解密身份离线保存、与KEK分开。每日备份安排在维护窗口（该脚本暂停app后恢复原运行状态），并复制到独立异地存储：

```bash
export WEIBAN_DEPLOY_ENV=/srv/weiban/runtime.env
export BACKUP_AGE_RECIPIENT=age1实际离线公钥
bash deploy/prod/scripts/backup.sh /srv/weiban/backups
```

每个bundle有加密的PostgreSQL自定义dump、加密媒体tar、密文SHA256清单和非秘密manifest；默认0600/0700，pipefail，未成功的partial不冒充完成备份。当前脚本针对磁盘驱动和单app，若增加独立worker须同时暂停，若切S3须配对象版本备份后再修订脚本。

恢复先在新的Compose项目/空数据库与空媒体卷上，仅启动postgres；准备同版本应用镜像及匹配KEK，不启动app。将`WEIBAN_COMPOSE_PROJECT`改为恢复项目，并用其配置文件（镜像标签、域名和秘密目录与恢复目标对应）运行：

```bash
bash deploy/prod/scripts/restore.sh /安全目录/可信备份bundle /安全目录/离线age身份
```

脚本拒绝非空数据库或媒体卷，校验密文哈希后解密；数据库restore为单事务，失败停止；媒体失败时保留服务停止，废弃此次恢复卷并重新演练，不自动覆盖。恢复后检查迁移状态和KEK只读校验，再启动并核对账号/余额、媒体下载及历史加密数据。确认恢复才切域名；旧节点与旧备份继续保留。没有恢复演练的备份不登记为已验证。

### 可选推送通道（T-040）

默认部署不登记推送厂商凭据，登记设备/读取 VAPID 公钥返回明确的未配置响应；聊天仍通过数据库和同步链路送达。开启通道时，在部署主机创建 app UID1000 可读的 JSON 文件（例如文件所有者 UID1000、权限0600，宿主父目录0700；本机Compose保留宿主文件权限），通过 `PUSH_CREDENTIALS_PATH` 指定绝对路径，并叠加 `deploy/prod/push.override.yml`。Compose 仅向 app 挂载只读 secret，凭据不放进镜像、数据库、Git 或网页配置。

文件可同时包含 `webpush: {subject, publicKey, privateKey}` 与 `jpush: {appKey, masterSecret}`；只配置其中一个也可以。Web Push 的 subject 使用可联系的 `mailto:` 或 HTTPS 地址，密钥按 web-push 的 VAPID 规范生成。安卓当前只实现极光 REST，其他厂商在登记时返回尚未配置，不伪装可用。修改文件后重新创建 app 容器以读取新凭据。

```sh
PUSH_CREDENTIALS_PATH=/absolute/private/push.json docker compose \
  --env-file /absolute/private/runtime.env \
  -f deploy/prod/compose.yml -f deploy/prod/push.override.yml up -d app
```

Web Push 限定已知厂商 HTTPS endpoint；DNS 必须为公共地址，此次连接固定解析地址且校验原厂商 TLS 主机。厂商单次请求预算含 DNS 共 1.5 秒，响应上限 4 KiB，不跟随重定向。极光消息覆盖使用官方 `override_msg_id`，厂商 long 消息 ID 原样存储、输出数值，避免浮点精度损失。成功表示厂商接收，不能当成手机展示或用户已读。

开发夹具已验证实际 HTTP 请求、Web Push 独立解密及 VAPID 签名、极光请求及失效码；测试网络端口仅在测试装配替换，不引入生产 HTTP/私网豁免。真实厂商配额、iOS 主屏幕 PWA、安卓厂商离线通道和真机通知展示仍需后续设备验收。
