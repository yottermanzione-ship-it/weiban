package app.weiban.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** 图标方块的点缀色（与网页 Tint 一致）。 */
enum class Tint { Orange, Blue, Gold, Lilac, Pink, Teal, Gray, Green, Cyan, Indigo, Coral }

@Composable fun tintColor(tint: Tint): Color {
    val mode = LocalWeibanModeColors.current
    return when (tint) {
        Tint.Orange -> mode.tintOrange
        Tint.Blue -> mode.tintBlue
        Tint.Gold -> mode.tintGold
        Tint.Lilac -> mode.tintLilac
        Tint.Pink -> mode.tintPink
        Tint.Teal -> mode.tintTeal
        Tint.Gray -> mode.tintGray
        Tint.Green -> LocalWeibanColors.current.brandPrimary
        Tint.Cyan -> mode.tintCyan
        Tint.Indigo -> mode.tintIndigo
        Tint.Coral -> mode.tintCoral
    }
}
