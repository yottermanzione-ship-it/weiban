// 由 scripts/build-tokens.mjs 从 docs/design/tokens.json 生成，请勿手改。
// 令牌版本 2.1.0
package app.weiban.designsystem.tokens

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 随主题 × 深浅模式变化的颜色（bg / text / border / brand / bubble 五组） */
@Immutable
data class WbThemeColors(
    val bgUserAvatar: Color,
    val bgPage: Color,
    val bgChat: Color,
    val bgSurface: Color,
    val bgSurfacePinned: Color,
    val bgElevated: Color,
    val bgInputField: Color,
    val bgInputBar: Color,
    val bgNavBar: Color,
    val bgTabBar: Color,
    val bgScrim: Color,
    val bgPressed: Color,
    val bgSkeleton: Color,
    val textUserAvatar: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val textPlaceholder: Color,
    val textOnBrand: Color,
    val textLink: Color,
    val textNameInMoments: Color,
    val textDanger: Color,
    val borderHairline: Color,
    val borderStrong: Color,
    val borderFocus: Color,
    val brandPrimary: Color,
    val brandPrimaryPressed: Color,
    val brandSoft: Color,
    val brandOnSoft: Color,
    val brandAccent: Color,
    val bubbleSelfBg: Color,
    val bubbleSelfText: Color,
    val bubbleOtherBg: Color,
    val bubbleOtherText: Color,
    val bubbleQuoteBg: Color,
    val bubbleQuoteText: Color
)

/** 只随深浅模式变化、两个主题共用的颜色 */
@Immutable
data class WbModeColors(
    val statusSuccess: Color,
    val statusSuccessSoft: Color,
    val statusWarning: Color,
    val statusWarningSoft: Color,
    val statusWarningText: Color,
    val statusDanger: Color,
    val statusDangerSoft: Color,
    val statusInfo: Color,
    val statusInfoSoft: Color,
    val badgeUnread: Color,
    val badgeOnUnread: Color,
    val badgeMuted: Color,
    val amountIncome: Color,
    val amountExpense: Color,
    val tintOrange: Color,
    val tintBlue: Color,
    val tintGold: Color,
    val tintLilac: Color,
    val tintPink: Color,
    val tintTeal: Color,
    val tintGray: Color,
    val familiarityL1: Color,
    val familiarityL2: Color,
    val familiarityL3: Color,
    val familiarityL4: Color,
    val familiarityL5: Color,
    val familiarityTrack: Color,
    val cardMemorial: Color,
    val cardFamiliarity: Color,
    val cardFestival: Color,
    val cardMoment: Color,
    val cardSilhouette: Color,
    val achievementMeet: Color,
    val achievementChat: Color,
    val achievementSocial: Color,
    val achievementCollect: Color,
    val achievementMemorial: Color,
    val achievementPlay: Color,
    val achievementLocked: Color,
    val modeTsundere: Color,
    val modeRomance: Color,
    val modeAdult: Color,
    val modeCustom: Color,
    val callBgTop: Color,
    val callBgBottom: Color,
    val callText: Color,
    val callTextSecondary: Color,
    val callAccept: Color,
    val callDecline: Color,
    val callControl: Color,
    val callControlActive: Color,
    val overlayMenu: Color,
    val overlayViewer: Color
)

/** 主题标识。id 与网页 data-theme 相同 */
enum class WbThemeId(val id: String, val displayName: String) {
    Green("green", "默认"),
    Pink("pink", "微伴粉");
    companion object { val Default = Green }
}

