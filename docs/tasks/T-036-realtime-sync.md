# T-036 实时同步与更新日志

负责人 Codex；来源为总经理持续开发授权；2026-10-06；活动分支 dev/codex-product-continuation。状态：开发实现与本机自测完成，远端 push/PR CI 均核验通过，开发自测登记，独立验收待另一位审查者。

输入：ADR-0004/0005/0006/0013/0015、message-reliability 第2/4/7/8节、security-and-privacy、engineering-standards、contracts 的 sync/ws/identity/events。

目标：在现有真实账号/资料/计费/模型设置上接上 WS、按用户加密的持久更新日志和 HTTP 补拉，供后续聊天与两端驱动使用。

范围：realtime 自己的 schema、公开 SyncPort、应用装配、相关测试及文档；不跨 schema 直接查询，不改 main。消息发送必须由下一项 T-037 的聊天端口处理；当前 WS message.send 明确返回可重试 service_unavailable，不伪造 ack。

契约变更申请及执行：总经理已授权接续开发所需契约配套。IdentityAccountStatusPort.getAccountStatus 增加可选 Tx，不改 HTTP/WS/事件形状与版本；旧调用及旧实现仍兼容。真实十个并发事务复现连接池耗尽，因此状态查询需复用调用方事务并持有账号行共享锁，防止删除状态切换与新建用户数据交错；不通过提高池容量掩盖问题。仅 identity 自己访问账号表。

验收项目：

- [x] 同事务分配连续序号/加密更新/提交后跨进程通知，回滚不耗号；用户隔离。
- [x] HTTP 鉴权、升序分页/最新序号/hasMore、非法游标、缺口拒绝及30天边界410；全部修剪不重置最高序号；时钟回拨修剪连续前缀。
- [x] WS 首帧10秒鉴权、契约兼容检查、ping/pong/ref、45秒静默断开、同会话替换、不带 URL 令牌。
- [x] 持久前台状态和跨进程 typing；在线状态与实际用户消息活跃时间分离。
- [x] 删除清单及迟到设置事件拒绝复活；重复/乱序用户消息事件不使活跃时间倒退。
- [x] 真实 WS/PG，独立 worker 应用与 web 应用通信；不是内存 transport 假实现。
- [x] 完整根检查、两端浏览器回归、安卓 auth 限长回归、生产构建与加密备份恢复。
- [x] 当前发布提交的 GitHub push/PR CI 核验。

新增依赖 ws 8.22.0（服务器 WS 实现，MIT），@types/ws 8.18.2（仅开发类型，MIT），锁文件固定实际解析版本。迁移0009由 Drizzle生成，并提供 down 脚本；执行/回滚/再执行专项已通过。当前专项日志为 /tmp/weiban-t036-integration.log 和 /tmp/weiban-t036-sockets-final.log；最终全仓数和发布SHA完成后登记交接，不将中途专项通过当作整仓通过。

交付说明：docs/backend/realtime.md；下一项 T-037 聊天存储/幂等/收发/覆盖范围，再实现好友与 AI、Web/Android驱动。完整 L1 及 L2–L7 尚未完成。

最终本机证据：pnpm check，33文件349测试全通过/零跳过（新增15条）；格式/模块边界与循环检查/全仓类型/tokens通过。真实Nest/PG网页5组、后台6组浏览器回归全部通过；安卓auth ktlint/detekt/Compose两条JUnit通过，设备名按契约最大64字符。生产服务构建及Kotlin/图标/tokens生成无差异通过。完整生产Docker/10个迁移/双域HTTP/age加密备份与空卷恢复/5.000001元余额与加密媒体下载/非空覆盖拒绝演练通过。部署首轮因本工作区磁盘满在创建容器前退出；清理指定的此前本项目BuildKit记录后剩余11GB、保留数据库/当前镜像，重跑通过；不是产品故障，不将中断轮计作通过。

发布远端55f71cac48eba230b60aaeb1f80e035820ad4b98，本机b9ea9df24b6f072a5a0094bccdf0d193d482b7da，两者tree相同9cabd01949fa61e548006f843e22475d30cd5353。push37448729513、PR37448736761均success，已读取结果；安卓/check、真实PG、5+6浏览器及生产恢复演练均完成。
