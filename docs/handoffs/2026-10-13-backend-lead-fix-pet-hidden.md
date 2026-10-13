# 交接说明：安卓换壳遗留的两个后端问题（内置宠物图 WebP、隐藏会话全量同步）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-13 |

来源：`docs/handoffs/2026-10-13-android-lead-ui-refresh.md` 遗留问题两条。

## 做了什么

1. **内置宠物图在安卓显示不出来**
   - `GET /api/v1/media/:mediaId/content` 对内置素材（`builtin/...`）按请求的 `Accept` 头选格式：
     - `Accept` 为空或含 `image/svg+xml`（浏览器 `<img>` 默认就含）→ 照旧返回 SVG；
     - 否则含 `image/webp` → 用 sharp 现场转 WebP；含 `image/png` → 转 PNG；
     - 都不含 → SVG。
   - 响应加 `Vary: Accept`。
   - 安卓下载图片本来就发 `Accept: image/webp`，所以**安卓无需改动**，下次请求即可拿到 WebP 原图（占位图只在失败时出现）。网页不受影响。
   - 不改契约（同一地址，只是按 Accept 协商内容格式）。
2. **隐藏会话在全量同步后从客户端消失**
   - `GET /api/v1/conversations` 现在**也返回用户隐藏的会话**（`state.hidden = true`）。已归档会话、试聊会话（`trialExpiresAt` 非空）仍不返回，与以前一致。
   - 网页（`apps/web/src/features/conversation-list.tsx`）和安卓（`ChatScreen.kt` 会话列表）本来就按 `!state.hidden` 过滤会话列表、未读数也只算过滤后的，所以**两端都无需改动**；全量同步后隐藏会话留在本地，「通讯录 › 群聊」能找到。
   - 契约只改了该接口的 `summary` 说明文字（响应结构不变），已重生成安卓 `contracts.json`（Kotlin 代码无变化，无需重编安卓）。

## 改了哪些文件

- `apps/server/src/modules/media/application/media.ts`（`download` 增加 `accept` 参数与 `builtinFormat`）
- `apps/server/src/modules/media/http/media.controller.ts`（读 `Accept` 头、加 `Vary`）
- `apps/server/src/modules/chat/application/read.ts`（`listForUser` 不再过滤 hidden，改为跳过试聊会话）
- `packages/contracts/src/http/chat.ts`（`listConversations.summary` 说明）
- `apps/android/core/contracts-generated/src/main/resources/contracts.json`（重生成）

## 遗留问题

- 按授权未写、未跑测试；只跑了 typecheck / lint / build。建议 Codex 验收时补：内置素材在 `Accept: image/webp` 下返回 `image/webp`、浏览器 Accept 下返回 SVG；会话列表包含 hidden 会话、不包含试聊会话。
- 现有测试里若有「会话列表不含隐藏会话」的断言，需按新行为更新。
- WebP 每次现场转换（几十毫秒级，图很小），暂不缓存；量大再加内存缓存。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 android-lead：无需改代码。可以考虑把内置宠物的「圆底 + 小动物符号」占位只保留为失败兜底（现状已如此）。
- 给 web-lead：无需改代码。若有其他页面直接遍历全部会话（如转发选择器）而未过滤 `state.hidden`，行为与「隐藏后本地仍有该会话」时一致，不是新问题。
- 给 architect：契约仅说明文字变化，无结构变更。