object WbColorSets {
    val GreenLight = WbThemeColors(
        bgUserAvatar = Color(0xFFD9D9D9),
        bgPage = Color(0xFFEDEDED),
        bgChat = Color(0xFFEDEDED),
        bgSurface = Color(0xFFFFFFFF),
        bgSurfacePinned = Color(0xFFF7F7F7),
        bgElevated = Color(0xFFFFFFFF),
        bgInputField = Color(0xFFFFFFFF),
        bgInputBar = Color(0xFFF7F7F7),
        bgNavBar = Color(0xFFEDEDED),
        bgTabBar = Color(0xFFF7F7F7),
        bgScrim = Color(0x80000000),
        bgPressed = Color(0x0D000000),
        bgSkeleton = Color(0xFFE5E5E5),
        textUserAvatar = Color(0xFF1A1A1A),
        textPrimary = Color(0xFF1A1A1A),
        textSecondary = Color(0xFF6B6B6B),
        textTertiary = Color(0xFF8C8C8C),
        textPlaceholder = Color(0xFFADADAD),
        textOnBrand = Color(0xFFFFFFFF),
        textLink = Color(0xFF4F6592),
        textNameInMoments = Color(0xFF4F6592),
        textDanger = Color(0xFFF04848),
        borderHairline = Color(0x1A000000),
        borderStrong = Color(0xFFD9D9D9),
        borderFocus = Color(0xFF0AA35A),
        brandPrimary = Color(0xFF0AA35A),
        brandPrimaryPressed = Color(0xFF088F4D),
        brandSoft = Color(0xFFE8F7EF),
        brandOnSoft = Color(0xFF0A7A43),
        brandAccent = Color(0xFF8F72D9),
        bubbleSelfBg = Color(0xFFA0E37C),
        bubbleSelfText = Color(0xFF1A1A1A),
        bubbleOtherBg = Color(0xFFFFFFFF),
        bubbleOtherText = Color(0xFF1A1A1A),
        bubbleQuoteBg = Color(0x0D000000),
        bubbleQuoteText = Color(0xFF6B6B6B)
    )
    val GreenDark = WbThemeColors(
        bgUserAvatar = Color(0xFFD9D9D9),
        bgPage = Color(0xFF111111),
        bgChat = Color(0xFF111111),
        bgSurface = Color(0xFF191919),
        bgSurfacePinned = Color(0xFF232323),
        bgElevated = Color(0xFF2C2C2C),
        bgInputField = Color(0xFF2C2C2C),
        bgInputBar = Color(0xFF191919),
        bgNavBar = Color(0xFF111111),
        bgTabBar = Color(0xFF191919),
        bgScrim = Color(0x99000000),
        bgPressed = Color(0x0FFFFFFF),
        bgSkeleton = Color(0xFF262626),
        textUserAvatar = Color(0xFF1A1A1A),
        textPrimary = Color(0xFFE6E6E6),
        textSecondary = Color(0xFFADADAD),
        textTertiary = Color(0xFF8C8C8C),
        textPlaceholder = Color(0xFF6B6B6B),
        textOnBrand = Color(0xFFFFFFFF),
        textLink = Color(0xFF8DA0CC),
        textNameInMoments = Color(0xFF8DA0CC),
        textDanger = Color(0xFFFF6B6B),
        borderHairline = Color(0x14FFFFFF),
        borderStrong = Color(0xFF4D4D4D),
        borderFocus = Color(0xFF3CC783),
        brandPrimary = Color(0xFF0AA35A),
        brandPrimaryPressed = Color(0xFF088F4D),
        brandSoft = Color(0x2E0AA35A),
        brandOnSoft = Color(0xFF5FD39A),
        brandAccent = Color(0xFFC9B5F5),
        bubbleSelfBg = Color(0xFF3BAA6A),
        bubbleSelfText = Color(0xFF1A1A1A),
        bubbleOtherBg = Color(0xFF2C2C2C),
        bubbleOtherText = Color(0xFFE6E6E6),
        bubbleQuoteBg = Color(0x0FFFFFFF),
        bubbleQuoteText = Color(0xFFADADAD)
    )
    val PinkLight = WbThemeColors(
        bgUserAvatar = Color(0xFFE2DDE0),
        bgPage = Color(0xFFF6F3F5),
        bgChat = Color(0xFFF7F2F4),
        bgSurface = Color(0xFFFFFFFF),
        bgSurfacePinned = Color(0xFFFBF9FA),
        bgElevated = Color(0xFFFFFFFF),
        bgInputField = Color(0xFFFFFFFF),
        bgInputBar = Color(0xFFF6F3F5),
        bgNavBar = Color(0xFFF6F3F5),
        bgTabBar = Color(0xFFFBF9FA),
        bgScrim = Color(0x73140C10),
        bgPressed = Color(0x0F1F1A1D),
        bgSkeleton = Color(0xFFEEEAEC),
        textUserAvatar = Color(0xFF1F1A1D),
        textPrimary = Color(0xFF1F1A1D),
        textSecondary = Color(0xFF655F63),
        textTertiary = Color(0xFF857E83),
        textPlaceholder = Color(0xFFA8A1A6),
        textOnBrand = Color(0xFFFFFFFF),
        textLink = Color(0xFFA32457),
        textNameInMoments = Color(0xFF4E5F8C),
        textDanger = Color(0xFFF04848),
        borderHairline = Color(0x1A1F1A1D),
        borderStrong = Color(0xFFE2DDE0),
        borderFocus = Color(0xFFE0457B),
        brandPrimary = Color(0xFFE0457B),
        brandPrimaryPressed = Color(0xFFC7346A),
        brandSoft = Color(0xFFFFE6EE),
        brandOnSoft = Color(0xFFA32457),
        brandAccent = Color(0xFF8F72D9),
        bubbleSelfBg = Color(0xFFFFD6E3),
        bubbleSelfText = Color(0xFF1F1A1D),
        bubbleOtherBg = Color(0xFFFFFFFF),
        bubbleOtherText = Color(0xFF1F1A1D),
        bubbleQuoteBg = Color(0x0D1F1A1D),
        bubbleQuoteText = Color(0xFF655F63)
    )
    val PinkDark = WbThemeColors(
        bgUserAvatar = Color(0xFFE2DDE0),
        bgPage = Color(0xFF0B0A0C),
        bgChat = Color(0xFF121013),
        bgSurface = Color(0xFF1C1A1E),
        bgSurfacePinned = Color(0xFF262329),
        bgElevated = Color(0xFF262329),
        bgInputField = Color(0xFF262329),
        bgInputBar = Color(0xFF1C1A1E),
        bgNavBar = Color(0xFF0B0A0C),
        bgTabBar = Color(0xFF1C1A1E),
        bgScrim = Color(0x99000000),
        bgPressed = Color(0x14FFFFFF),
        bgSkeleton = Color(0xFF262329),
        textUserAvatar = Color(0xFF1F1A1D),
        textPrimary = Color(0xFFEDE8EC),
        textSecondary = Color(0xFFA8A1A6),
        textTertiary = Color(0xFF857E83),
        textPlaceholder = Color(0xFF655F63),
        textOnBrand = Color(0xFFFFFFFF),
        textLink = Color(0xFFFFB3CA),
        textNameInMoments = Color(0xFF9AABD6),
        textDanger = Color(0xFFFF6B6B),
        borderHairline = Color(0x1AFFFFFF),
        borderStrong = Color(0xFF4A4448),
        borderFocus = Color(0xFFF784A8),
        brandPrimary = Color(0xFFE0457B),
        brandPrimaryPressed = Color(0xFFC7346A),
        brandSoft = Color(0x2EE0457B),
        brandOnSoft = Color(0xFFFFB3CA),
        brandAccent = Color(0xFFC9B5F5),
        bubbleSelfBg = Color(0xFF8A3358),
        bubbleSelfText = Color(0xFFFFFFFF),
        bubbleOtherBg = Color(0xFF262329),
        bubbleOtherText = Color(0xFFEDE8EC),
        bubbleQuoteBg = Color(0x0FFFFFFF),
        bubbleQuoteText = Color(0xFFA8A1A6)
    )
    val ModeLight = WbModeColors(
        statusSuccess = Color(0xFF2BA471),
        statusSuccessSoft = Color(0xFFE2F5EC),
        statusWarning = Color(0xFFE8892B),
        statusWarningSoft = Color(0xFFFDF0E1),
        statusWarningText = Color(0xFF8A4B0F),
        statusDanger = Color(0xFFF04848),
        statusDangerSoft = Color(0xFFFDE7E7),
        statusInfo = Color(0xFF3B7FE0),
        statusInfoSoft = Color(0xFFE6F0FD),
        badgeUnread = Color(0xFFF04848),
        badgeOnUnread = Color(0xFFFFFFFF),
        badgeMuted = Color(0xFFC4C4C4),
        amountIncome = Color(0xFF2BA471),
        amountExpense = Color(0xFF1A1A1A),
        tintOrange = Color(0xFFE8892B),
        tintBlue = Color(0xFF3B7FE0),
        tintGold = Color(0xFFD9A23A),
        tintLilac = Color(0xFF8F72D9),
        tintPink = Color(0xFFE0457B),
        tintTeal = Color(0xFF2BA471),
        tintGray = Color(0xFF8C8C8C),
        familiarityL1 = Color(0xFFADADAD),
        familiarityL2 = Color(0xFFF784A8),
        familiarityL3 = Color(0xFFE0457B),
        familiarityL4 = Color(0xFF8F72D9),
        familiarityL5 = Color(0xFFD9A23A),
        familiarityTrack = Color(0xFFE5E5E5),
        cardMemorial = Color(0xFFE0457B),
        cardFamiliarity = Color(0xFF8F72D9),
        cardFestival = Color(0xFFE8892B),
        cardMoment = Color(0xFF3B7FE0),
        cardSilhouette = Color(0xFFD9D9D9),
        achievementMeet = Color(0xFFE0457B),
        achievementChat = Color(0xFF3B7FE0),
        achievementSocial = Color(0xFFE8892B),
        achievementCollect = Color(0xFF8F72D9),
        achievementMemorial = Color(0xFFD9A23A),
        achievementPlay = Color(0xFF2BA471),
        achievementLocked = Color(0xFFC4C4C4),
        modeTsundere = Color(0xFFE8892B),
        modeRomance = Color(0xFFE0457B),
        modeAdult = Color(0xFF6B6B6B),
        modeCustom = Color(0xFF8F72D9),
        callBgTop = Color(0xFF26262B),
        callBgBottom = Color(0xFF111113),
        callText = Color(0xFFFFFFFF),
        callTextSecondary = Color(0xADFFFFFF),
        callAccept = Color(0xFF2BA471),
        callDecline = Color(0xFFF04848),
        callControl = Color(0x24FFFFFF),
        callControlActive = Color(0xFFFFFFFF),
        overlayMenu = Color(0xFF262626),
        overlayViewer = Color(0xFF000000)
    )
    val ModeDark = WbModeColors(
        statusSuccess = Color(0xFF4CC38A),
        statusSuccessSoft = Color(0x2E2BA471),
        statusWarning = Color(0xFFF5B36B),
        statusWarningSoft = Color(0x29E8892B),
        statusWarningText = Color(0xFFF5B36B),
        statusDanger = Color(0xFFFF6B6B),
        statusDangerSoft = Color(0x2EF04848),
        statusInfo = Color(0xFF6FA3F0),
        statusInfoSoft = Color(0x2E3B7FE0),
        badgeUnread = Color(0xFFF04848),
        badgeOnUnread = Color(0xFFFFFFFF),
        badgeMuted = Color(0xFF6B6B6B),
        amountIncome = Color(0xFF4CC38A),
        amountExpense = Color(0xFFE6E6E6),
        tintOrange = Color(0xFFF5B36B),
        tintBlue = Color(0xFF6FA3F0),
        tintGold = Color(0xFFD9A23A),
        tintLilac = Color(0xFFC9B5F5),
        tintPink = Color(0xFFF784A8),
        tintTeal = Color(0xFF4CC38A),
        tintGray = Color(0xFFADADAD),
        familiarityL1 = Color(0xFF8C8C8C),
        familiarityL2 = Color(0xFFFFB3CA),
        familiarityL3 = Color(0xFFF784A8),
        familiarityL4 = Color(0xFFC9B5F5),
        familiarityL5 = Color(0xFFD9A23A),
        familiarityTrack = Color(0xFF262626),
        cardMemorial = Color(0xFFF784A8),
        cardFamiliarity = Color(0xFFC9B5F5),
        cardFestival = Color(0xFFF5B36B),
        cardMoment = Color(0xFF6FA3F0),
        cardSilhouette = Color(0xFF262626),
        achievementMeet = Color(0xFFF784A8),
        achievementChat = Color(0xFF6FA3F0),
        achievementSocial = Color(0xFFF5B36B),
        achievementCollect = Color(0xFFC9B5F5),
        achievementMemorial = Color(0xFFD9A23A),
        achievementPlay = Color(0xFF4CC38A),
        achievementLocked = Color(0xFF4D4D4D),
        modeTsundere = Color(0xFFF5B36B),
        modeRomance = Color(0xFFF784A8),
        modeAdult = Color(0xFFADADAD),
        modeCustom = Color(0xFFC9B5F5),
        callBgTop = Color(0xFF26262B),
        callBgBottom = Color(0xFF111113),
        callText = Color(0xFFFFFFFF),
        callTextSecondary = Color(0xADFFFFFF),
        callAccept = Color(0xFF2BA471),
        callDecline = Color(0xFFF04848),
        callControl = Color(0x24FFFFFF),
        callControlActive = Color(0xFFFFFFFF),
        overlayMenu = Color(0xFF2C2C2C),
        overlayViewer = Color(0xFF000000)
    )
    fun theme(id: WbThemeId, dark: Boolean): WbThemeColors = when (id) {
        WbThemeId.Green -> if (dark) GreenDark else GreenLight
        WbThemeId.Pink -> if (dark) PinkDark else PinkLight
    }
    fun mode(dark: Boolean): WbModeColors = if (dark) ModeDark else ModeLight
}

