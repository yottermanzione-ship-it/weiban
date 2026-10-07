# T-040 推送与管理员提醒

2026-10-07；Codex；主应用已实现，本机开发自测通过，待读取发布后的远端CI。

依据D-L1-05、message-reliability7/9、CHAT10、ACC01/03、MDL04、billing6.4/8.4。独立分支dev/codex-product-continuation，PR #3，main不改。实现说明见docs/backend/push.md。

已实现四表、0013迁移/回滚、DEK凭据及载荷、有效app会话绑定、并发幂等/换绑、退出与发送前复核；normal专用读取、adult/隐藏内容、presence、时区免打扰、合并/撤回/已读抑制。余额及模型故障24小时去重，模型通知50用户/页持久分页；管理员合并/严重度升级/ack/90天、注销push owner。PushPort只报告实际厂商accepted，不把queued当成功。

WebPush3.6.7成熟SDK的RFC8291/VAPID与极光官方REST；HTTPS公共DNS固定地址、DNS1秒/总预算1.5秒、4KiB回包、失效删除、临时失败3重试；稳定Topic/官方override_msg_id，long ID不丢精度。可选生产secret已编写，无凭据部署可运行。

契约2.2追加归属与notificationId，新NotificationEnvelope要求账号/会话/去重；根字段兼容。生成514定义/85操作，内部端口可复用事务，组合根适配中层能力，push不越层读表。

专项自测25条通过：4组真实PG共14条；通知规则3、endpoint2、实际HTTP通道3、受控网络预算/安全3。契约另加归属兼容用例及2.2断言。独立worker在web关闭后实际HTTP发送持久任务，夹具创建至接收<2秒，重复任务不重发。完整pnpm check：47文件420测试，零跳过；格式、175模块629依赖边界、类型和tokens通过。网页5组、后台6组真实浏览器通过。Android ktlint/detekt、41条JUnit零跳过、APK构建以及514定义/85操作/图标/tokens生成无差异检查通过。

最新生产app镜像5a770016af38813f70ab3553efab4d288b7621fac9743e84265f084cfad61d6d、edge镜像5c66c8a19b7b6f6c66983b5475d1e5d2b4c495356d8dde27ab3d21aabf7554f6分别构建成功。清理指定本项目构建中间缓存后，复用这两张镜像运行完整生产演练：14迁移、双域HTTP/安全头、5.000001元余额、加密媒体、age备份/空卷恢复与非空目标拒绝全部通过。首轮磁盘满失败不算通过。可选推送Compose叠加配置校验通过，未使用真实厂商凭据。

首轮旧版本断言和新增注销owner后的等待预算不足已修正，所有owner及零残留条件保留，最终420条全仓复测通过。

参考https://github.com/web-push-libs/web-push ，https://docs.jiguang.cn/jpush/server/push/rest_api_v3_push 。极光已取得原文核对，不使用不存在的collapse_key；override_msg_id实际HTTP验证。

实际HTTP为本地厂商夹具；TLS/超时使用受控对象测试。真实厂商、安卓离线通知、iOS主屏幕PWA未验收。OS已接受通知不能撤回，极光系统层固定通用文案，客户端owner展示/点击随后实现。管理后台红点随后接入，产品未完成，独立QA待完整交付。

前置T039已发布：远端27f70b0aac607b80525e4ea48728eede346b5d5b，本机8aaf6c70de551497faf9fe84c1fcd3fbee565349，同tree57721568f8019dcb8cca6c184b43c750b089ba36；push37492312885/PR37492320416均success已读取。

补充模型故障复核：事件保留下架前previousDefaultFor，默认被清空后隐式用户仍能收到提醒；当前已有新默认则跳过旧故障。通知请求持久保留模型上下文，发出前复核当前选择/可用性，恢复后取消已排队旧通知。实际PG5条运行时专项通过。新0013快照包含model_context，最终420条整仓回归及包含model_context的更新镜像恢复演练通过。
