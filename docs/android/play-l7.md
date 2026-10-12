# 安卓：五个玩法（T-100，L7）

> 负责人：android-lead · 2026-10-11 · 依据：`docs/design/pages/play.md`、契约 `play.ts`、网页同功能交接 `docs/handoffs/2026-10-11-web-lead-T-099.md`（取舍照搬）。

## 代码位置（`apps/android/feature/chat/src/main/kotlin/app/weiban/feature/chat/`）

| 文件 | 内容 |
|---|---|
| `PlayShared.kt` | 返回栈 `PlayNav`、宿主入口 `PlayNavigation.openRoute`、带错误码的读取 `playRemote`（收到 `data.changed` 自动重拉）、选角色、玩法浮层 `PlayOverlay`、顶部专注胶囊 |
| `PlayDailyWish.kt` | 每日一问（选角色、作答 200 字、揭晓三种状态、历史）、心愿清单（总览、清单、50 项上限、打勾、定日期、删除） |
| `PlayLetters.kt` | 信箱（收到 / 寄出 / 草稿，送达前只显示「信件在路上」）、写信（信纸衬线字体、2000 字、草稿、离开确认）、读信（收藏、分享图、回信） |
| `PlayFocusReminders.kt` | 陪你专注（5–120 分钟，以服务器 `endsAt` 倒计时，提前结束只有「结束 / 取消」）、TA 的提醒（10 条上限、20 字、重复方式、健康、免打扰也提醒） |

## 入口

- 我 › 服务 › 互动玩法：每日一问、心愿清单、信箱（有未读来信时「●」）、陪你专注、TA 的提醒。宿主 `MainActivity` 把 `play:xxx` 交给 `PlayNavigation`。
- 聊天信息页「心愿清单 ›」；私聊「+」面板「写信」「陪我专注」（只在私聊）。
- 私聊里的信件卡片点开读信、每日一问卡片点开历史里这一题。
- **慢信推送链接 `/play/letters/{letterId}`**：`platform/NotificationPolicy.kt` 白名单放行（校验 UUID），`MainActivity` 的 `route()` 遇到 `/play/` 打开玩法浮层的读信页（打开即已读）。

## 说明

- 没有连续天数、完成率、累计时长、排行、「失败」状态。
- 「健康」类提醒的通知不显示内容：通知标题和正文由服务器下发，安卓照原样显示（沿用 L3 做法），安卓端没有单独处理。