/** 应援色预设盘（default-avatar.md 第 3 节） */
object WbSupportPalette {
    data class Swatch(val name: String, val bg: Color, val on: Color)
    val all = listOf(
        Swatch("樱粉", Color(0xFFE8608C), Color(0xFFFFFFFF)),
        Swatch("珊瑚", Color(0xFFE8664A), Color(0xFFFFFFFF)),
        Swatch("橘子", Color(0xFFE0892B), Color(0xFF1F1A1D)),
        Swatch("柠檬", Color(0xFFD9B226), Color(0xFF1F1A1D)),
        Swatch("抹茶", Color(0xFF6FAE45), Color(0xFF1F1A1D)),
        Swatch("薄荷", Color(0xFF2EAA8A), Color(0xFF1F1A1D)),
        Swatch("湖蓝", Color(0xFF2F97CF), Color(0xFFFFFFFF)),
        Swatch("海军", Color(0xFF3F5FC4), Color(0xFFFFFFFF)),
        Swatch("薰衣草", Color(0xFF8F72D9), Color(0xFFFFFFFF)),
        Swatch("葡萄", Color(0xFFA548BA), Color(0xFFFFFFFF)),
        Swatch("玫瑰", Color(0xFFCF3D66), Color(0xFFFFFFFF)),
        Swatch("可可", Color(0xFF8E6A58), Color(0xFFFFFFFF))
    )
}

