# L3～L7 页面设计说明索引

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 版本 | 设计体系 v2.2 |
| 日期 | 2026-10-09 |
| 依据 | `docs/architecture/dev-plan.md` L3～L7；PRD v1.4（`docs/product/prd-v1.md` 与 `prd-v1/` 分章，第 14 章「我 → 服务」、对齐参照产品、默认绿色主题可切换微伴粉） |
| 用途 | Web 负责人、Android 负责人实现 L3～L7 页面时，从这里找到每一页的说明 |

## 1. 怎么用这份索引

1. 先在第 2 节按开发项（D-Lx-xx）找到要做的页面和说明文件。
2. 每份页面说明的结构都是：结论 → 页面结构（线框）→ 使用的组件 → 状态（加载 / 空 / 错误等）→ 交互 → 平台差异 → 对应需求。
3. 组件写成「C 21.4」= `components.md` 第 21.4 节；颜色、字号、间距只用 `tokens.json` 里的令牌名；动效用 `motion.md` 的 M-xx。**页面里不允许出现组件规范以外的样式**。
4. 两端（网页、安卓原生）按同一份说明实现；通用写法差异见 `components.md` 0.1，页面特有差异写在各页「平台差异」。
5. 某功能所在开发层还没上线时，对应入口（宫格、聊天信息页的行、菜单项、「+」面板项、成就）**不显示**，后面的往前移（SVC-01 第 6 条同一做法）。
6. 页面一律对齐参照产品（微信）的结构和交互；默认主题接近参照产品配色，用户可在 设置 › 通用 › 主题 切换「微伴粉」（`pages/settings.md` 5.1）。分享图、卡片、成就、熟悉度固定用微伴粉品牌色（D-14）。

## 2. 按开发层的页面清单

「状态」列：**已有** = 之前版本已写好、本次未改；**更新** = 本次在原文件里补充或修正；**新增** = 本次新写的文件。

### L3 推演与主动

| 开发项 | 页面 | 说明文件 | 状态 |
|---|---|---|---|
| D-L3-07 / 09 | 「你不在时」摘要卡（含接口字段对应、kind 图标、显示条件） | `pages/while-away-timeline.md` 第 2 节 + `pages/l3-companion.md` 第 2 节 | 已有 + 新增 |
| D-L3-07 / 09 | 时间线「TA 的近况」 | `pages/while-away-timeline.md` 第 3 节 + `pages/l3-companion.md` 第 3 节 | 已有 + 新增 |
| D-L3-07 / 09 | 熟悉度、认识天数（资料页头部、弹层、服务 › 熟悉度） | `pages/character-profile.md` 第 2 节、`pages/cards-familiarity.md` 第 2、4 节、`pages/l3-companion.md` 第 4 节 | 已有 + 新增 |
| D-L3-07 / 09 | 纪念日列表与编辑 | `pages/l3-companion.md` 第 5 节 | 新增 |
| D-L3-07 / 09 | 主动消息设置（单个角色、全局、免打扰） | `pages/private-chat.md` 6.2、`pages/me-and-services.md` 3.4、`pages/l3-companion.md` 第 6 节 | 已有 + 新增 |
| D-L3-13 | 经期日记（说明页、主页、记录、预测、让谁知道、清空、「健康」消息规则） | `pages/period-diary.md` | 已有 |
| D-L3-06 | 管理后台：公开动态（录入、审核、撤回、手动触发搜索） | `pages/admin-content.md` 第 1 节 | 新增 |
| D-L3-06 | 管理后台：节日清单 | `pages/admin-content.md` 第 2 节 | 新增 |
| D-L3-11（标签维护） | 管理后台：经期症状标签 | `pages/admin-content.md` 4.5 | 新增 |

### L4 多角色社交

| 开发项 | 页面 | 说明文件 | 状态 |
|---|---|---|---|
| D-L4-07 / 09 | 群聊页、发起群聊（选择角色）、群聊信息页 | `pages/group-chat.md` | 已有 |
| D-L4-07 / 09 | 群聊列表、@ 选人、修改群名、加人与移出、群里的未添加角色、群聊状态补充 | `pages/social-l4.md` 第 2 节 | 新增 |
| D-L4-07 / 09 | 朋友圈主页、发朋友圈 | `pages/moments.md` | 已有 |
| D-L4-07 / 09 | 某角色的朋友圈、动态详情、朋友圈消息列表、谁可以看、发朋友圈补充 | `pages/social-l4.md` 第 3 节 | 新增 |
| D-L4-07 / 09 | 新的朋友 | `pages/social-l4.md` 第 4 节（替代 `contacts-add.md` 1.2） | 新增 |
| D-L4-07 / 09 | 名片消息与添加流程 | `components.md` 4.2 `ContactCard` + `pages/social-l4.md` 第 5 节 | 已有 + 新增 |
| D-L4-01（用户端部分） | 「TA 认识的人」：自定义角色之间的关系 | `pages/social-l4.md` 第 6 节 | 新增 |
| D-L4-01（后台部分） | 管理后台：关系网 | `pages/admin-content.md` 第 3 节 | 新增 |

