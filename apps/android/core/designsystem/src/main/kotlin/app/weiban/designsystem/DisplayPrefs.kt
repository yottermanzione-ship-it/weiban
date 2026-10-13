package app.weiban.designsystem

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * 本机显示设置（规格 4.10「通用」）：深色模式（跟随系统 / 浅色 / 深色）与字体大小。
 * 与网页 data/display-prefs.ts 一样只存本机，不跨设备；粉色主题已删除（tokens v3）。
 */
object DisplayPrefs {
    private const val FILE = "display-prefs"
    private const val DARK = "dark-mode"
    private const val FONT = "font-scale"
    private var context: Context? = null

    /** system / light / dark */
    var darkMode by mutableStateOf("system")
        private set
    var fontScale by mutableFloatStateOf(1f)
        private set

    val darkModes = listOf("system" to "跟随系统", "light" to "浅色模式", "dark" to "深色模式")
    val fontScales = listOf(0.9f to "小", 1f to "标准", 1.1f to "大", 1.2f to "特大", 1.35f to "超大")

    fun init(context: Context) {
        this.context = context.applicationContext
        val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        darkMode = prefs.getString(DARK, "system") ?: "system"
        fontScale = prefs.getFloat(FONT, 1f)
    }

    fun updateDarkMode(value: String) {
        darkMode = value
        context?.getSharedPreferences(FILE, Context.MODE_PRIVATE)?.edit()?.putString(DARK, value)?.apply()
    }

    fun updateFontScale(value: Float) {
        fontScale = value
        context?.getSharedPreferences(FILE, Context.MODE_PRIVATE)?.edit()?.putFloat(FONT, value)?.apply()
    }

    fun darkLabel(): String = darkModes.find { it.first == darkMode }?.second ?: "跟随系统"

    fun fontLabel(): String = fontScales.find { it.first == fontScale }?.second ?: "标准"
}

/** 当前是否深色（考虑本机「深色模式」设置）；部件里用它代替 isSystemInDarkTheme()。 */
val LocalWbDark = staticCompositionLocalOf { false }