/** 分享图固定色 */
object WbShare {
    val Logo = Color(0xFFE0457B)
    val StickerBg = Color(0xFFFFFFFF)
    val StickerBorder = Color(0xFFFFB3CA)
    val StickerText = Color(0xFF1F1A1D)
    val StickerSubText = Color(0xFF655F63)
    val StickerInkBg = Color(0xFF1F1A1D)
    val StickerInkText = Color(0xFFFFFFFF)
}

/** 字号（sp，已随系统字体缩放；应用内字体大小设置再乘 WbFontScale） */
object WbFontSize {
    val Caption2 = 11.sp
    val Caption1 = 12.sp
    val Footnote = 13.sp
    val Subhead = 14.sp
    val Callout = 15.sp
    val Body = 17.sp
    val Headline = 17.sp
    val Title3 = 20.sp
    val Title2 = 22.sp
    val Title1 = 28.sp
    val Display = 40.sp
    val EmojiOnly = 40.sp
}
object WbLineHeight {
    const val Tight = 1.25f
    const val Normal = 1.45f
    const val Relaxed = 1.7f
}
object WbFontWeight {
    val Regular = FontWeight(400)
    val Medium = FontWeight(500)
    val Semibold = FontWeight(600)
    val Bold = FontWeight(700)
}
object WbFontScale {
    val steps = listOf(0.9f, 1f, 1.1f, 1.2f, 1.35f)
}

