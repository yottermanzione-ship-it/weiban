// 由 scripts/build-tokens.mjs 从 docs/design/tokens.json 生成，请勿手改。
// 令牌版本 3.0.0
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
    val tintCyan: Color,
    val tintIndigo: Color,
    val tintCoral: Color,
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
    val callControlIconActive: Color,
    val callAvatarOverlay: Color,
    val overlayMenu: Color,
    val overlayViewer: Color,
    val uiChevron: Color,
    val uiSwipeRead: Color,
    val uiSwipeHide: Color,
    val uiMentionBg: Color,
    val uiMentionText: Color,
    val uiMentionBorder: Color,
    val uiMenuLine: Color,
    val uiPopupBg: Color,
    val uiPopupLine: Color,
    val uiPopupText: Color,
    val uiToastBg: Color,
    val uiTabLine: Color,
    val uiTabIcon: Color,
    val uiTimeDivider: Color,
    val uiSystemText: Color,
    val uiSearchPlaceholder: Color,
    val uiAvatarGroupFallback: Color,
    val uiMomentsSocialBg: Color,
    val uiMomentsNewMsgBg: Color,
    val uiRecordMask: Color,
    val uiRecordBubble: Color,
    val uiRecordBubbleCancel: Color,
    val uiRecordCancelText: Color,
    val uiRecordWave: Color,
    val uiVoicePlaying: Color,
    val uiVoiceError: Color,
    val uiPullPanelBg: Color,
    val uiPending: Color,
    val uiStar: Color,
    val uiButtonDisabledBg: Color,
    val uiButtonDisabledText: Color,
    val uiBrandDisabled: Color,
    val uiFrameWide: Color
)

/** 主题标识。id 与网页 data-theme 相同 */
enum class WbThemeId(val id: String, val displayName: String) {
    Green("green", "默认");
    companion object { val Default = Green }
}

