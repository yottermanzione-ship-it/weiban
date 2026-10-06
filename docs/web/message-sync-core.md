# 消息同步核心（T-034）

`packages/client-core/src/sync-engine.ts`提供无网络/界面副作用的状态机；`packages/contracts/src/client-sync.ts`定义跨端状态、操作与动作，契约2.1。JSON协议向量在contracts/test-vectors，Vitest读原文件，最终完整状态与动作顺序均须相同。期望值独立编写，不能由被测引擎生成。

## 驱动装配约定

L1驱动每次只投递一个operation，读取新state与drainEffects，在一个IndexedDB/Room事务里持久化state后才执行动作。事务失败不得发送网络请求；崩溃恢复将sending改成pending，先补齐服务端更新再发队列，沿用clientMsgId。账号退出/切换取消请求并提升请求代际，旧回包（包括快照/更新）不得投递给新引擎。核心的account.reset只负责清空自身，不能替代网络归属检查。

首次或410重建：先GET sync/state得到S，仅存临时内存；驱动完整收集所有会话、最新消息、contacts、profile/notification/companion/model_selection/wallet/preferences。任一失败不得提交部分快照或S。提交成功后从S补拉，期间实时帧按updateSeq缓存，补齐后才恢复发件。快照与补拉必须使用完整服务端状态，重放幂等；消息写入后L1服务端还须发布当前用户的完整conversation.updated，以更新预览和未读数，核心不会凭消息正文猜这些值。

会话缺口以seq自检，服务端消息页必须提供扫描coverage。窗口最多200号，每号要么是返回消息，要么有hidden/cleared负记录；客户端不把未知缺号当成删除。hasMore依据尚未扫描的序号区间，不依据可见条数。全量快照coverage作为最新历史窗口锚点，更早历史由上滑另行拉取。

撤回保留消息ID/时间负记录，即使通知先于未缓存的历史，也不允许迟到正文恢复；引用摘要同时清理。本人删除保留已知seq负记录，未知历史由服务端coverage提供。清空按clearedThroughSeq清除正文、存量和迟到引用摘要。未知更新推进游标并跳过，未知消息保留originalType作为降级提示；重复解析缓存不能丢掉原类型。

## 当前边界

19个向量覆盖离线5条、确认丢失重试、重复更新、补拉缺口/分页、410快照和实时并发、未知降级、隐藏空洞、撤回和先到撤回、清空引用、重启发件、退出迟到ack、错误coverage原子回滚、旧快照、新设备零游标、永久失败/5次失败和跨会话并发。该阶段交付协议和纯核心；真实HTTP/WS、IndexedDB事务驱动、Room/WorkManager、聊天界面和推送在L1装配验证，不能据此声称L1或产品完成。