object WbSpace {
    val S0 = 0.dp
    val S1 = 2.dp
    val S2 = 4.dp
    val S3 = 8.dp
    val S4 = 12.dp
    val S5 = 16.dp
    val S6 = 20.dp
    val S7 = 24.dp
    val S8 = 32.dp
    val S9 = 40.dp
    val S10 = 48.dp
}
object WbRadius {
    val Xs = 4.dp
    val Sm = 6.dp
    val Bubble = 6.dp
    val Md = 12.dp
    val Lg = 16.dp
    val Xl = 20.dp
    val Full = 999.dp
    const val AvatarRatio = 0.12f
}
object WbSize {
    val AdminMinWidth = 1200.dp
    val AdminContentMaxWidth = 1440.dp
    val TouchTarget = 44.dp
    val NavBar = 44.dp
    val TabBar = 50.dp
    val InputBarMin = 56.dp
    val ListRow = 72.dp
    val ContactRow = 56.dp
    val SettingRow = 56.dp
    val BubbleTail = 6.dp
    val ListIcon = 24.dp
    val GridIcon = 28.dp
    val GridCell = 88.dp
    val WalletCard = 128.dp
    val AvatarXs = 24.dp
    val AvatarSm = 32.dp
    val AvatarMd = 40.dp
    val AvatarLg = 48.dp
    val AvatarXl = 64.dp
    val AvatarXxl = 96.dp
    const val BubbleMaxWidthRatio = 0.70f
    val ImageMessageMax = 200.dp
    val ContentMaxWidth = 640.dp
    val SidebarWidth = 360.dp
}

/** 阴影用 elevation 近似（浮层专用） */
object WbElevation {
    val None = 0.dp
    val Sm = 1.dp
    val Md = 4.dp
    val Lg = 8.dp
}

object WbMotion {
    const val InstantMs = 100
    const val FastMs = 160
    const val BaseMs = 240
    const val PageMs = 300
    const val SlowMs = 420
    const val TypingCycleMs = 1200
    const val RingCycleMs = 1800
    val Standard = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val Decelerate = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
    val Accelerate = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)
    val Spring = CubicBezierEasing(0.34f, 1.36f, 0.64f, 1f)
    val Linear = CubicBezierEasing(0f, 0f, 1f, 1f)
}
object WbOpacity {
    const val Disabled = 0.4f
    const val Pressed = 0.7f
    const val Muted = 0.55f
}
