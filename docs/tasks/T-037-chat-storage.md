# T-037 可靠聊天存储与收发

Codex；2026-10-06；来源总经理持续开发授权；独立分支 dev/codex-product-continuation。状态：开发自测完成，发布push/PR CI已通过。

输入：PRD CHAT-01～03、CHAT-07～08、CHAT-13；ADR-0004/0005/0006/0013/0015；message-reliability；hard-boundaries；contracts chat/sync/ws/events/ports。

目标：HTTP/WS共用真实消息写入，连续seq、同发送者同键幂等、服务器scope盖章；会话列表/历史coverage、引用/撤回/已读/隐藏/清空/置顶/免打扰/系统消息，供下一项好友与AI运行时使用。

范围：chat自己schema及公开端口、组合根给realtime传入发送端口、测试与文档；不在chat引用AI，不直接查其他模块表，不修改main。

契约配套申请及执行依据：总经理持续开发授权覆盖契约配套。新增同进程ChatUserPort.sendMessage(userId,conversationId,SendMessageRequest)→MessageAck，用于组合根把HTTP和WS装配到同一处理器。仅TS端口，无HTTP/WS形状变更、无需变更JSON Schema；realtime只引用契约和自身注入令牌，不从底层导入中层chat。后续contacts调用既有ChatAdminPort建私聊。

验收：

- [x] 真实事务/连续seq/回滚、并发同键同ack、不同发送者同键不混淆；scope忽略客户端伪造。
- [x] 每条消息同步message.created和完整conversation.updated预览/未读，新消息恢复隐藏会话。
- [x] HTTP/WS同处理器，鉴权/参与者与引用权限，不承认未提交消息为已送达。
- [x] seq分页与同快照coverage/hidden/cleared负记录，合法空洞不当缺口；未知范围参数拒绝。
- [x] 引用正文不因撤回、本人删除或清空/范围过滤复原；撤回只限自己的消息且用户遵守P23。
- [x] 已读只前进、角色已读/typing、完整个人状态更新、记忆读取声明scopes。
- [x] 注销物理删除所有自己数据，迟到事件不重建；迁移执行/回滚/再执行。
- [x] 整仓/真实浏览器/生产构建；开发自测与独立验收区分。
- [x] 发布提交的push/PR CI核验。

T-036远端55f71cac48eba230b60aaeb1f80e035820ad4b98（本机b9ea9df24b6f072a5a0094bccdf0d193d482b7da，tree相同9cabd01949fa61e548006f843e22475d30cd5353），push37448729513及PR37448736761均success，已读取。产品尚未完成。

为防角色分类修改与成人范围写入交错，CharacterReadPort.getClassification和PolicyPort.checkAdultGeneration增加可选Tx（TS内部端口，无网络形状变化）。characters在原事务内锁定自己角色行、policy在原事务审计判定，避免头像/联系人查询和额外池连接；范围切换与每条成人范围新消息都须当前资格通过。用户发送与范围切换的拒绝结果先正常提交审计，再由外层报告失败，不能把拒绝审计随业务回滚。

contacts配套：ChatAdminPort增加同事务archiveDirectConversation与purgeDirectConversation；归档立即停止收发并隐藏，恢复沿用历史，重新认识/物理删除产生新会话。仅内部端口，不改变网络schema。

setContentScope的PortResult失败枚举补adult_mode_not_eligible，以便真实资格并发改变时返回业务结果并保留审计；不抛出契约外的业务失败。

本机证据：整仓pnpm check，34文件362测试全通过/零跳过，新增chat13条真实Nest/PG/HTTP/WS测试；格式、边界/lint、137模块472依赖无循环、全仓类型/tokens通过。真实网页5组、后台6组浏览器回归通过。Kotlin513定义/85接口、图标/tokens生成无差异；生产构建通过。包含角色/系统稳定内部幂等键、消息事务回滚、十个并发重试、范围资格共享行锁并发变更、归档/恢复/重新认识/删除、账号deleting后迟到写拒绝。日志/tmp/weiban-t037-root-verified.log、web-browser.log、admin-browser.log、generated.log（同前缀）；不是独立质量验收。

账务注销回归原20秒等待不够：新增chat后，六模块及重复触发最多12项串行pg-boss任务（2秒空闲轮询）。将该项等待预算调整35秒、测试上限45秒，保持必须收齐全部模块回报及物理删除断言；专项38项和整仓均通过。

最终生产Docker、11迁移、双域HTTP/CSP、age备份/空卷恢复、5.000001元余额与私有加密媒体下载、拒绝非空覆盖均通过，日志/tmp/weiban-t037-deploy-final.log。首轮通过后因最后幂等键修正重建验证，重建轮数据库不健康且磁盘仅755MB；不计该轮通过。清理14个明确属于本项目前轮的BuildKit缓存ID，保留当前镜像及测试数据库，恢复9.5GB后最终重跑通过；未执行全局清理。

远端9d129d42ad02667607a7ec198ab11b6ac406f6a6（本机8e324b72f597bed571677181cc3eeb89ebef5c2d，tree均d84ee67563dd9cbcf6ed0fd41ac3d0a9bcf91ccd），push37453560145与PR37453566816均success，已读取结果。
