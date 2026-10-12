# 安卓 L6：卡册、成就、收藏、聊天记录搜索、分享图（T-085）

> 负责人：android-lead · 2026-10-10 · 状态：**未编译、未测试**（本机无安卓环境）。
> 功能与参数以 `docs/tasks/T-083-l6-web-cards-share.md`、`docs/design/share-templates.md`、`docs/design/pages/cards-familiarity.md` 为准，本文只记安卓实现位置与取舍。

## 1. 页面与入口

| 功能 | 入口 | 代码（`feature/chat`） |
|---|---|---|
| 卡册总览 | 我 › 服务 › 陪伴 › 卡册 | `CardsAchievements.kt` `CardAlbumsScreen` |
| 某角色卡册 | 资料页「卡册 ›」、聊天信息页「卡册 ›」、总览点一行 | `CardAlbumPage` |
| 卡片详情（翻面、左右滑、首次弹出动画、生成分享图） | 卡册点卡、聊天里「获得 XX 卡 ›」系统提示 | `CardDetailOverlay`（全局浮层） |
| 成就页（按接口返回数量做分母，新获得红点） | 我 › 服务 › 陪伴 › 成就 | `AchievementsScreen` |
| 获得成就轻提示（顶部 3 秒，最多连续 3 枚） | 任何页面收到 `data.changed(achievements)` | `L6Shared.kt` `AchievementToasts` |
| 熟悉度总览 | 我 › 服务 › 陪伴 › 熟悉度 | `FamiliarityOverviewScreen` |
| 我的收藏（角色筛选、搜索、加载更多、多选生成分享图 / 取消收藏） | 我 › 收藏 | `Favorites.kt` |
| 收藏 | 消息长按「收藏」（原有）、长按「多选」后底栏「收藏」、朋友圈「…」› 收藏 | `ConversationUi.favoriteSelected`、`Moments.kt` `MomentMore` |
| 全局搜索（角色、群聊、聊天记录，300 ms 防抖，高亮） | 会话列表顶部「搜索」 | `ChatSearch.kt` `GlobalSearchScreen` |
| 会话内搜索（关键词翻页；图片 / 链接快速查找） | 私聊 / 群聊聊天信息页「查找聊天记录」 | `ConversationSearchScreen` |
| 结果定位（加载附近消息、滚到约 1/3 处、闪一下） | 搜索结果、收藏点开 | `MessageLocator` + `ChatScreen.kt` `LocateEffects` + `core/data` `ChatHistory.reveal` |
| 分享图编辑页 | 聊天多选「分享图」、收藏、朋友圈「…」、卡片详情 | `ShareEditor.kt`（全局浮层） |
| 分享图绘制（4 套模板、微伴贴纸） | — | `ShareRender.kt`（与网页 `share-render.ts` 同一份排版） |

全局浮层 `GrowthShareOverlay` 由 `app/MainActivity.kt` 放在通话浮层旁边，盖在所有页面上。

## 2. 分享图

- 原生 `Canvas` 绘制到 `Bitmap`：360 逻辑宽 × 3 = 1080 像素；高度随内容（最小 480，上限 6000 防止内存过大）；卡片风固定 360×480。
- 四套模板固定浅色；「聊天原样」固定取 `WbColorSets.PinkLight`，不画状态栏、无绿色气泡。
- 微伴贴纸按服务器 `label` 画一行或两行，没有任何开关；含真人时选项区显示锁定说明。
- 默认隐藏「我」的头像昵称（显示为「我」+ 中性默认头像）；显示时间、显示「认识第 N 天」（只有单个角色、非群聊才有）、设为默认模板。
- 朋友圈不能选卡片风；卡片入口只能用卡片风；卡片风超过 3 条 / 120 字提示「内容太多，建议用其他模板」。
- 多选超过 30 条或含成人模式 / 健康消息时按钮禁用并写明原因；服务器 422 时提示同一句话并关闭编辑页。
- 保存：PNG（超过 4MB 改 JPEG 92），`MediaStore` 写入 `Pictures/微伴`；安卓 10 起不要权限，8～9 先申请写入权限，拒绝后弹「需要相册权限才能保存」+「去设置」。
- 分享：写入缓存 `share-images/`，经 `core/designsystem` 已有的 FileProvider（新增一个 cache-path）交给系统分享面板。
- 保存或分享成功后回报 `POST /library/share-images/generated`（成就第 21 号）。
- 图片素材 5 秒拿不到画占位，并提示「有 N 张图片没加载出来」。

## 3. 取舍与已知限制

1. 会话内「日期」查找和群成员筛选没做（契约无按日期 / 按发送者接口）；「图片 / 链接」只覆盖本机已加载的消息。
2. 收藏点开只有原消息在本机缓存里时才能跳回聊天（`Favorite` 无 `seq`），否则弹详情。
3. 「我 › 服务」页的卡册 / 成就宫格红点没做（me 模块读不到 chat 模块数据）；红点只在卡册总览每行、成就页内显示。
4. 徽章插画、卡面模板、分享图装饰都是占位（分组色圆底 + 星星 / 编号、类型色 + 星星、虚线邮票框）。
5. 定位时从本地最早一条往前连续翻页（每页 200，最多 10 页）；更远的直接取目标前后一页，时间线会有缺口，可用「更早的消息」补齐。
