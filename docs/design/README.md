# 微伴设计体系（docs/design）

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 版本 | v1.0（T-006） |
| 日期 | 2026-10-04 |

按「需求 → 交互流程 → 设计系统 → 页面设计」的顺序阅读：

| 步骤 | 文件 | 内容 |
|---|---|---|
| 1 需求 | `01-requirements.md` | PRD 需求翻译成设计任务；四条设计红线；PRD 8.3 五个问题的回答位置 |
| 2 交互流程 | `02-interaction-flows.md` | 信息架构、导航方式、手势、核心流程界面走法、响应式布局 |
| 3 设计系统 | `brand.md` | 品牌调性、配色、字体、图标、插画方向 |
| | `tokens.json` / `tokens.css` | 设计令牌（**所有数值的唯一来源**；CSS 与 JSON 同步，冲突以 JSON 为准） |
| | `default-avatar.md` | 真人角色非肖像默认头像方案 |
| | `motion.md` | 动效规范与性能符合性 |
| | `components.md` | 组件清单与规范 |
| | `share-templates.md` | 分享图 4 套模板与必带标注 |
| 4 页面设计 | `pages/` | 核心页面设计说明（索引见 `pages/README.md`） |
| 样张 | `preview/index.html` | 用浏览器打开即可（需要能访问 unpkg.com 以加载图标）；展示令牌、组件、会话列表与私聊页；支持深浅色切换 |

## 设计决定记录

| # | 决定 | 理由 | 位置 |
|---|---|---|---|
| D-01 | 令牌格式用 W3C Design Tokens 风格的 JSON + CSS 变量，与框架无关 | 任务卡要求；Web、Android 原生壳都能读取 | `tokens.json` |
| D-02 | 第一个标签叫「消息」不叫「微信」 | 不冒用他人品牌名 | `02-interaction-flows.md` |
| D-03 | 自己的气泡用浅粉代替微信浅绿 | 品牌感；与微信截图可区分 | `brand.md` 3.1 |
| D-04 | 默认头像 = 应援色 + 名字字 | SAFE-01；粉丝文化认同 | `default-avatar.md` |
| D-05 | 熟悉度用月相，不用爱心 | 不恋爱化（GRW） | `components.md` 9.4 |
| D-06 | 「你不在时」摘要卡做成悬浮层 | 收起时不让消息列表跳动（虚拟滚动） | `pages/while-away-timeline.md` |
| D-07 | 分享图「聊天原样」模板还原微伴自己的界面而非微信界面，不画状态栏 | 防止被当成本人真实截图（SAFE-02）；名称待产品确认 | `share-templates.md` 4.2 |
| D-08 | 含真人内容的分享图顶部加「AI 角色 · 非本人」小标签 | 防止裁掉底部标注后传播 | `share-templates.md` 3 |
| D-09 | 不用毛玻璃、不用 3D 翻转、骨架屏不用流光 | 性能硬约束 | `motion.md` |
| D-10 | 图标库选 Phosphor Icons（MIT） | 线性 / 填充两种风格齐全，风格圆润 | `brand.md` 5 |

修改任何文件时同步更新本表。
