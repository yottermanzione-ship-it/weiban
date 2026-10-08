# ADR-0019 安卓通知通道与账号归属

2026-10-08，Codex临时开发接管自审；待原架构/独立负责人复核，未代签Claude。依据ADR-0001、T040/T041、CHAT-10与ACC-03；复用契约2.3。

## 决定

platform模块集中SDK、系统通知、头像读取与WorkManager；app装配权限/导航，feature只接core能力DTO。PushTransport隔离厂商，交付可复现测试通道全链路及可选FCM。FCM需公开客户端配置和Google服务，默认不启用；服务端HTTP网关需data.weiban/data-only转换，服务账号私钥留服务器。国产通道真实接入待凭据与设备，不宣称FCM覆盖所有安卓。

归属、TTL和路由校验先于Room收件；会话同一锁控制Room与展示，任务只带ID，退出/换号取消通知/任务。OS展示和收据无法跨系统原子提交，采用合并键/onlyAlertOnce与持久收据，承认断电窗口。SDK自动展示会绕过应用验证，先移除notification展示字段再受控处理。

展示时networkOnly重读预览/声音、免打扰与会话状态；失效会话不展示，网络失败重试至TTL。头像统一96px透明圆角PNG；不可变PendingIntent只带归属、时间、ID和允许路由。管理员跳独立HTTPS站，不转交app令牌。

## 对比与代价

SDK自动显示无法在回调前检查账号；Activity无法独立处理后台/冷启动；WorkManager正文会留下换号后的系统数据库载荷。因此用Room私有收件+ID任务+受控展示。国产/聚合SDK可扩覆盖，但需账号、许可和实机验证；不模拟未取得凭据的成功。读最新设置会延后离线展示，优先保持隐私和免打扰。此为工程决定，不是供应商/真机验收。
