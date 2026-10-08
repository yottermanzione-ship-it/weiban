# T-045 安卓通知与构建环境

2026-10-08，Codex临时开发接管；独立分支 `dev/android-t041-push`，继承PR #4/#5/#6，测试库 `weiban_test_pm`，日志 `/workspace/logs/wb-android-*`。总经理指定以GitHub/云端为准；未取得Windows未提交成果，接续保留的Codex云端安卓WIP，原副本不改动。

范围按GitHub状态：JDK21/SDK36/Gradle实际构建环境与文档；原生测试通道完整链路（设备注册、通知渠道、96px头像、点击会话、去重、免打扰）；T041剩余通知设置与模式选模型入口。复用现有通知契约，无contracts变更。厂商通道可选接入，未配置/不支持时不虚假开启；真实密钥和真机投递另验。

PushTransport测试实现只替代厂商token服务，实际Room、归属锁、HTTP设备注册、WorkManager数据/Worker、NotificationManager/渠道/PendingIntent及Bitmap保持真实模拟平台实现。SDK回调对象测试不冒充FCM网络投递。保持静态/锁文件/零跳过门禁，格式任务单独完成后才检查。提交推送、读源码CI后写交接，开发自测与独立验收分开。

## 开发自测进度

已实现可选FCM安装ID注册/回调、设备注册解绑、归属/TTL/安全路由、账号切换与迟到任务保护、Room待展示/收据和ID-only WorkManager、受控OS渠道/点击、私有头像优先及96px透明圆角导出；最新设置/账号时区/会话静音/成人预览在展示时核对。新消息通知保存声音/预览/免打扰时段，聊天信息可直接进入模型选择。本机构建说明已写入 `docs/android/local-build-setup.md`，Windows未实测。

本机完整 `ktlintCheck detekt testDebugUnitTest :core:contracts-generated:test assembleDebug --write-locks --no-daemon` 在native13成功（2分52秒），JUnit门禁118条通过、跳过0（junit1），APK实际生成。去掉write-locks后的首次锁定复验发现通知设置测试在初始读取完成前输入，保留生产加载保护并改为等待全部控件可交互；正常锁定locked2完整成功（1分17秒），不延长原waitUntil期限。新增推送、SDK回调及头像套件均列入必跑门禁，Windows报告路径也做分隔符归一化。

此前失败修正：整理分支/参数/文件结构以满足原静态阈值；补正确的network ContractJson导入与nullable会话ID；升级到SDK25.1.3新注册API，未关闭warnings-as-errors；通知持有独立像素副本，测试媒体按真实同源/WebP服务输出，原SDK26的96px/精确颜色/透明边角断言保留，另加SDK35系统缩放回归；新模型入口测试变量名修正为现有mutation记录。所有失败日志保留native1～12及format*，不计通过、不声称原DSH未提交代码已恢复。

真实FCM/国产厂商、真机权限与强杀恢复、完整账号设置页面及独立验收未验证或未完成；此任务不是全产品完成声明。完整源码CI与正式交接在验证后追加。

根目录相关检查root-related1全部成功：契约2.3/529个Kotlin定义、图标与令牌生成物检查、全仓Prettier、报告脚本ESLint和最新JUnit门禁118条/零跳过，packages/contracts无差异。锁文件只更新app/platform两处，随后正常锁定构建通过。构建、检查与配置文档是云端实测；没有使用Windows本机或真实供应商凭据。
