# 网页：卡册、成就、收藏、搜索、分享图（T-083）

> 负责人：web-lead · 2026-10-10 · 对应 D-L6-06 第一部分。设计依据见 `docs/design/pages/cards-familiarity.md`、`favorites.md`、`search.md`、`share-templates.md`；接口见 `packages/contracts/src/http/growth-cards.ts`、`library.ts`、`chat-groups.ts`（`ChatSearchEndpoints`）。

## 1. 页面与入口

| 页面 | 路由 | 入口 |
|---|---|---|
| 卡册总览 | `/services/cards` | 服务 › 陪伴 › 卡册（新卡红点） |
| 某角色卡册 + 卡片详情 | `/characters/:id/cards?card=` | 角色资料页「卡册」、聊天信息页「卡册」、聊天里「获得 XX 卡 ›」系统提示 |
| 成就 | `/services/achievements` | 服务 › 陪伴 › 成就（新成就红点） |
| 熟悉度总览 | `/services/familiarity` | 服务 › 陪伴 › 熟悉度 |
| 我的收藏 / 收藏详情 | `/me/favorites`、`/me/favorites/:id` | 我 › 收藏 |
| 全局搜索 | `/search?q=` | 会话列表顶部「搜索」；电脑上 Ctrl / ⌘ + F |
| 某会话的命中列表 | `/search/:conversationId?q=` | 全局搜索「N 条相关聊天记录」 |
| 会话内查找聊天记录 | `/chat/:id/search` | 私聊 / 群聊的聊天信息页 |
| 分享图编辑页 | `/share`（`location.state.source`） | 聊天多选「分享图」、收藏、朋友圈「…」、卡片详情 |

## 2. 实现要点

- **定位到消息**：聊天页读 `?seq=`，向前补读历史直到目标消息出现，`VirtualList` 新增 `scrollTo`（停在距顶部 1/3）和 `rowClassName`（闪一下，只动 opacity）。目标消息不在了提示「这条消息已删除」。
- **多选**：消息「•••」菜单 →「多选」。底栏「收藏」「分享图」。超过 30 条（P-24）或含成人模式（`scope = adult`）/「健康」标记（`labels` 含 `health`）的消息时「分享图」禁用并显示原因；最终以服务器 422 为准。
- **分享图**：`features/share-render.ts` 在画布上按 360 逻辑宽排版、3 倍导出 1080 宽；颜色、字体全部取自 `docs/design/tokens.json`（四套模板固定浅色，「聊天原样」固定 `theme.pink.light`）。贴纸文案只看服务器给的 `label`，编辑页没有隐藏贴纸的选项。默认隐藏「我」的头像昵称。PNG 超过 4MB 改 JPEG 92。
- **保存**：安卓 / 电脑浏览器直接下载文件；iPhone（含主屏幕 App）弹出全屏图片 +「长按图片保存」（iOS 网页无法直接写相册）。浏览器支持带文件的 Web Share 时显示「分享」。
- **红点**：卡册按「每个角色看过的张数」、成就按「上次离开成就页的时间」记在本机（`data/seen.ts`），首次使用记基线不亮红点。
- **成就轻提示**：`AchievementWatcher` 收到 `data.changed(achievements)` 后重拉，对比出新获得的，Toast 3 秒依次显示，最多 3 枚。

## 3. 性能检查（本次交付）

| 项 | 结果 |
|---|---|
| 聊天列表虚拟滚动 | 仍走 `VirtualList`；多选、定位、闪烁都在虚拟行内完成，不额外渲染全部消息 |
| 动画 | 卡片弹出（transform + opacity）、翻面（opacity）、定位闪烁（opacity）、预览淡入（opacity）、加载转圈（transform） |
| 强制重排 | 定位只在 `useLayoutEffect` 里写一次 `scrollTop`；分享图绘制在离屏画布，不碰页面布局 |
| 大图 | 卡面、收藏缩略图、图片墙用 `loading="lazy"` / 缩略图接口；分享图里的图片 5 秒超时用占位 |
| 构建体积 | 主包约 1.0 MB（未压缩）；含 `tokens.json`（约 45 KB）。按页面拆包仍是技术债 |
| 帧率 / 首屏实测 | **本轮按总经理要求未在浏览器实测**，留给整体验收 |
