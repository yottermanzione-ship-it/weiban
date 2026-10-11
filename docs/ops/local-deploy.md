# Windows 本机部署

总经理于2026-10-11选择先在自己的电脑运行，不使用外部服务器。复用生产镜像、迁移及持久化配置，Docker Compose项目名为`weiban-local`，与开发测试库独立。用户端`http://localhost:8080`，管理后台`http://localhost:8081`，仅绑定本机回环地址。localhost可用于浏览器PWA、相机与麦克风的安全上下文；仍需实际浏览器和设备验证。

## 在后台自行接入模型

2026-10-12总经理选择由后台填写URL和API Key，不需要配置文件或额外服务器。现有后台已提供接入入口；真实供应商尚未登记，连接成功和真实聊天必须在填写后另行验证。

1. 打开[上游管理](http://localhost:8081/upstreams)，以管理员登录（登录资料保存在仓库外`C:\wb-local\admin-login.json`）。填写显示名称、供应商提供的API基础地址和API Key，点「测试并保存」。基础地址需包含该供应商要求的路径，例如`/v1`；该入口采用OpenAI兼容协议。成功后只展示密钥掩码，输入框清空。
2. 打开[价目表](http://localhost:8081/prices)，以自己选定的模型键登记输入/缓存输入/输出等实际计费单位的价格并发布。模型键是应用内唯一标识，须与下一步完全一致。金额以人民币填写，成本价按实际供应商费用登记；发布新价目会替代原版，已有模型的价格也要保留。
3. 打开[模型目录](http://localhost:8081/catalog)，填写同一模型键、显示名称、出品方，选择刚登记的调用上游，再填写供应商的实际模型ID。选择确实支持的能力，勾选平台默认「聊天」「后台」，并在价格生效后勾选启用。识图等能力可另配有对应能力和价格的模型；不支持的能力不勾选。
4. 在用户端选择可用模型并发送消息，检查真实回复、用量和余额；后台「用量与费用」「运行提醒」核查失败原因。上游连接测试仅验证模型接口可达，不等于聊天生成、语音、识图或完整质量评测通过。

供应商API Key直接填在后台密码框；不要写到任务卡、Git或交接文档。保存后由现有平台密钥机制加密存储。本文操作说明基于当前实现，供应商真实连接和完整19类评测仍待配置后执行。

安装Docker Desktop并启动后，在独立开发副本中执行：

```powershell
& .\deploy\local\Start-Weiban.ps1
```

初次生成`C:\wb-local\runtime.env`与`secrets`中的数据库口令、连接串和加密主密钥，均在Git仓库外。再次启动不会覆盖秘密值或数据卷。`-PrepareOnly`仅准备及校验配置；`-SkipBuild`复用已有镜像。不要删除密钥，否则已有加密数据无法恢复。

2026-10-12补充启动保护：脚本先检查`weiban-local`已有数据卷；只要原秘密文件缺失就停止，即使`runtime.env`也同时丢失，不会生成替代密钥。已有真实数据卷下，使用不存在的临时配置目录验证拒绝且目录未生成；原配置`-PrepareOnly`仍通过。

本机整套备份：

```powershell
& .\deploy\local\Backup-Weiban.ps1 -RecipientFile C:\wb-local\backup-recipient.txt -AgeExecutable C:\wb-tools\age-v1.3.2\age\age.exe
```

应用会短暂停止以冻结写入，并在`finally`中恢复启动。数据库使用`pg_dump -Fc`，媒体以只读卷打包，随后用age公钥加密，生成SHA256清单；成功目录只有两份age密文及非秘密清单，不含KEK、数据库口令、登录资料或age私钥。默认保存到`C:\wb-local\backups`的唯一子目录；拒绝放在Git工作区内。失败目录没有完整清单，不应作为有效备份使用。`-ProjectName`支持隔离恢复演练，默认仅为`weiban-local`。

本机age来自[官方v1.3.2发布](https://github.com/FiloSottile/age/releases/tag/v1.3.2)，Windows包校验官方SHA256为`f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7`。只有公钥接收者文件放在运行目录。原KEK另存密码管理器或离线介质；age解密身份也应离线保存并与KEK分开。本次演练身份暂在`C:\wb-offline-keys\local-backup.agekey`，ACL仅本人及SYSTEM；目录名不代表已经离线转存，异机/离线保管仍待总经理完成。

只向全新隔离项目恢复，不覆盖正在使用的服务；需提供另行保存的原运行配置/KEK及age身份，并使用匹配的应用镜像：

```powershell
& .\deploy\local\Restore-Weiban.ps1 -BackupDirectory C:\安全数据备份目录 -IdentityFile C:\单独保管的身份文件 -ProjectName weiban-restore-check -AgeExecutable C:\wb-tools\age-v1.3.2\age\age.exe
```

恢复脚本只接受格式2的两份密文及匹配清单，拒绝已有目标卷；先解密、单事务恢复数据库与媒体，成功后启动app，不启动Caddy、不开放入口、不替换`weiban-local`。验证具体加密数据/媒体后再安排切换。失败保留隔离卷供检查，删除工作目录中的临时明文；不要向正在使用的项目执行`down -v`。

00:06原备份/数据库恢复确曾通过，但原实现把秘密与数据库同目录，违反安全规范，不能作为合规交付。00:11已纠正：两份旧备份中的秘密与登录资料移至单独的`C:\wb-key-custody\legacy-20261012`，限制本人/SYSTEM访问，原清单标为`legacy-manifest.invalid.json`。新格式2加密备份为`C:\wb-local\backups\20261012-001144-0ea9817b1c354ba78c3fe0e69f884962`，证据`local-encrypted-backup-round1.log`。原本机用户尚未录入加密数据，不将其空媒体备份记为媒体恢复通过。

非空媒体验证只在隔离恢复环境完成：真实HTTP上传64×64图片后加密备份，第二个全新项目恢复，使用原KEK和原账号登录、重新取得签名链接并实际解密下载88字节图片，SHA256与备份前内容一致。真实用户DEK及平台DEK共2条均经实际媒体接口使用。证据`local-nonempty-backup-round1.log`、`local-nonempty-restore-media-round1.log`；这验证本机恢复链路，不代表异机、异地或独立验收。

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

同日已升级至源码`e4f2180282aa95933df6d9aa2dc550d1349fa440`（素材用途、通话计时、评测登记和后台媒体代理），保留原账号、密钥与持久卷；迁移没有重复执行。双端登录/刷新及后台“日常照片”入口通过，跨入口非代理图片仍被原CSP拒绝。升级与浏览器证据为`local-deploy-upgrade-round1.log`、`local-upgrade-login-round1.log`、`local-upgrade-policy-ui-round1.log`；镜像ID与验证时间在仓库外`C:\wb-local\deployment-version.txt`。同域签名媒体实际上传/显示的回归在独立浏览器测试库完成，未给本机用户数据库注入测试角色或素材。

23:54已再次升级至源码`7365975f5fa90e296eaac8d022eb3f63bcc1aeaa`，包含导入生日/头像/分类和自定义音色编辑/运行时选择。镜像构建、服务健康、双端实际登录/刷新及新网页资源送达通过；证据`local-custom-voice-upgrade-round1.log`、`local-custom-voice-login-round1.log`、`local-custom-voice-installed-ui-round1.log`。用户账号仍在初始昵称引导，未绕过引导或注入测试角色/音色；正向完整创建/试听测试在独立probe数据库完成。

本机配置不自带供应商密钥、推送凭据或虚构角色数据。真实AI、语音、图片等服务需在后台配置并验证。备份应包含数据库、媒体卷与单独保存的原主密钥；恢复演练与外部上线另登记。本机首次构建、迁移、登录与重启持久化的实际结论以活动交接为准，不由本文预先宣称通过。
