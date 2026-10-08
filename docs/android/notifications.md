# Android 消息通知（T-045 / T-041 续作，2026-10-08 开发自测）

本轮接入原生通知能力，开发自测结果在 T-045 任务卡与交接登记；尚未进行真实 FCM、国内厂商或独立质量验收。默认构建不配置推送，不能把 APK 可构建当作真实投递通过。

## 装配与配置

`platform` 集中持有 Firebase Messaging SDK、Android NotificationManager、后台通知任务及头像下载；`app` 装配会话、系统权限请求和导航。`feature/me` 只依赖 core 的设备能力 DTO，不直接引用厂商 SDK。`PushTransport` 是厂商通道边界，当前真实实现为可选 FCM；国内厂商通道仍待接入。

公开客户端配置在构建时读取以下环境变量：

| 变量 | 内容 |
|---|---|
| `WEIBAN_FCM_APP_ID` | Firebase Android 客户端应用 ID |
| `WEIBAN_FCM_SENDER_ID` | 消息 sender ID |
| `WEIBAN_FCM_PROJECT_ID` | Firebase 项目 ID |
| `WEIBAN_FCM_API_KEY` | Firebase 客户端 API key；不包含服务端发送凭据 |
| `WEIBAN_ADMIN_PUBLIC_ORIGIN` | 可选独立管理站 HTTPS origin，点击管理员提醒只追加 `/admin/alerts` |

四个 Firebase 字段均需配置，且本设备 Google Play Services 可用，设置页才提供有效开启动作。未配置、不支持或系统权限未允许时不请求 token、不绑定设备；权限只由用户点击开启通知后申请。Firebase 默认初始化 Provider 移除，自动 token 初始化、数据采集和 BigQuery 投递统计关闭；不使用 Google Services Gradle 插件，不将服务账号私钥或服务端推送密钥打进 APK。Android 13+ 同时检查 POST_NOTIFICATIONS 权限和系统通知开关；设置页提供系统通知设置入口，返回应用后刷新状态。

SDK 25.1.3 使用 installation-ID 注册模式：`register` / `unregister` 与 `onRegistered`，不调用已弃用的 getToken/deleteToken/onNewToken。显式注册的 token 等待器只在内存中，30 秒无回调则失败并清理；取消、替换和旧等待器清理不会覆盖新的请求。正在等待的注册回调只完成请求，避免循环触发重新绑定；非请求中的 token 更新才安排 ID-only 绑定任务。供应商网络失败展示通用重试提示，不记录 token 或 SDK 原始错误。

现有服务端 AndroidPushAdapter 把 `{provider,token,payload}` 交给配置的 HTTP 推送网关。FCM 网关必须将完整 `NotificationEnvelope` JSON 写入 **data.weiban**，使用 data-only 消息；这是与外部网关的明确接入要求，仓库内的通用 HTTP 网关适配器不代表已经配置了真实 Firebase 发送服务。

## 归属、持久性与隐私

接收端按随 APK 生成的 NotificationEnvelope schema 校验，载荷 UTF-8 不超过 8 KiB，必须包含 notificationId、recipientUserId 和 recipientSessionId。会话必须为有效 app 会话，时间戳不能超过未来 60 秒或已发送 10 分钟；管理员提醒还核对管理员角色。旧账号、旧会话、缺归属、过期及不允许的链接不入本账号通知收件箱。

Firebase SDK 对 notification 字段会在 onMessageReceived 前自动展示，因此自有服务同时保护 RECEIVE 和 RECEIVE_DIRECT_BOOT：缺少 data.weiban 或通道不可用的消息不进入 SDK 分派；有 weiban 的消息先删除 `gcm.n.*` / `gcm.notification.*` 展示字段，再进入 SDK。所有展示只能走账号校验后的自有 NotificationManager。