### L5 多媒体与通话

| 开发项 | 页面 | 说明文件 | 状态 |
|---|---|---|---|
| D-L5-10 / 12 | 图片：发送、上传进度、接收、查看、保存 | `components.md` 4.2、15.2 + `pages/media-l5.md` 第 2 节 | 已有 + 新增 |
| D-L5-03 / 10 / 12 | 语音消息：录制、权限、播放与连播、听筒、转文字、识别不可用 | `components.md` 4.2、5.4 + `pages/media-l5.md` 第 3 节 | 已有 + 新增 |
| D-L5-06 / 10 / 12 | 链接卡片：打开方式、封面失败、用户发链接 | `components.md` 4.2 + `pages/media-l5.md` 第 4 节 | 已有 + 新增 |
| D-L5-02 | 表情包：发送、添加到表情、我添加的表情 | `components.md` 5.2、`pages/me-and-services.md` 1.5 + `pages/media-l5.md` 第 5 节 | 已有 + 新增 |
| D-L5-03 | 「TA 的声音」：给角色换音色 | `pages/media-l5.md` 第 6 节；`pages/private-chat.md` 第 6 节加了一行 | 新增 |
| D-L5-08 / 10 | 通话界面（拨出、来电、通话中、结束） | `pages/call.md` | 已有 |
| D-L5-08 | 安卓全屏来电（锁屏 / 横幅 / 应用内）、通话中系统层、全屏通知权限 | `pages/media-l5.md` 第 7 节 | 新增 |
| D-L5-09 / 10 | 网页通话、iPhone 替代体验、入口显示规则 | `pages/call.md` + `pages/media-l5.md` 7.1、7.5 | 已有 + 新增 |
| D-L5-01（后台） | 管理后台：表情包、音色 | `pages/admin-content.md` 4.1、4.2 | 新增 |

### L6 养成与分享

| 开发项 | 页面 | 说明文件 | 状态 |
|---|---|---|---|
| D-L6-06 / 09 | 卡册（每个角色）、卡片详情、卡册总览 | `pages/cards-familiarity.md` 第 3 节、第 6 节；`pages/me-and-services.md` 3.1 | 已有 + 更新 |
| D-L6-06 / 09 | 成就页（**总数 34**，第 31～34 号徽章已补，分批出现规则） | `pages/cards-familiarity.md` 第 5、6 节 | 更新 |
| D-L6-06 / 09 | 收藏（完整版） | `pages/favorites.md`（替代 `me-and-services.md` 1.3） | 新增 |
| D-L6-06 / 09 | 聊天搜索：全局搜索、查找聊天记录（日期 / 图片 / 链接 / 群成员） | `pages/search.md` | 新增 |
| D-L6-06 / 09 | 分享图：编辑页、4 套模板、微伴贴纸与真人标注 | `share-templates.md` 第 1～6 节 | 已有 |
| D-L6-06 / 09 | 分享图：各入口带入内容、生成 / 保存 / 权限状态、平台差异、素材占位 | `share-templates.md` 第 7 节 | 更新 |
| D-L6-06 / 07 / 09 | 导入：聊天记录生成角色（粘贴 / 文件 / 截图）、我的补充设定 | `pages/import.md`（替代 `contacts-add.md` 4.2） | 新增 |
| D-L6-06 / 09 | 注销账号（再次输入密码、所有设备下线） | `pages/account-deletion.md`（替代 `settings.md` 第 8 节） | 新增 |
| D-L6-05（后台） | 管理后台：注销未完成（ADM-10） | `pages/admin-content.md` 第 6 节 | 新增 |
| D-L6-01（后台） | 管理后台：卡面模板 | `pages/admin-content.md` 4.3 | 新增 |
| D-L6-13 | 宠物（总览、领养、宠物页、相册、设置、改名） | `pages/pet.md`（改名已由 PRD 确认） | 已有 + 更新 |
| D-L6-11（后台） | 管理后台：宠物图鉴 | `pages/admin-content.md` 4.4 | 新增 |

