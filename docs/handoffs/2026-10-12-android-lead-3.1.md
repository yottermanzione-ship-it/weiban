# 交接说明：契约 3.1 安卓用户端 + 联系人「发消息」间歇失败修复

| 项 | 内容 |
|---|---|
| 负责人 | Android 负责人 |
| 日期 | 2026-10-12 |
| 分支 / 提交 | `android-3.1`（worktree `C:\wb-dev\wb-and31`）：`62de7ab`（3.1 W9）、`62a43ed`（布局修复）；已快进合入 `local/trunk`（`C:\wb-dev\wb-int`，HEAD `62a43ed`） |
| 自检 | `pnpm android:generate:check` 一致；`ktlintCheck detekt assembleDebug` BUILD SUCCESSFUL；`RoleBrowserTest` 5/5 通过（只跑这一个类） |
| APK | `C:\wb-dev\wb-and31\apps\android\app\build\outputs\apk\debug\app-debug.apk` |

## 做了什么

### 1. 契约 3.1 安卓用户端（按网页交接「给安卓照做的 10 条清单」）

先逐项核对代码，绝大部分 Codex 顶班时已做，只补了一个缺口。

| 项 | 状态 | 位置 |
|---|---|---|
| W1 图片 < 1 MB 才能「添加到表情」 | Codex 已做 | `MessageActions.kt` |
| W3 会话内按日期 / 类型查找、群成员筛选 | Codex 已做 | `ChatSearch.kt` |
| W4 收藏快照、按 `seq` 定位 | Codex 已做 | `Favorites.kt` |
| W5 `ApiFailure.details`、分享逐条拒绝原因 | Codex 已做 | `ApiClient.kt`、`ShareEditor.kt` |
| W7 继续导入下一批 / 保存草稿 / 冲突与过滤数 / 无识图置灰 | Codex 已做 | `Import.kt` |
| W8 `data.changed(supplement)` 刷新补充设定 | Codex 已做 | `Supplement.kt` |
| W9 发布新版本、「已发布 · 版本 N」、红点与下架原因 | Codex 已做 | `PlazaEntries.kt`、`PlazaPublish.kt` |
| W9 作品页按 `myAdoptedCharacterId` 显示「已添加 · 去聊天」、复制品有新版本时「更新到版本 N」 | **本次补** | `PlazaBrowse.kt`（WorkPage 操作栏）、`PlazaEntries.kt`（新增 `AdoptedUpdateButton`） |
| W10 多条口头禅与说话方式 | Codex 已做 | `CustomCharacterEditor.kt` |
| W11 三种玩法系统提示、寄信顺延原因 | Codex 已做 | `ChatScreen.kt`、`PlayLetters.kt` |
| 推送 `kind=import` → `/imports/{jobId}` | Codex 已做 | `NotificationPolicy.kt`、`MainActivity.kt` |

### 2. RoleBrowserTest 联系人「发消息」间歇失败

原因：角色资料页里「发消息」排在资料内容（头像、简介、熟悉度等）下面，资料异步到达后按钮从 y≈299 被推到 y≈531，超出视口，点击落空。

修法（只改产品代码，未动测试）：资料页改为固定布局——进度条占定高 4dp 的位置、头部（头像 + 名字）定高 64dp 并在资料未到时占位、「发消息 / 添加到通讯录 / 等待通过」主操作紧跟头部，简介等异步内容放到按钮下方。这样资料加载前后按钮位置不变。

## 改了哪些文件

- `apps/android/feature/chat/src/main/kotlin/app/weiban/feature/chat/PlazaBrowse.kt`
- `apps/android/feature/chat/src/main/kotlin/app/weiban/feature/chat/PlazaEntries.kt`
- `apps/android/feature/chat/src/main/kotlin/app/weiban/feature/chat/CharacterScreen.kt`

## 遗留问题

- 资料页主操作上移到头部下方，视觉顺序与原设计稿（按钮在资料末尾）不同，需设计负责人确认是否接受；如要放回底部，应改为页面底部固定操作栏（不随内容滚动），同样能避免跳位。
- 「更新到版本 N」需要额外请求一次 `getOrigin`（仅在我添加过该作品时），与网页一致。
- 按总经理要求未写新测试、未做真机验证；未跑全量安卓单测。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给项目总负责人：两项已合入 `local/trunk`；可通知 Codex 用受控迟到资料回归验证联系人打开回调。
- 给设计负责人：请确认资料页主操作上移的排布（见遗留问题第 1 条）。