本机开启标记、设备 ID、待展示载荷和最多 128 个最近通知 ID 收据存在账号归属的 Room 缓存中，与登录/退出共用互斥锁。待展示载荷也限 128 项，过量删除旧项；关闭通知清理待展示正文，切换账号清空本地缓存。WorkManager 持久任务只包含 userId、sessionId、notificationId，刷新绑定任务不保存厂商 token。同步 OS publish 与账号替换共锁，迟到旧 token、头像与工作任务不能写入新会话；关闭动作先关闭本地展示门槛，再取消自己的通知/任务并删除服务端设备。已经进入 POST 的绑定仍保存返回设备 ID，随后关闭动作完成 DELETE，不能因开关关闭而丢失解绑目标。

展示前读取服务器当前声音/预览设置和会话静音/内容范围，使用 networkOnly 禁止旧 GET 缓存恢复已关闭的消息预览；成人会话只显示通用新消息提醒。免打扰启用时读取账号时区，并在 OS 展示时重新判断开始含、结束不含的时段，跨午夜和全天时段与服务端规则一致。网络暂时不可用则后台重试，超过通知 TTL 后丢弃。声音/静默使用不同系统通知渠道，最终声音仍由用户的系统渠道设置决定。相同会话合并键替换旧通知，设置 onlyAlertOnce。

同账号普通通知点击只允许 `/chat/{合法且匹配的conversationId}`、`/chat`、`/wallet`、`/models`、`/services`。不可变 PendingIntent 只带归属、通知 ID、时间与路由等元数据，移除真实标题/正文，无会话令牌。Activity 冷启动和 onNewIntent 都先恢复本地会话再核对，UI 接收目标时再次核对 owner。管理员链接只允许配置的独立 HTTPS origin 和 `/admin/alerts`，浏览器沿用管理站自己的登录，不转交 app token。

收据与 OS 的外部展示不是跨进程原子事务，不能承诺任意断电时严格一次；同合并键与 Android onlyAlertOnce 减少重复。实际 OS 强杀恢复、系统通知权限、后台调度以及供应商投递仍需真实设备验收。

## 头像与用户设置

大图标输出实际 96×96 PNG、透明圆角，比例为现有 avatar 0.12。按会话角色真实 refId 查 profile，联系人私有头像优先于管理员图片，再回退界面相同默认字形/颜色/图案；私有图片失效回默认，不借用管理员图片掩盖错误。图片按已有受限同源访问凭证下载，不给内容 URL 添加 bearer，复用已有像素上限和 EXIF 处理；所有元数据和内容结果保持 owner 绑定。

96px 是传入系统前的导出尺寸；系统可能按自身资源尺寸缩放（SDK35 的 mdpi Robolectric 环境为48px），不保证每个系统通知布局都以96个物理像素显示。回归分别保留 SDK26 的96px/圆角/精确色值断言，以及 SDK35 的96px导出、系统缩放后像素和生命周期断言。通知持有独立像素副本，不复用已经回收的临时头像位图。

“我 → 设置 → 新消息通知”保存现有契约的 pushSoundEnabled / pushShowContent / doNotDisturb，并呈现本机通知状态与开启/关闭/系统设置。免打扰起止时间要求有效 24 小时制 HH:mm，非法输入不提交。“余额与账单”和“模型选择”归到“我 → 服务”；聊天信息中的“模型选择”直接打开该页面。其余账号安全、隐私、通用、主动消息和厂商后台运行说明还需按设计说明完善，不能把本轮入口当作完整设置模块交付。

## 依赖与验证边界

Firebase Messaging 固定 25.1.3（Maven 元数据 2026-09-09，POM 核验 Apache-2.0）。其传递 Google Play Services SDK 按 Google Android SDK license 分别使用，不标为 Apache-2.0；AndroidX WorkManager testing 2.10.5 沿用工程的集中 WorkManager 版本，仅测试，Apache-2.0。依赖锁需通过完整 `--write-locks` 检查更新，随后正常锁定完整构建复验。

新增回归通过真实 Room、MockWebServer HTTP、Robolectric NotificationManager、渠道、PendingIntent、WorkManager 数据/Worker 和实际 Bitmap 像素验证行为；测试 transport 只替代供应商 token 服务，生产配置使用真实 SDK。真实 SDK 回调数据对象/旧展示 Intent 测试不等于 Firebase 网络投递验收。最终命令、失败修正、实际 JUnit 数和源码 CI 将在任务卡补录。