### L7 社区与规划

| 开发项 | 页面 | 说明文件 | 状态 |
|---|---|---|---|
| D-L7-05 / 06 | 人设广场分页、排序筛选、作品页、作者页、点赞评论、添加与应用改版、举报 | `pages/persona-plaza.md` 第 2、3 节 | 已有 |
| D-L7-05 / 06 | 发布流程：入口、广场昵称、填写信息、**发布内容确认（遮盖片段）** | `pages/persona-plaza.md` 第 4 节 | 已有 |
| D-L7-05 / 06 | 我发布的、消息 | `pages/persona-plaza.md` 第 5 节 | 已有 |
| D-L7-05 / 06 | 角色这边的来源标注与新版本提示 | `pages/persona-plaza.md` 第 6 节、`pages/character-profile.md` 3.1 | 已有 |
| D-L7-05 / 06 | 广场各页的加载 / 失败 / 下架 / 余额不足状态 | `pages/persona-plaza.md` 第 10 节 | 更新 |
| D-L7-05 | 管理后台：人设广场管理（ADM-09） | `pages/admin.md` 第 3 节 + `pages/admin-content.md` 第 7 节 | 已有 + 新增 |
| D-L7-07 | 管理后台：行为规划（决策实现切换、决策记录） | `pages/admin-content.md` 第 5 节 | 新增 |
| D-L7-07（用户端） | 行为规划**没有任何用户可见的页面或设置**（PLAN-01 第 5 条） | — | — |
| D-L7-08 | 已采纳的 5 个玩法：TA 的提醒、心愿清单、每日一问（含回答进入私聊的卡片消息）、慢信、陪你专注 | `pages/play.md`（去掉了「候选」「待确认」） | 已有 + 更新 |
| D-L7-08 | 服务页「互动玩法」17 宫格 | `pages/me-and-services.md` 第 2 节 | 已有 |
| D-L7-08（后台） | 管理后台：每日一问题库 | `pages/admin-content.md` 4.6 | 新增 |

### 跨层的组件与令牌变化（v2.2）

| 位置 | 变化 |
|---|---|
| `components.md` 4.2 | 新增每日一问卡片消息 `QuestionAnswerCard` |
| `components.md` 6.4 | Tag 新增成功 / 注意 / 危险三个状态变体（只用于后台和导入结果） |
| `components.md` 7.2 | InlineTip 新增中性变体（固定说明） |
| `components.md` 9.6 | 成就总数 34 |
| `components.md` 15.4 | TimePickerSheet 新增日期变体 |
| `components.md` 20.1、20.7 | 后台菜单补「节日清单」「行为规划」「注销未完成」；DetailDrawer 新增编辑变体 |
| `components.md` 第 21 节 | 新增 SearchResultRow、DateJumpCalendar、ProgressBar、ImagePickerGrid、UploadArea、VoiceToneRow |
| `tokens.json` | **无变化**（全部用现有令牌） |

## 3. 美术素材占位清单（不追求精美插画，先占位、后替换）

| 素材 | 用在 | 开发期占位 | 规格在 |
|---|---|---|---|
| 34 枚成就徽章插画 | 成就页 | 分组色底座 + Phosphor 图标（逐个列出） | `pages/cards-familiarity.md` 5.3 |
| 卡面模板（纪念、熟悉度、节日、瞬间、宠物、心愿、慢信） | 卡册、卡片详情、卡片风分享图 | 类型色铺底 + 类型图标 + 应援色圆点 | `pages/cards-familiarity.md` 第 6 节 |
| 分享图装饰（颗粒、星星、缎带、邮票齿孔） | 分享图 | 省略或用品牌星星、虚线边框代替 | `share-templates.md` 7.5 |
| 品牌来电铃声 | 安卓来电 | 系统默认来电铃声 | `pages/media-l5.md` 7.2 |
| 导入生成中插画 | 导入第 6 步 | Phosphor book-open 64 | `pages/import.md` 2.6 |
| 空状态插画（各页 EmptyState） | 各页 | 不放插画，只留标题和说明（C 6.12 允许省略插画） | `brand.md` 第 6 节 |
| 宠物各物种、各阶段图 | 宠物 | 管理员在图鉴上传；没有时用 Phosphor paw-print | `pages/pet.md` 第 7 节 |
| 音色试听音频 | TA 的声音、后台音色 | 管理员在后台「生成试听」 | `pages/media-l5.md` 第 6 节 |

