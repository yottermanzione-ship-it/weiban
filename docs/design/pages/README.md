# 页面设计说明索引

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 任务 | T-006（v1.0）、T-012（v2.0） |
| 日期 | 2026-10-04 |

每份页面说明的固定结构：**目的与入口 → 页面结构（线框）→ 使用的组件 → 状态 → 交互 → 平台差异 → 对应需求**。

规则：
1. 页面只能使用 `../components.md` 中的组件；组件编号写成「C 3.2」（= components.md 第 3.2 节）。
2. 数值用令牌名（`../tokens.json`），动效用编号 M-xx（`../motion.md`）。页面说明里不写主题判断：两个主题用同一份页面说明。
3. 页面之间怎么跳转见 `../02-interaction-flows.md`。
4. 线框图只表达位置和层级；视觉看 `../preview/index.html`（可切换两套主题）。
5. 每一页**网页和安卓原生客户端都按同一份说明实现**；两端写法差异见 `../components.md` 0.1 节，页面特有的差异写在各页「平台差异」。

| 页面 | 文件 | 主要需求 |
|---|---|---|
| 首次使用引导 | `onboarding.md` | ACC-04、ACC-05 |
| 会话列表 | `conversation-list.md` | CHAT-01、CHAT-12 |
| 私聊 + 聊天信息页 | `private-chat.md` | CHAT、CHAT-13、MODE、SIM-11 |
| 群聊 + 群聊信息页 | `group-chat.md` | SOC-03～06 |
| 通讯录、角色广场、添加角色、创建角色 | `contacts-add.md` | CHR-01、03～08 |
| 角色资料页、设置备注和头像、记忆页 | `character-profile.md` | CHR-02、CHR-05、CHR-10、GRW |
| 朋友圈 | `moments.md` | SOC-07～09 |
| 「你不在时」摘要卡与时间线 | `while-away-timeline.md` | SIM-11、SIM-02、SIM-03 |
| 来电与语音通话 | `call.md` | MED-06、MED-07 |
| 卡册、熟悉度、成就（28 枚徽章） | `cards-familiarity.md` | GRW-03～06 |
| 「我」页、服务页、10 个宫格中的非计费页、收藏、表情、我的资料 | `me-and-services.md` | SVC-01、SVC-02 |
| 余额、余额明细、花费统计、价目表、模型、排行榜、后台预算、余额不足 | `billing.md` | MDL-02～10 |
| 设置（账号与安全、新消息通知、隐私、通用、主题）、人设贴合度、注销 | `settings.md` | SVC-01 第 3、7 条、ACC、CHAT-09、MEM-07 |
| 分享图编辑 | `../share-templates.md` | EXP |
