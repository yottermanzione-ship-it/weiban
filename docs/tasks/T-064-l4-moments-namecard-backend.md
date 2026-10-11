# T-064 L4 后端：朋友圈模块与名片消息

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L4-05、D-L4-02（后端部分：名片消息类型、冷却） |
| 迁移号 | 0033–0035 |

## 目标

做完后：新建的 `moments` 模块能存动态（文字、图片最多 9 张、链接）、点赞、评论、可见范围、新动态红点；聊天里能发「名片」消息，名片推荐有频率和冷却的账本。

## 背景

- `moments` 是新模块（`docs/architecture/overview.md` 第 72、109 行：表 `posts`、`post_media`、`likes`、`comments`、`visibility`）。角色发什么、怎么评论由 AI 的 T-066 通过端口写入；本卡只管数据。
- 名片推荐（CHR-04）的触发由 AI 决定，频率与冷却必须由代码强制，账本放后端。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/architecture/contracts-3.0-map.md`（moments、名片消息类型部分）
- `docs/product/prd-v1/07-social.md` SOC-07、SOC-08、SOC-09；`docs/product/prd-v1/03-characters.md` CHR-04；`docs/product/prd-v1/11-scenario-modes.md` MODE-05
- `docs/backend/chat.md`、`docs/backend/media.md`、`docs/architecture/security-and-privacy.md`
- `docs/design/pages/moments.md`、`docs/design/pages/contacts-add.md`

## PRD 条目与参数（原文）

- P-16 朋友圈频率：「每角色每天最多 1 条；默认每周 2–4 条，按人设调整」（频率由 AI 调度，本卡提供「今天是否已发」的查询）。
- P-27 名片推荐：「所有角色合计每 7 天最多主动推荐 1 次；『不感兴趣』后该角色冷却 90 天」（用户主动询问时不受此限，CHR-04 第 4 条）。
- P-29 朋友圈回复时限：「角色回复用户评论、点赞或评论用户动态，最晚 2 小时内」（AI 执行，本卡在评论事件中带时间供其调度）。
- SOC-07 第 6 条：用户只看到已添加角色和自己的动态；第 7 条：新动态不推送，发现页入口显示红点。
- SOC-08 第 3 条：用户只能看到自己通讯录中角色的点赞评论；第 5 条：一条朋友圈下角色评论数不超过 6 条，用户参与后可继续。
- SOC-09：用户发文字、图片（最多 9 张）；「谁可以看」全部 / 部分角色；设为不可见的角色不能看到、不能在私聊提起。
- SOC-07 第 8 条 / MODE-05：朋友圈不含成人模式内容和经期内容（写入端口拒绝带 `scope = adult` 或「健康」标记的来源）。

## 范围

- 可以改：新建 `apps/server/src/modules/moments/**`；`apps/server/src/modules/chat/**`（名片消息类型，以契约为准）；`apps/server/src/modules/contacts/**`（通过名片添加时记录推荐人，供第一条消息提及）；`apps/server/drizzle/0033～0035_*`。
- 不可以改：`packages/contracts/**`、ai-runtime、`docs/quality/**`。模块边界登记由 T-101（运维）做，本卡先建目录，lint 报错先在交接里注明。

## 交付物

1. `moments` 模块：动态（角色 / 用户）、媒体、点赞、评论（含回复）、可见范围、评论上限 6 条规则、红点（按用户已读游标）；用户端接口；给 ai-runtime 的写入端口与事件（新评论、新点赞、新用户动态）。
2. 删除角色（CHR-06）后其动态对该用户不再显示；角色恢复时恢复。
3. 名片消息类型（发送、展示所需字段）、名片推荐账本（全局 7 天 1 次、「不感兴趣」冷却 90 天）的查询与记账端口。
4. 本模块删除清单（注销用）。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译。

## 验收标准（留给 Codex 整体验收）

- [ ] 用户只看到已添加角色和自己的动态；看不到未添加角色的点赞和评论。
- [ ] 一条动态下角色评论到 6 条后不再新增，用户评论后可继续。
- [ ] 用户动态设为部分可见时，不可见角色拿不到这条动态（端口层过滤）。
- [ ] 名片推荐账本：7 天内第二次主动推荐被拒；「不感兴趣」后 90 天内该角色不再被推荐。
- [ ] 写入朋友圈的内容不能来自成人模式或带「健康」标记的消息。

## 交付

分支 `T-064-l4-moments-namecard`，worktree `C:\wb-dev\wb-t064`，交接 `docs/handoffs/2026-10-09-backend-lead-T-064.md`（写明给 T-066、T-067、T-068 的接口说明）。其余按 index 第 2 节。
