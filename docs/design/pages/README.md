# 页面设计说明索引

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 任务 | T-006（v1.0）、T-012（v2.0）、T-021（v2.1）、L3～L7 补齐（v2.2） |
| 日期 | 2026-10-09 |

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
| 卡册、熟悉度、成就（34 枚徽章，v2.2） | `cards-familiarity.md` | GRW-03～06 |
| 「我」页、服务页（17 个宫格）、非计费宫格页、收藏、表情、我的资料 | `me-and-services.md` | SVC-01、SVC-02 |
| 余额、余额明细、花费统计、价目表、模型、排行榜、后台预算、余额不足 | `billing.md` | MDL-02～10 |
| 设置（账号与安全、新消息通知、隐私、通用、主题）、人设贴合度、注销 | `settings.md` | SVC-01 第 3、7 条、ACC、CHAT-09、MEM-07 |
| 分享图编辑 | `../share-templates.md` | EXP |
| 人设广场：广场首页、作品页、作者页、发布流程、我发布的（v2.1） | `persona-plaza.md` | PLZ-01～PLZ-08 |
| 经期日记、「健康」标记消息的展示规则（v2.1） | `period-diary.md` | PLAY-01、CHAT-10 第 7 条、EXP-01 第 6 条 |
| 共同领养宠物：总览、领养、宠物主页、插画规格（v2.1） | `pet.md` | PLAY-02 |
| TA 的提醒、心愿清单、每日一问、慢信、陪你专注（v2.1） | `play.md` | PLAY-03～PLAY-07 |
| 管理后台：用量与费用、人设广场管理、负余额（v2.1，电脑浏览器） | `admin.md` | ADM-07～ADM-09 |
| L3 补充：摘要卡接口对应、时间线、熟悉度与天数状态、纪念日、主动消息设置（v2.2） | `l3-companion.md` | SIM-09～13、GRW-03、GRW-04、CHAT-13 |
| 管理后台：公开动态、节日清单、关系网、素材库、行为规划、注销未完成（v2.2） | `admin-content.md` | ADM-02～05、ADM-10 |
| L4 补充：群聊列表与细节、朋友圈子页、新的朋友、名片、TA 认识的人（v2.2） | `social-l4.md` | SOC-01～09、CHR-04 |
| L5 补充：图片、语音、链接、表情包、TA 的声音、全屏来电（v2.2） | `media-l5.md` | MED-01～07 |
| 聊天搜索（v2.2） | `search.md` | CHAT-12 |
| 收藏完整版（v2.2） | `favorites.md` | CHAT-11 |
| 导入：生成角色、截图导入、我的补充设定（v2.2） | `import.md` | CHR-08、CHR-09 |
| 注销账号（v2.2） | `account-deletion.md` | ACC-06 |

L3～L7 按开发项的完整索引、素材占位清单和待处理问题见 `../pages-l3-l7-index.md`。
