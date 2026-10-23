# 旧配置受控接收与停用入库：第四步开发

> 本页登记接收端实现与发布回执。**尚未读取真实旧Key、执行真实导出或导入，不是ASR/TTS/通话已经开通。** 与[只读导出器](../refactor/2026-10-23-legacy-exporter-implementation.md)衔接，安全决定见[ADR](../decisions/ADR-20261023-legacy-config-export.md)。

## 实际实现

- 新增服务器维护CLI的prepare/plan/apply路径，不提供HTTP入口，不启动应用/worker，不使用会赠送余额/发布价格/改默认模型的本机开聊脚本。
- identity拥有的只读函数核对正常管理员ID，接收批次绑定同一操作者、批准的来源ID/vendor/HTTPS地址、证书指纹和一小时期限；未知字段、未映射env凭据、启用目标等均拒绝。
- 新接收私钥在新服务器内存生成，持久文件仅保存现有EnvelopeCrypto用新平台DEK/KEK封装的密文，AAD绑定批次及整个批准清单。不把私钥给旧机、本机或Git。
- OpenSSL跨平台互操作使用**标准加密PKCS8临时文件**，256位随机密码只在内存/stdin中，用后核对绝对路径、私有父目录和文件前缀再删除；没有明文私钥临时文件。这只用于现成工具互操作，不替代平台业务字段加密。
- 受控渠道给出的密文SHA必须匹配，只收CMS认证加密/GCM/OAEP，完整认证成功后才解析JSON；不把认证前的部分明文流直接入库。私有密文快照防文件竞态，plan不写上游/价格/默认。
- model-access拥有的停用导入器不调用普通create的供应商probe，只以新UUID写enabled=false/status=unavailable/lastTestedAt=null，并以upstream:{新UUID}重新seal。旧状态、旧ciphertext/主密钥不沿用，旧name/label不复制到新展示名或审计。
- 同批namespace生成确定的新UUID，事务批次锁、只插不改、同包接受标记及审计同事务，保证同包重入不会重复创建或覆盖管理员后来的修改；换包冲突、过期须重新审批。
- 不写模型目录、路由、价格、余额、用户偏好或声音绑定；env自动回退映射尚未实现，含env凭据的包会明确拒绝，不能默默漏掉或猜URL。
- 精简生产镜像显式安装OpenSSL/CA，仅为新服务器维护工具；不安装或修改旧机环境，不构建APK，不改HTTP/Android契约或数据库表结构。

## 文件

[私有格式校验](../../apps/server/src/modules/model-access/domain/legacy-import.ts)、[接收器](../../apps/server/src/modules/model-access/application/legacy-receiver.ts)、[停用入库服务](../../apps/server/src/modules/model-access/application/legacy-upstream-import.ts)、[维护CLI](../../apps/server/src/cli/import-legacy-upstreams.ts)、[相关合成测试](../../apps/server/src/modules/model-access/application/legacy-receiver.test.ts)。

## 实际发布回执

- 代码 `7b3a8ce1b008917737a153240b611c62590112c9` 已推送分支与远端main；来源闸门确认同时包含最新main及当时线上完整 `a09e678…`。
- 候选2736个Git blob逐项核验通过，仅规范化仓库既定的Windows脚本CRLF；补丁116,391字节，SHA256 `a7ed6aeab6aa9f547a6536f6830e184d2513bcec8aafddee230aed5f0ad1f6c9`。
- 首次镜像构建在执行到 `pnpm deploy` 时SSH连接被重置（错误为连接重置，不是构建失败），线上仍为旧版、未做任何切换；核对后确认暂存目录完整但无release镜像，改为**脱离终端的受保护构建**，先重跑同一blob核验再构建，未删除或重建暂存目录，也未放宽校验。第二次构建退出0。
- 发布进程退出0，前后台健康/HTTP200、crypto有效；无待执行迁移（仍0135_client_logs）。加密备份 `/srv/weiban/backups/weiban-20261023T080437Z-eRBG2m` 数据库与媒体均校验OK，状态 `/srv/weiban/backups/release-state-20261023T080437Z`，before镜像与前版目录保留。
- app `sha256:567837dad34a2363bc21bc03c9830923ff510f53e2878d701005e4b5ba47bd88`；edge `sha256:7990f52cb67a5c6b6186962c1da9f2c6ae3bc44374228032225925c3543f5b43`；运行目录 `/srv/weiban/releases/7b3a8ce1b008917737a153240b611c62590112c9-web`。
- 实机容器内确认OpenSSL 3.0.22存在、`dist/import-legacy-upstreams.js` 已打包（1,376,984字节），无参数返回 `ONE_ACTION_REQUIRED`、`--plan`缺参返回 `ARGUMENT_REQUIRED`，均退出1且**未连接数据库、未做任何写入**。这是安全性烟雾检查，不是真实导入演练。
- 输入图公开补查=1、角色自主网图=0，原设置未改；未重跑已通过的功能测试、全仓套件或APK。

## 检查边界

只运行本批相关类型/合成测试；不重跑前批UI、导出器11项、全仓或完整数据库套件。合成测试使用真实OpenSSL和平台EnvelopeCrypto，但数据库为明确的内存替身，不是已经在真实PostgreSQL或真实旧/新服务器做了导入验收。

CLI的备份回执标识是操作者的显式确认，**不是程序自动核验备份内容**；真实执行前仍须实际加密备份/校验、确认密文来源和证书交接方式、做真实数据库对接干跑。旧机仅公开证书如何交接尚须审定，不因代码就绪而默默扩大旧业务目录写权限。
