# 群头像（A6，契约 3.11）

任务卡 `docs/tasks/2026-10-15-web-a6.md` 批准本常规扩展。沿既有群聊读取/同步/媒体链路，不新增群收藏或独立头像系统。

- `Conversation.group.avatarMediaId?: UUID | null`：旧响应无字段也回退成员拼图；更新、重进、会话列表、搜索和通讯录群列表共享同一字段。
- `PATCH /api/v1/groups/:conversationId/avatar`，body `{mediaId: UUID | null}`。null 恢复拼图；响应完整 Conversation。客户端不能设置外链 URL。
- 新私有上传用途 `group_avatar`，归上传者本人，现有 MediaSystemPort.canUse 检查 ready/本人/用途；群写入先检查会话本人归属与群类型。
- 0094 为 conversations 新增 group_avatar_media_id。头像更新和解散都先按用户取得同一事务 advisory lock，再锁群，避免媒体检查与最后引用删除之间竞态。同一图片可以用于本人多个群；替换/恢复/解散后只在其无其它群引用时，复用 deleteObject(tx) 标记删除并在提交后删文件；失败由既有媒体生命周期重试。注销按既有 media ownerId 全部清理。
- 接入既有 conversation.updated / conversation.removed，不另造同步通道；普通私聊忽略该群字段。上传后尚未绑定或绑定失败的文件沿现有私有上传保留/注销清理规则，页面重试复用本次已上传 ID，不反复上传。
- 通讯录原有“群聊”入口收录所有未解散的群（包括从会话列表隐藏的群），不存在独立“保存到通讯录”开关，不增造一套收藏状态。

本地 Git 合入不改数据库。部署到数据库环境前按既有流程备份并执行 0094；q-features 后续迁移从 0095 继续。安卓仅契约生成一致，不编译或改 UI。
