# 安卓：人设广场（T-098，L7）

> 负责人：android-lead · 2026-10-11 · 依据：`docs/design/pages/persona-plaza.md`、契约 `PlazaEndpoints` / `CustomCharacterOriginEndpoints`、网页同功能交接 `docs/handoffs/2026-10-11-web-lead-T-097.md`（取舍照搬）。
> 状态：**未编译、未测试**（按总经理「一步到位、不审查不测试」要求）。

## 1. 代码位置

都在 `apps/android/feature/chat/src/main/kotlin/app/weiban/feature/chat/`（没有新建 Gradle 模块，避免改依赖锁文件）：

| 文件 | 内容 |
|---|---|
| `PlazaShared.kt` | 返回栈 `PlazaNav`、页面 `PlazaPage`、文案表、快照解析、广场头像（公开 URL 用 OkHttp 加载 + 内存缓存，失败显示非肖像默认头像）、红点 `rememberPlazaBadge` |
| `PlazaBrowse.kt` | 广场浮层 `PlazaOverlay`、「人设广场」分页（搜索 / 三种排序 / 两种筛选 / 列表 / 加载更多 / 四种状态）、作品页、评论、作者页、举报 |
| `PlazaPublish.kt` | 广场昵称、我发布的（作品 / 消息）、发布流程（填写 → 昵称 → 检查中 → 确认 → 发布）、改写弹窗 |
| `PlazaEntries.kt` | 聊天信息页「发布到人设广场」、补充设定页「发布为改版」、来源标注与新版本弹层 |

接入点：`RoleBrowser.kt`（角色广场顶部「预设角色 | 人设广场」切换，新手引导不显示）、`ChatInformation.kt`、`Supplement.kt`、`CharacterScreen.kt`、`L6Shared.kt`（`GrowthShareOverlay` 放置 `PlazaOverlay`）。

## 2. 关键取舍

- **广场是全屏浮层，自带返回栈**：任何页面 `PlazaNav.open(...)` 推入；系统返回逐层退出；评论输入栏打开时先收起输入栏。换账号时清空。
- **「添加为我的角色」不调 `POST /contacts`**（T-088：服务器已自动加进通讯录），成功后只同步一次（`runtime.refresh`），按钮变「已添加 · 去聊天」；对方还没通过时提示「等待 TA 通过好友申请」。
- **红点只靠 `getBadge` + `data.changed(plaza_badge)`，不产生任何系统通知**；安卓没有为广场事件写通知代码。
- **没有私信、关注入口**；点评论者头像没有反应；作者页只有头像、昵称和作品列表。
- **发布确认页的片段**按 `fieldKey` + 码点位置切片（与网页 `Array.from` 一致），片段可能是整个字段；未保留的显示「① ▢▢▢」，保留须二次确认「这不是我的私人信息」；有待处理项也能发布（照样遮住）。
- **改写**：设计是推入字段编辑页，这里用弹窗。自定义角色写回 `PATCH /characters/custom/:id`（名字、人设描述、示例对话、标签、第 1 条口头禅）；预设改版写回补充设定全文；保存后重新生成草稿。说话方式、第 2 条以后的口头禅契约没有可写字段，弹窗提示到网页修改。
- **发布新版本的预填**：契约没有作品的来源角色 ID，按名字（自定义角色）/ 预设 ID（改版）匹配「我发布的」（同网页）。
- 作品页 404 显示「这个作品已经看不到了」；点赞乐观更新、失败回退 +「没成功，请重试」；评论超过 200 字计数变红、发送禁用；重复举报 409 提示「你已经举报过这个内容」，本次打开期间菜单变「已举报」。
- 安卓的 `ApiFailure` 不带服务器的文字原因：被拒（403 `plaza_publish_forbidden`）时显示列举可能原因的固定文案。

## 3. 已知缺口

见交接 `docs/handoffs/2026-10-11-android-lead-T-098.md`「遗留问题」。