object WbColorSets {
    val GreenLight = WbThemeColors(
        bgUserAvatar = Color(0xFFEDEDED),
        bgPage = Color(0xFFEDEDED),
        bgChat = Color(0xFFEDEDED),
        bgSurface = Color(0xFFFFFFFF),
        bgSurfacePinned = Color(0xFFEDEDED),
        bgElevated = Color(0xFFFFFFFF),
        bgInputField = Color(0xFFFFFFFF),
        bgInputBar = Color(0xFFEDEDED),
        bgNavBar = Color(0xFFEDEDED),
        bgTabBar = Color(0xFFF7F7F7),
        bgScrim = Color(0x80000000),
        bgPressed = Color(0x0D000000),
        bgSkeleton = Color(0xFFE5E5E5),
        textUserAvatar = Color(0xFFBBBBBB),
        textPrimary = Color(0xE6000000),
        textSecondary = Color(0x8C000000),
        textTertiary = Color(0x4D000000),
        textPlaceholder = Color(0x4D000000),
        textOnBrand = Color(0xFFFFFFFF),
        textLink = Color(0xFF576B95),
        textNameInMoments = Color(0xFF576B95),
        textDanger = Color(0xFFFA5151),
        borderHairline = Color(0x1A000000),
        borderStrong = Color(0x26000000),
        borderFocus = Color(0xFF07C160),
        brandPrimary = Color(0xFF07C160),
        brandPrimaryPressed = Color(0xFF38CD7F),
        brandSoft = Color(0xFFE8F5E9),
        brandOnSoft = Color(0xFF176B38),
        brandAccent = Color(0xFF7B61D9),
        bubbleSelfBg = Color(0xFF95EC69),
        bubbleSelfText = Color(0xFF111111),
        bubbleOtherBg = Color(0xFFFFFFFF),
        bubbleOtherText = Color(0xE6000000),
        bubbleQuoteBg = Color(0x0D000000),
        bubbleQuoteText = Color(0x8C000000)
    )
    val GreenDark = WbThemeColors(
        bgUserAvatar = Color(0xFF2E2E30),
        bgPage = Color(0xFF111111),
        bgChat = Color(0xFF111111),
        bgSurface = Color(0xFF191919),
        bgSurfacePinned = Color(0xFF232326),
        bgElevated = Color(0xFF2C2C2C),
        bgInputField = Color(0xFF191919),
        bgInputBar = Color(0xFF111111),
        bgNavBar = Color(0xFF202020),
        bgTabBar = Color(0xFF202020),
        bgScrim = Color(0x99000000),
        bgPressed = Color(0x0DFFFFFF),
        bgSkeleton = Color(0xFF2C2C2C),
        textUserAvatar = Color(0xFFBBBBBB),
        textPrimary = Color(0xCCFFFFFF),
        textSecondary = Color(0x80FFFFFF),
        textTertiary = Color(0x4DFFFFFF),
        textPlaceholder = Color(0x4DFFFFFF),
        textOnBrand = Color(0xFFFFFFFF),
        textLink = Color(0xFF7D90A9),
        textNameInMoments = Color(0xFF7D90A9),
        textDanger = Color(0xFFFA5151),
        borderHairline = Color(0x0DFFFFFF),
        borderStrong = Color(0x26FFFFFF),
        borderFocus = Color(0xFF07C160),
        brandPrimary = Color(0xFF07C160),
        brandPrimaryPressed = Color(0xFF059A4C),
        brandSoft = Color(0xFF1E2A21),
        brandOnSoft = Color(0xFF07C160),
        brandAccent = Color(0xFF7B61D9),
        bubbleSelfBg = Color(0xFF3EB575),
        bubbleSelfText = Color(0xFF111111),
        bubbleOtherBg = Color(0xFF191919),
        bubbleOtherText = Color(0xCCFFFFFF),
        bubbleQuoteBg = Color(0x0FFFFFFF),
        bubbleQuoteText = Color(0x80FFFFFF)
    )
    val ModeLight = WbModeColors(
        statusSuccess = Color(0xFF07C160),
        statusSuccessSoft = Color(0xFFE8F5E9),
        statusWarning = Color(0xFFFA9D3B),
        statusWarningSoft = Color(0xFFFFF1C7),
        statusWarningText = Color(0xFFE08A00),
        statusDanger = Color(0xFFFA5151),
        statusDangerSoft = Color(0xFFFDE7E7),
        statusInfo = Color(0xFF2782D7),
        statusInfoSoft = Color(0xFFE6F0FD),
        badgeUnread = Color(0xFFFA5151),
        badgeOnUnread = Color(0xFFFFFFFF),
        badgeMuted = Color(0xFFFA5151),
        amountIncome = Color(0xFF07C160),
        amountExpense = Color(0xE6000000),
        tintOrange = Color(0xFFFA9D3B),
        tintBlue = Color(0xFF2782D7),
        tintGold = Color(0xFFF6BE00),
        tintLilac = Color(0xFF7B61D9),
        tintPink = Color(0xFFFA5151),
        tintTeal = Color(0xFF07C160),
        tintGray = Color(0xFF8C8C8C),
        tintCyan = Color(0xFF10A8E5),
        tintIndigo = Color(0xFF6467F0),
        tintCoral = Color(0xFFF26B51),
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
        callBgTop = Color(0xFF1A1A1A),
        callBgBottom = Color(0xFF1A1A1A),
        callText = Color(0xFFFFFFFF),
        callTextSecondary = Color(0xB3FFFFFF),
        callAccept = Color(0xFF07C160),
        callDecline = Color(0xFFE64A45),
        callControl = Color(0x59000000),
        callControlActive = Color(0xFFFFFFFF),
        callControlIconActive = Color(0xFF111111),
        callAvatarOverlay = Color(0x8C000000),
        overlayMenu = Color(0xFF4C4C4C),
        overlayViewer = Color(0xFF000000),
        uiChevron = Color(0xFFC8C8C8),
        uiSwipeRead = Color(0xFF1989FA),
        uiSwipeHide = Color(0xFFFA9D3B),
        uiMentionBg = Color(0xFFFFF1C7),
        uiMentionText = Color(0xFFE08A00),
        uiMentionBorder = Color(0xFFFFC44D),
        uiMenuLine = Color(0x33FFFFFF),
        uiPopupBg = Color(0xFFFFFFFF),
        uiPopupLine = Color(0xFFE5E5E5),
        uiPopupText = Color(0xFF181818),
        uiToastBg = Color(0xEA202020),
        uiTabLine = Color(0xFFD1D1D1),
        uiTabIcon = Color(0xFF191919),
        uiTimeDivider = Color(0xFF888888),
        uiSystemText = Color(0xFF999999),
        uiSearchPlaceholder = Color(0xFFC5C5C5),
        uiAvatarGroupFallback = Color(0xFFFF8800),
        uiMomentsSocialBg = Color(0xFFF3F3F3),
        uiMomentsNewMsgBg = Color(0xFF5F5F5F),
        uiRecordMask = Color(0xAD000000),
        uiRecordBubble = Color(0xFF91EF6D),
        uiRecordBubbleCancel = Color(0xFFEDEDED),
        uiRecordCancelText = Color(0xFFFF7A7A),
        uiRecordWave = Color(0x99333333),
        uiVoicePlaying = Color(0xFF1F7A32),
        uiVoiceError = Color(0xFFE84040),
        uiPullPanelBg = Color(0xFF2C2C2E),
        uiPending = Color(0xFFFFBB00),
        uiStar = Color(0xFFFFC300),
        uiButtonDisabledBg = Color(0xFFE1E1E1),
        uiButtonDisabledText = Color(0xFFBBBBBB),
        uiBrandDisabled = Color(0xFF9BE6BD),
        uiFrameWide = Color(0xFFF4F5F7)
    )
    val ModeDark = WbModeColors(
        statusSuccess = Color(0xFF07C160),
        statusSuccessSoft = Color(0xFF1E2A21),
        statusWarning = Color(0xFFC87D2F),
        statusWarningSoft = Color(0xFF4A3A12),
        statusWarningText = Color(0xFFE08A00),
        statusDanger = Color(0xFFFA5151),
        statusDangerSoft = Color(0x2EFA5151),
        statusInfo = Color(0xFF2782D7),
        statusInfoSoft = Color(0x2E2782D7),
        badgeUnread = Color(0xFFFA5151),
        badgeOnUnread = Color(0xFFFFFFFF),
        badgeMuted = Color(0xFFFA5151),
        amountIncome = Color(0xFF07C160),
        amountExpense = Color(0xCCFFFFFF),
        tintOrange = Color(0xFFFA9D3B),
        tintBlue = Color(0xFF2782D7),
        tintGold = Color(0xFFF6BE00),
        tintLilac = Color(0xFF7B61D9),
        tintPink = Color(0xFFFA5151),
        tintTeal = Color(0xFF07C160),
        tintGray = Color(0xFF8C8C8C),
        tintCyan = Color(0xFF10A8E5),
        tintIndigo = Color(0xFF6467F0),
        tintCoral = Color(0xFFF26B51),
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
        callBgTop = Color(0xFF1A1A1A),
        callBgBottom = Color(0xFF1A1A1A),
        callText = Color(0xFFFFFFFF),
        callTextSecondary = Color(0xB3FFFFFF),
        callAccept = Color(0xFF07C160),
        callDecline = Color(0xFFE64A45),
        callControl = Color(0x59000000),
        callControlActive = Color(0xFFFFFFFF),
        callControlIconActive = Color(0xFF111111),
        callAvatarOverlay = Color(0x8C000000),
        overlayMenu = Color(0xFF4C4C4C),
        overlayViewer = Color(0xFF000000),
        uiChevron = Color(0xFFC8C8C8),
        uiSwipeRead = Color(0xFF1989FA),
        uiSwipeHide = Color(0xFFC87D2F),
        uiMentionBg = Color(0xFF4A3A12),
        uiMentionText = Color(0xFFE08A00),
        uiMentionBorder = Color(0xFFFFC44D),
        uiMenuLine = Color(0x33FFFFFF),
        uiPopupBg = Color(0xFF2C2C2C),
        uiPopupLine = Color(0xFF3A3A3A),
        uiPopupText = Color(0xFFFFFFFF),
        uiToastBg = Color(0xEA202020),
        uiTabLine = Color(0x33FFFFFF),
        uiTabIcon = Color(0xFFEDEDED),
        uiTimeDivider = Color(0xFF8E8E93),
        uiSystemText = Color(0xFF999999),
        uiSearchPlaceholder = Color(0x4DFFFFFF),
        uiAvatarGroupFallback = Color(0xFFFF8800),
        uiMomentsSocialBg = Color(0xFF242426),
        uiMomentsNewMsgBg = Color(0xFF5F5F5F),
        uiRecordMask = Color(0xAD000000),
        uiRecordBubble = Color(0xFF91EF6D),
        uiRecordBubbleCancel = Color(0xFFEDEDED),
        uiRecordCancelText = Color(0xFFFF7A7A),
        uiRecordWave = Color(0x99333333),
        uiVoicePlaying = Color(0xFF1F7A32),
        uiVoiceError = Color(0xFFE84040),
        uiPullPanelBg = Color(0xFF2C2C2E),
        uiPending = Color(0xFFCC9C00),
        uiStar = Color(0xFFFFC300),
        uiButtonDisabledBg = Color(0xFF2C2C2C),
        uiButtonDisabledText = Color(0xFFBBBBBB),
        uiBrandDisabled = Color(0xFF9BE6BD),
        uiFrameWide = Color(0xFF111111)
    )
    fun theme(id: WbThemeId, dark: Boolean): WbThemeColors = when (id) {
        WbThemeId.Green -> if (dark) GreenDark else GreenLight
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
    val Logo = Color(0xFF07C160)
    val StickerBg = Color(0xFFFFFFFF)
    val StickerBorder = Color(0xFFFFB3CA)
    val StickerText = Color(0xFF1F1A1D)
    val StickerSubText = Color(0xFF655F63)
    val StickerInkBg = Color(0xFF1F1A1D)
    val StickerInkText = Color(0xFFFFFFFF)
}

/** 字号（sp，已随系统字体缩放；应用内字体大小设置再乘 WbFontScale） */
object WbFontSize {
    val Micro = 10.sp
    val Caption2 = 11.sp
    val Caption1 = 12.sp
    val Footnote = 13.sp
    val Subhead = 14.sp
    val Callout = 15.sp
    val BodySmall = 16.sp
    val Body = 17.sp
    val Headline = 17.sp
    val Title3 = 20.sp
    val Title2 = 22.sp
    val Title1 = 28.sp
    val Display = 40.sp
    val EmojiOnly = 40.sp
}
object WbLineHeight {
    const val Tight = 1.2f
    const val Normal = 1.35f
    const val Relaxed = 1.45f
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
    val Bubble = 8.dp
    val Md = 8.dp
    val Lg = 12.dp
    val Xl = 14.dp
    val Full = 999.dp
    const val AvatarRatio = 0.1f
}
object WbSize {
    val AdminMinWidth = 1200.dp
    val AdminContentMaxWidth = 1440.dp
    val TouchTarget = 40.dp
    val NavBar = 56.dp
    val TabBar = 56.dp
    val InputBarMin = 52.dp
    val ListRow = 72.dp
    val ContactRow = 56.dp
    val SettingRow = 56.dp
    val BubbleTail = 6.dp
    val ListIcon = 24.dp
    val GridIcon = 28.dp
    val GridCell = 58.dp
    val WalletCard = 128.dp
    val AvatarXs = 24.dp
    val AvatarSm = 28.dp
    val AvatarMd = 40.dp
    val AvatarLg = 48.dp
    val AvatarXl = 64.dp
    val AvatarXxl = 70.dp
    const val BubbleMaxWidthRatio = 0.68f
    val ImageMessageMax = 150.dp
    val ContentMaxWidth = 640.dp
    val SidebarWidth = 360.dp
    val TwoLineRow = 72.dp
    val GroupGap = 8.dp
    val GroupHeader = 35.7.dp
    val MiniAppIcon = 48.dp
    val CallAvatar = 168.dp
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
    const val MenuMs = 120
    const val FastMs = 160
    const val SwipeMs = 180
    const val BaseMs = 250
    const val PageMs = 300
    const val SlowMs = 420
    const val RecordWaveMs = 760
    const val VoiceWaveMs = 900
    const val TypingCycleMs = 1200
    const val RingCycleMs = 1800
    val Standard = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
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
