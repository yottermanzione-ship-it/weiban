# A7 角色状态只读查询（契约 3.12）

任务卡批准最小只读扩展：`GET /api/v1/characters/:characterId/status` 返回 `{mood: TimelineMood | null, updatedAt: Timestamp | null}`。复用 TimelineListService 的 ContactsReadPort 与数据库，只允许当前用户的 active 好友；按 userId + characterId 读取既有 mood_states，不生成推演、不调用摘要/模型、不记聊天访问时间、不写数据。无行或未知 mood 返回两个 null，不伪造 neutral。无需迁移。

网页资料昵称旁映射小表情，设置沿现有 display-prefs 本机偏好机制，默认显示；关闭时不发状态查询，无数据不显示。与 q-features 用户“我的状态”和后续全局角色生态开关无关。安卓仅同步必要契约生成。
