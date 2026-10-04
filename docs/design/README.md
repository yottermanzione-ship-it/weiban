# 微伴设计体系（docs/design）

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 版本 | v2.0（T-012；v1.0 为 T-006） |
| 日期 | 2026-10-04 |

按「需求 → 交互流程 → 设计系统 → 页面设计」的顺序阅读：

| 步骤 | 文件 | 内容 |
|---|---|---|
| 1 需求 | `01-requirements.md` | PRD v1.2 翻译成设计任务；对齐参照产品的原则与有意差异；四条设计红线 |
| 2 交互流程 | `02-interaction-flows.md` | 信息架构（含「我 → 服务」）、导航、手势、核心流程界面走法、响应式 |
| 3 设计系统 | `brand.md` | 品牌调性、两套主题、配色、字体、图标、插画、logo |
| | `tokens.json` | 设计令牌，**所有数值的唯一来源**，按主题 × 深浅模式组织 |
| | `tokens.css` | 网页用 CSS 变量，**由脚本生成**，不手改 |
| | `tokens-android.md` | 令牌在安卓 Kotlin / Compose 中的格式与用法 |
| | `scripts/build-tokens.mjs`（仓库根目录） | 生成脚本：`--css`、`--kotlin`、`--check`；根命令 `pnpm tokens` |
| | `default-avatar.md` | 头像显示优先级与非肖像默认头像 |
| | `motion.md` | 动效规范与性能符合性（网页 + Compose） |
| | `components.md` | 组件清单与规范（两端通用） |
| | `share-templates.md` | 分享图 4 套模板与微伴贴纸 |
| 4 页面设计 | `pages/` | 页面设计说明（索引见 `pages/README.md`） |
| 样张 | `preview/index.html` | 浏览器打开即可；可切换两套主题和深浅模式；展示会话列表、私聊、「我」页、服务页、令牌和组件。图标需能访问 unpkg.com |

改令牌的步骤：改 `tokens.json` → `pnpm tokens`（重新生成 `tokens.css`）→ `pnpm tokens --check`（确认已是最新；CI 也会检查）。

## 设计决定记录

| # | 决定 | 理由 | 位置 |
|---|---|---|---|
| D-01 | 令牌格式用 W3C Design Tokens 风格的 JSON，CSS 和 Kotlin 都由脚本生成 | 一处定义，两端不会对不上（ADR-0011） | `tokens.json`、`tokens-android.md` |
| D-02 | 第一个标签叫「微伴」（v1.0 为「消息」） | 对齐参照产品「第一个标签用自家品牌名」的结构；不用对方的名字 | `02-interaction-flows.md` |
| D-03 | ~~自己的气泡用浅粉~~ → v2.0：气泡颜色跟随主题（默认主题草绿、微伴粉主题浅粉） | 默认配色接近参照产品（SVC-01 第 7 条） | `brand.md` 3.2 |
| D-04 | 默认头像 = 应援色 + 名字字；显示优先级 用户上传 > 管理员上传 > 默认 | SAFE-01 第 5 条 | `default-avatar.md` |
| D-05 | 熟悉度用月相，不用爱心 | 不恋爱化（GRW） | `components.md` 9.4 |
| D-06 | 「你不在时」摘要卡做成悬浮层 | 收起时不让消息列表跳动 | `pages/while-away-timeline.md` |
| D-07 | 分享图「聊天原样」还原微伴粉界面，不还原参照产品界面，不画状态栏 | 防止被当成本人真实截图（SAFE-02）；产品已采纳（EXP-02） | `share-templates.md` 4.2 |
| D-08 | ~~顶部「AI 角色 · 非本人」小标签~~ → v2.0：logo + 文案组合成一枚「微伴贴纸」 | 总经理要求和 logo 放在一起、做推广露出、不死板（EXP-01 第 5 条） | `share-templates.md` 3 |
| D-09 | 不用毛玻璃、不用 3D 翻转、骨架屏不用流光 | 性能硬约束 | `motion.md` |
| D-10 | 图标库 Phosphor Icons（MIT）；安卓用同一套 SVG 转 Vector Drawable | 两端一致 | `brand.md` 5 |
| D-11 | 颜色分三层：原始色板 → 主题（bg / text / border / brand / bubble 五组随主题变）→ 模式颜色（其余只随深浅变） | 换主题只换「底色、文字灰、强调色、气泡」，养成和状态颜色两个主题一致，主题数量以后可扩展 | `tokens.json`、`brand.md` 3.1 |
| D-12 | 默认主题强调色 `#0AA35A`，比参照产品品牌绿深一档 | 不与对方品牌色相同（SVC-01 第 7 条）；白字对比度 3.28:1 达到界面元素标准 | `brand.md` 3.2、3.4 |
| D-13 | 气泡圆角 6 + 小尖角，头像圆角比例 0.12（v1.0 为 10 无尖角、0.22） | 「尽可能像参照产品」（原则 8） | `components.md` 4.1、`tokens.json` |
| D-14 | 微伴粉保留给 logo、App 图标、分享图、熟悉度、卡片、成就，不随主题变 | 这些是微伴独有、会被晒出去的东西，保持品牌识别 | `brand.md` 3.3 |
| D-15 | 服务页顶部卡片用强调色整块铺底，宫格图标用彩色点缀色 | 对应参照产品服务页的观感；点缀色两个主题共用 | `components.md` 16.1、16.2 |
| D-16 | 安卓关闭 Material 水波纹，按下用灰色叠加层；标题栏居中 | 像参照产品安卓版，两端一致 | `components.md` 0.1 |

修改任何文件时同步更新本表。
