# 协议一致性 JSON 向量 v1

准绳为contracts导出的`ProtocolVector` schema（对应generated/json-schema.json定义），每个JSON文件包含formatVersion/id/description、initialState、steps、expected。状态为`ClientSyncState`，输入为`ClientSyncOperation`，输出请求/动作是`ClientSyncEffect`；接收端未知消息/更新先按契约归一化为unsupported，必须保留originalType且可反复解析。

每一步是operation，可带expectError（必须抛错且持久状态/待执行动作均回滚）和expectState（立即核对完整持久状态）。最终比较完整state和依次产生的effects；不能只比较某个数量。restart表示保存为JSON后重新创建引擎，在线/补拉/请求中的临时状态不恢复；发送中的队列恢复为待发，ID和正文保持不变。now为可注入毫秒时钟，运行器不得使用真实时间或网络。

网页运行器在client-core的Vitest中；安卓JUnit读取完全相同的文件，不复制或另写期望。L1实际网络/IndexedDB/Room/WebSocket驱动另外接受集成与破坏性验证，纯状态机向量不是推送/真实服务已验收的证明。

分页coverage的扫描窗口最多200个seq，且每个seq必须有消息或明确排除记录；不可将没有正文的未知缺号擅自视为已隐藏。全量重建先取S，原子写完整快照与S，再从S补拉，发件队列在补齐后恢复。网络驱动还必须检查账号/请求代际，丢弃退出/切换后才到达的回包；account.reset和迟到ack场景验证核心不会凭未知确认重新插入消息。

撤回负记录（recalled）必须随状态持久化；没有本地正文时也登记，避免后续历史或引用摘要复原。清空与隐藏同样作用于迟到引用。首批19个场景，扩展时新增JSON，不复制两端期望。
