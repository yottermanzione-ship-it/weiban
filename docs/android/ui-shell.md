# 安卓换壳：微信式外壳与微伴小程序

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 日期 | 2026-10-13 |
| 依据 | `docs/refactor/02-wechat-shell-and-miniprograms.md`、`02a-navigation-tree.md`；网页实现 `apps/web/src/features/shell-kit.tsx`、`miniapps.tsx` 为参照 |

本文只说明安卓这边「东西放在哪、怎么接」，页面去哪以 `02a-navigation-tree.md` 为准，不在此重复。

## 1. 通用部件（`core/designsystem`）

| 文件 | 内容 |
|---|---|
| `ShellKit.kt` | `WbNavBar` 标题栏（‹ 返回 · 居中标题 · 右侧操作）、`NavAction`、`IconTile` 圆角方块图标、`MenuGroup` / `MenuRow` / `MenuSwitchRow` 菜单、`RedDotMark`、`ShellPage` 二级页骨架（带系统返回） |
| `Tint.kt` | 图标方块点缀色 `Tint` → 现有令牌 `tint.*`（绿色用 `brand.primary`），不新增令牌 |
| `ComingSoon.kt` | 「暂未开放」登记表 `ComingSoon.items`（与网页 `comingSoon` 表一一对应）、`ComingSoonRow`、统一页 `ComingSoonPage`、气泡菜单 `PopMenu`、底部弹层 `WbSheet` |

新增「暂未开放」入口：在 `ComingSoon.items` 加一行，菜单里放 `ComingSoonRow("键")`。

## 2. 小程序（`feature/chat/MiniApps.kt`）

- 登记表 `MiniApp`：11 个小程序的名字、一句话说明、图标、颜色、是否按 TA、用到的数据；与网页 `miniApps` 表一致。
- 统一入口 `MiniAppNavigation.open(id, characterId)`：按 TA 的小程序带上 `characterId` 时直接进当前 TA 那一页；同时记入「最近使用」。
- 外壳 `MiniAppFrame`：右上胶囊「··· | ◯」、从底部升起（`graphicsLayer.translationY`，系统关闭动画时不播放）。◯ 关掉整个小程序浮层，回到打开前的页面；··· 菜单 = 添加到 / 移出我的小程序、不在 / 在最近使用中显示、关于这个小程序、重新进入（「发给 TA」按方案 P3 不显示）。
- 各小程序仍用原有浮层，外面套外壳：玩法（每日一问 / 心愿 / 慢信 / 专注 / 提醒）= `PlayOverlay`；宠物 = `PetsOverlay`；导入角色 = `ImportOverlay`（仅新建导入）；卡册 / 成就 / 人设广场 / 经期日记 = 新的宿主浮层 `MiniHostOverlay`（经期日记页面在 `feature/me`，由 `MainActivity` 通过 `GrowthShareOverlay(periodPage = …)` 传入）。从人设广场小程序打开的作品页等也带胶囊。
- 页头给胶囊留空：小程序里的页头末尾调用 `CapsuleSpace()`（宽度来自 `LocalCapsuleInset`，不在小程序里时为 0）。
- 本机偏好 `MiniAppPrefs`：最近使用（最多 8 个）、我的小程序、经期日记默认不进最近使用；按账号存在本机 `flags` 表，不跨设备。
- 入口：发现 › 小程序（`MiniAppsHome`）、会话列表下拉（`PullPanel.kt`，阈值 80dp，只动 transform）、聊天「+」› 小程序与聊天信息「和 TA 一起用」（只列按 TA 的 6 个）。

## 3. 情景预设（`feature/chat/Scenario.kt`）

- 当前预设：私聊读 `companion-settings.scenarioMode`，群聊读群设置；收到 `data.changed(companion)` 重新拉。
- 弹层按 `listModes` 返回顺序渲染；`section = private` 放底部「私密」一栏；私密需要先选成人模式模型，第一次开启弹说明（本机按账号记住 `scenario:private-intro-seen`）。
- 副标题规则：日常聊天不显示；自动 →「自动」；成人 →「私密」；对方输入时显示「对方正在输入…」。

## 4. 公告 / 本版新功能 / 强制更新（`feature/me/ReleaseCenter.kt`）

- `MainActivity` 启动时写入 `BuildConfig.VERSION_CODE / VERSION_NAME`；`ReleasePopups` 放在所有页面之上，应用回到前台（RESUMED）时拉取三个接口。
- 弹窗顺序：必须更新（不可关闭，「去下载」打开后台「版本策略」里的安卓下载地址）→ 本版新功能（关闭即 `release-notes/seen`）→ 未读弹窗公告（从旧到新，关闭即已读）。
- 发布新安卓版本时：`app/build.gradle.kts` 的 `versionCode` 必须递增，并在管理后台「更新说明 / 版本策略」里填同一个版本号。