## 4. 需要总负责人处理的冲突与缺口

设计按「同一信息只在一处定义」只写自己负责的界面；以下是发现的冲突和需要其他负责人补的东西，**设计没有自行选边**，请总负责人转交或裁定。

| # | 问题 | 涉及 | 建议 |
|---|---|---|---|
| 1 | 任务卡 T-056 要求在**聊天信息页**展示熟悉度与认识天数；设计（v2.0 起，对齐参照产品）放在**角色资料页头部**，聊天信息页只放设置 | T-056、T-057；`private-chat.md` 6.1 | 建议按设计实现，改任务卡。若坚持放聊天信息页，设计再补一个只读行 |
| 2 | T-056 写主动消息频率「关闭 / 低 / 中 / 高」；PRD CHAT-13 是「开关 + 少 / 适中 / 多」 | T-056 | 数据一一对应即可，界面按 PRD（`l3-companion.md` 6.1）；无需裁定，仅请任务卡同步 |
| 3 | T-055、T-056 的「输入文档」路径不存在：`prd-v1/08-simulation.md`、`prd-v1/14-admin.md` 应为 `06-simulation-proactive.md`、`13-admin.md`；T-055 要读的 T-052 交接说明目前不在 `docs/handoffs/` | T-055、T-056 | 改任务卡路径；T-052 交接到位后核对公开动态状态枚举（`admin-content.md` 1.1 的状态表按界面名称写，等契约对上） |
| 4 | 「你不在时」显示门槛：PRD P-18 是**距上次进入该私聊 ≥ 12 小时**；T-054 实现的是**离线 ≥ 1 小时** | AI（T-054）、产品 | 请 AI 负责人按 P-18 改，或请产品改 P-18；客户端只看接口是否返回 `summary` |
| 5 | 契约只有摘要接口，**没有时间线列表接口**；摘要事件也没有时间、没有朋友圈 / 角色互动 / 公开动态类型和来源链接 | 架构、AI | 请补 `TimelineEndpoints` 列表接口（分页、时间、类型、来源）；接口到位前时间线页显示空状态（`l3-companion.md` 第 3 节） |
| 6 | 每日一问回答进入私聊需要一种**新消息类型**（卡片消息） | 架构（契约） | 按设计 `QuestionAnswerCard` 字段：题目、回答、日期、题目 ID |
| 7 | 「TA 认识的人」（自定义角色之间的关系）需要用户端增删改查接口；契约里是否已有未确认 | 架构、后端（D-L4-01） | 请确认或补接口 |
| 8 | 导入「生成中可离开」「进行中的导入」「保存草稿」需要服务器保存导入任务和未保存的草稿 | 后端（importer） | 请确认 importer 的任务列表与草稿保存能力 |
| 9 | 音色试听用预先生成的音频、不扣用户余额 | AI、后端（media） | 请确认可行；不可行时试听按钮隐藏 |
| 10 | 名片推荐的角色**已下架**时能否添加，PRD 未写；设计暂定「TA 暂时不能添加」 | 产品 | 请产品确认（`social-l4.md` 第 5 节） |
| 11 | 安卓 14 起全屏来电需要单独的「全屏通知」权限；设计给了引导流程 | Android | 请 Android 负责人确认厂商机型上的实际表现（`media-l5.md` 7.4） |
| 12 | 后台 L0～L2 的页面（角色库、模型与价目、邀请码、用户与余额主体）没有设计说明，已按开发任务实现 | 设计、Web | 不在本次 L3～L7 范围；如需统一，另开设计任务补齐 |
| 13 | 群聊列表：参照产品只列「保存到通讯录」的群，设计改为列出全部群（微伴群少） | 产品（如有异议） | 设计决定，记 D-29；无异议则不需处理 |

## 5. 本次新增的设计决定

已同步写入 `README.md` 设计决定记录表（D-25～D-33）。

## 6. 文件变更清单（v2.2）

- 新增：`pages-l3-l7-index.md`（本文）、`pages/l3-companion.md`、`pages/admin-content.md`、`pages/social-l4.md`、`pages/media-l5.md`、`pages/search.md`、`pages/favorites.md`、`pages/import.md`、`pages/account-deletion.md`。
- 更新：`components.md`、`share-templates.md`、`README.md`、`pages/README.md`、`pages/cards-familiarity.md`、`pages/play.md`、`pages/pet.md`、`pages/persona-plaza.md`、`pages/private-chat.md`、`pages/me-and-services.md`、`pages/contacts-add.md`、`pages/settings.md`。
