# Windows 本机部署

总经理于2026-10-11选择先在自己的电脑运行，不使用外部服务器。复用生产镜像、迁移及持久化配置，Docker Compose项目名为`weiban-local`，与开发测试库独立。用户端`http://localhost:8080`，管理后台`http://localhost:8081`，仅绑定本机回环地址。localhost可用于浏览器PWA、相机与麦克风的安全上下文；仍需实际浏览器和设备验证。

安装Docker Desktop并启动后，在独立开发副本中执行：

```powershell
& .\deploy\local\Start-Weiban.ps1
```

初次生成`C:\wb-local\runtime.env`与`secrets`中的数据库口令、连接串和加密主密钥，均在Git仓库外。再次启动不会覆盖秘密值或数据卷。`-PrepareOnly`仅准备及校验配置；`-SkipBuild`复用已有镜像。不要删除密钥，否则已有加密数据无法恢复。

本机覆盖配置显式设置`ALLOW_LOCAL_HTTP=1`，只允许媒体地址为`localhost`、`127.0.0.1`或`[::1]`时使用HTTP。生产默认要求HTTPS，包括未显式填写媒体地址的情况；外部HTTP地址不会因开启该选项而被放行。数据库及服务容器仍使用生产运行配置。

停止但保留数据：

```powershell
docker compose --project-name weiban-local --env-file C:\wb-local\runtime.env -f deploy/prod/compose.yml -f deploy/local/compose.override.yml stop
```

首次管理员使用生产CLI交互创建，命令行不附带密码：

```powershell
docker compose --project-name weiban-local --env-file C:\wb-local\runtime.env -f deploy/prod/compose.yml -f deploy/local/compose.override.yml exec app node dist/identity.js create-admin weiban_admin
```

2026-10-11已在本机实际创建首个管理员`weiban_admin`。登录信息位于仓库外`C:\wb-local\admin-login.json`，密码未写入本文或构建日志。已有账号无需再次创建。用户端也可用该账号登录，首次进入需填写个人昵称；普通账号由后台生成邀请码后自行注册。

本次实际验证：生产镜像构建、68项数据库迁移、数据库/加密健康检查、两个入口浏览器登录、刷新恢复会话以及重启三个常驻服务后重新登录通过。浏览器确认localhost为安全上下文，未出现控制台错误。证据位于`C:\wb-dev\closeout-logs\local-deploy-build-round2.log`、`local-browser-smoke-round2.log`、`local-deploy-restart-round1.log`及`local-browser-restart-round1.log`。这些是开发自测，未替代真实AI、媒体恢复演练或设备验收。

本机配置不自带供应商密钥、推送凭据或虚构角色数据。真实AI、语音、图片等服务需在后台配置并验证。备份应包含数据库、媒体卷与单独保存的原主密钥；恢复演练与外部上线另登记。本机首次构建、迁移、登录与重启持久化的实际结论以活动交接为准，不由本文预先宣称通过。
