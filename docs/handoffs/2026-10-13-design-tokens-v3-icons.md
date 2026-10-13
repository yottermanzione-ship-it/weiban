# 交接说明：设计令牌 v3 与补缺图标

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 日期 | 2026-10-13 |

## 做了什么

- `docs/design/tokens.json` 升到 v3.0：数值换成旧版（微信绿 `#07C160`、灰底 `#EDEDED`、白卡、带透明度的黑 / 白文字、深色 `#111111 / #191919 / #202020`、气泡 `#95EC69 / #3EB575`、行高 56 / 72、圆角 4 / 6 / 8 / 12 / 14 等）；删除粉色主题（只留浅色 / 深色）；新增旧版专用颜色组 `semantic.*.color.ui.*`、点缀色 cyan / indigo / coral、尺寸和动效若干。**v2 的全部键名保留**，网页和安卓代码不用改引用。
- 运行 `scripts/build-tokens.mjs` 重新生成 `docs/design/tokens.css`（网页）和 `apps/android/core/designsystem/.../tokens/WbTokens.kt`（安卓），`--check` 通过。
- 删粉色主题后安卓有 3 处引用会编译失败，已做最小改动：`WeibanTheme.kt` 固定用默认主题，`ShareEditor.kt` / `ShareRender.kt` 的 `PinkLight` 改 `GreenLight`，`AvatarDefaultsTest.kt` 期望值改为 v3 数值。
- 新画 17 个补缺图标（原创 SVG，24 网格、线宽 1.7、单色）：`design-assets/old-ui/icons/drawn/`。
- 校对 06 规格第 6、9 节与后端已上线接口（契约 3.3 / 3.4）的字段名，补了字段对照表（9.7）、充值页 `paymentEnabled=false` 写法、积分明细两段取数方式。

## 改了哪些文件

- `docs/design/tokens.json`、`docs/design/tokens.css`
- `apps/android/core/designsystem/src/main/kotlin/app/weiban/designsystem/tokens/WbTokens.kt`（生成物）
- `apps/android/core/designsystem/src/main/kotlin/app/weiban/designsystem/WeibanTheme.kt`
- `apps/android/feature/chat/src/main/kotlin/app/weiban/feature/chat/ShareEditor.kt`、`ShareRender.kt`
- `apps/android/core/designsystem/src/test/kotlin/app/weiban/designsystem/AvatarDefaultsTest.kt`
- `design-assets/old-ui/icons/drawn/*.svg`（17 个）
- `docs/refactor/06-old-ui-spec.md`

## 遗留问题

- 未在本机编译安卓、未跑网页（按省额度要求以 CI 为准）。
- 网页设置页「微伴粉」按钮、安卓 `MeScreen.kt` 主题选择仍在（选了也不再变色），需 Web / 安卓负责人删除。
- `docs/design/brand.md`、`components.md`、`motion.md`、`tokens-android.md` 正文仍描述 v2 视觉，需加「视觉以 06-old-ui-spec 与 tokens v3 为准」说明（下次设计任务）。
- 网页通知提示音 mp3、来电铃声素材仍缺。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给 Web / 安卓：令牌值已整体变成旧版风格，页面会自动变色；页面结构按 06 第 8 节改造；新图标的目标路径见 06 第 7.4 节。
- 给运维：CI 的 `pnpm tokens --check` 与 `android:generate:check` 应通过；如失败请转设计负责人。
