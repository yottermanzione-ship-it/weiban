# 设计令牌在安卓（Kotlin + Jetpack Compose）中的落地

| 项 | 内容 |
|---|---|
| 负责人 | design-lead |
| 任务 | T-012 |
| 日期 | 2026-10-04 |
| 依据 | ADR-0011（安卓原生 Kotlin + Compose，令牌由脚本生成不手抄）、`docs/architecture/repo-structure.md` 第 5 节、`docs/architecture/engineering-standards.md` 第 10 节 |

## 1. 结论

- 安卓和网页用**同一份** `tokens.json`。生成脚本 `tools/build-tokens.mjs` 一条命令同时产出网页的 `tokens.css` 和安卓的 `WbTokens.kt`，两端数值不可能对不上。
- 生成命令（项目根目录，需要 Node，开发环境已装）：

  ```
  node docs/design/tools/build-tokens.mjs --kotlin apps/android/<模块>/src/main/java/app/weiban/designsystem/tokens/WbTokens.kt
  node docs/design/tools/build-tokens.mjs --check      # 只检查，不写文件（适合放进 CI）
  ```

- 脚本现放在 `docs/design/tools/` 是**参考实现**。仓库建好 `scripts/` 后，由 Android / Web 负责人移到 `scripts/` 并接入 Gradle 任务和网页构建（`repo-structure.md` 第 5 节），然后删除这份，保证只有一份脚本。CI 检查「重新生成后无差异」，与契约代码生成同一规则。
- 生成的 Kotlin 文件**不手改**；要改数值，改 `tokens.json` 再重新生成。

## 2. 生成出来的 Kotlin 长什么样

| 令牌分组 | Kotlin 形式 | 单位换算 |
|---|---|---|
| `theme.<主题>.<模式>.color.*` | `data class WbThemeColors`，四个实例 `WbColorSets.GreenLight / GreenDark / PinkLight / PinkDark` | 十六进制 → `Color(0xAARRGGBB)`；`rgba()` 透明度换成 AA 两位 |
| `semantic.<模式>.color.*` | `data class WbModeColors`，两个实例 `WbColorSets.ModeLight / ModeDark` | 同上 |
| `meta.themes` | `enum class WbThemeId { Green, Pink }`，含 `displayName`（「默认」「微伴粉」）和 `Default` | — |
| `primitive.color.support` | `WbSupportPalette.all`（12 个应援色，默认头像用） | — |
| `share.*` | `object WbShare` | — |
| `typography.fontSize` | `object WbFontSize`，如 `WbFontSize.Body = 17.sp` | px → **sp** |
| `typography.lineHeight / fontWeight` | `WbLineHeight.Normal = 1.45f`（乘字号得行高）、`WbFontWeight.Semibold = FontWeight(600)` | — |
| `space / radius / size` | `WbSpace.S5 = 16.dp`、`WbRadius.Bubble = 6.dp`、`WbRadius.AvatarRatio = 0.12f`、`WbSize.AvatarLg = 48.dp` | px → **dp** |
| `shadow` | `WbElevation.Sm / Md / Lg = 1 / 4 / 8.dp` | 阴影换成 elevation 近似 |
| `motion` | `WbMotion.FastMs = 160`、`WbMotion.Standard = CubicBezierEasing(...)` | ms → Int |
| `opacity` | `WbOpacity.Disabled = 0.4f` | — |
| `zIndex`、`breakpoint` | 不生成（安卓用组件层级和窗口尺寸类，不需要） | — |

节选（实际文件由脚本生成）：

```kotlin
@Immutable
data class WbThemeColors(
    val bgPage: Color,
    val bgChat: Color,
    // …共 34 个
    val bubbleSelfBg: Color,
    val bubbleSelfText: Color,
)

object WbColorSets {
    val GreenLight = WbThemeColors(bgPage = Color(0xFFEDEDED), /* … */ bubbleSelfBg = Color(0xFFA0E37C), /* … */)
    fun theme(id: WbThemeId, dark: Boolean): WbThemeColors = /* … */
    fun mode(dark: Boolean): WbModeColors = /* … */
}
```

## 3. 在 Compose 里怎么用（给 Android 负责人的建议，非强制实现细节）

1. **主题外壳** `WbTheme(themeId, darkMode, fontScale) { … }`：用 `CompositionLocalProvider` 提供 `LocalWbThemeColors`、`LocalWbModeColors`、`LocalWbFontScale`；页面和组件只从这三个读颜色和缩放，不直接写 `Color(...)`。
2. **深浅模式**：设置里有「跟随系统 / 浅色 / 深色」（`pages/settings.md` 第 5 节）；跟随系统时读 `isSystemInDarkTheme()`。
3. **主题切换立即生效**：`themeId` 放在应用级状态里，改了整棵界面重组即可，不需要重启。
4. **Material 3 只当底座**（ADR-0011）：如果用了 M3 组件，用下表把令牌映射进 `MaterialTheme.colorScheme`，避免出现 M3 默认紫色：

   | M3 颜色 | 取自 |
   |---|---|
   | primary / onPrimary | `brandPrimary` / `textOnBrand` |
   | primaryContainer / onPrimaryContainer | `brandSoft` / `brandOnSoft` |
   | background / onBackground | `bgPage` / `textPrimary` |
   | surface / onSurface | `bgSurface` / `textPrimary` |
   | surfaceVariant / onSurfaceVariant | `bgPage` / `textSecondary` |
   | outline / outlineVariant | `borderStrong` / `borderHairline` |
   | error | `textDanger` |
   | scrim | `bgScrim` |

5. **按下效果**：参照产品在安卓上用的是「整行变灰」，不是 M3 的水波纹。用 `bgPressed` 叠加层作为 `Indication`，全局关掉默认水波纹（`components.md` 0 节「通用状态」）。
6. **字号**：`sp` 已经跟随系统字体大小；应用内「字体大小」设置再乘 `LocalWbFontScale`（0.9 / 1 / 1.1 / 1.2 / 1.35）。两者叠加后若超过 1.6 倍，聊天气泡宽度仍按 `size.bubbleMaxWidthRatio` 控制，允许多行。
7. **字体**：只用系统字体（`FontFamily.Default`）；数字用 `fontFeatureSettings = "tnum"` 等宽；卡面一句话用 `FontFamily.Serif`。不打包中文字体文件。
8. **图标**：Phosphor Icons 的 SVG 源文件转成安卓 Vector Drawable（构建时转换或一次性导入），网页和安卓用同一套 SVG，不另找图标库。
9. **状态栏和导航栏**：全面屏（edge-to-edge）；状态栏图标颜色随深浅模式（浅色模式深色图标）；导航栏背景用 `bgTabBar`（一级页）或 `bgInputBar`（聊天页）。
10. **动效**：只用 `graphicsLayer` 的位移、缩放、旋转、透明度做动画，见 `motion.md` 第 6 节。

## 4. 修改流程

1. 设计负责人改 `tokens.json`（新增令牌要同时给两个主题 × 两个模式，脚本会检查缺项）。
2. 运行 `--check`，再生成 CSS（`docs/design/tokens.css`）。
3. 在交接说明里写明改了哪些令牌；Web / Android 构建时重新生成各自的产物。
