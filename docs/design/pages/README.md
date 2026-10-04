# 页面设计说明索引

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 任务 | T-006 |
| 日期 | 2026-10-04 |

每份页面说明的固定结构：**目的与入口 → 页面结构（线框）→ 使用的组件 → 状态 → 交互 → 平台差异 → 对应需求**。

规则：
1. 页面只能使用 `../components.md` 中的组件；组件编号写成「C 3.2」（= components.md 第 3.2 节）。
2. 数值用令牌名（`../tokens.json`），动效用编号 M-xx（`../motion.md`）。
3. 页面之间怎么跳转见 `../02-interaction-flows.md`。
4. 线框图只表达位置和层级，不是最终视觉；视觉看 `../preview/index.html`。

| 页面 | 文件 | 主要需求 |
|---|---|---|
| 首次使用引导 | `onboarding.md` | ACC-04、ACC-05 |
| 会话列表 | `conversation-list.md` | CHAT-01、CHAT-12 |
| 私聊 + 私聊设置 | `private-chat.md` | CHAT、MODE、SIM-11 |
| 群聊 + 群设置 | `group-chat.md` | SOC-03～06 |
| 通讯录、角色广场、添加角色、创建角色 | `contacts-add.md` | CHR-01、03～08 |
| 角色资料页 | `character-profile.md` | CHR-02、CHR-10、GRW |
| 朋友圈 | `moments.md` | SOC-07～09 |
| 「你不在时」摘要卡与时间线 | `while-away-timeline.md` | SIM-11、SIM-02、SIM-03 |
| 来电与语音通话 | `call.md` | MED-06、MED-07 |
| 卡册、熟悉度、成就 | `cards-familiarity.md` | GRW-03～06 |
| 我、设置（模型与密钥、通知、隐私、通用）、收藏 | `settings.md` | ACC、MDL、CHAT-09、CHAT-11、MEM-07 |
| 分享图编辑 | `../share-templates.md` | EXP |
