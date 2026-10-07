package app.weiban.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import app.weiban.designsystem.tokens.*

val LocalWeibanModeColors = staticCompositionLocalOf { WbColorSets.ModeLight }
val LocalWeibanColors = staticCompositionLocalOf { WbColorSets.GreenLight }

@Composable fun WeibanTheme(
    theme: String = "green",
    content: @Composable () -> Unit,
) {
    val dark = isSystemInDarkTheme()
    val colors = WbColorSets.theme(if (theme == "pink")WbThemeId.Pink else WbThemeId.Green, dark)
    val scheme =
        if (dark) {
            darkColorScheme(
                primary = colors.brandPrimary,
                onPrimary = colors.textOnBrand,
                background = colors.bgPage,
                onBackground = colors.textPrimary,
                surface = colors.bgSurface,
                onSurface = colors.textPrimary,
                onSurfaceVariant = colors.textSecondary,
                surfaceVariant = colors.bgInputField,
                primaryContainer = colors.brandSoft,
                onPrimaryContainer = colors.brandOnSoft,
                secondary = colors.brandAccent,
                onSecondary = colors.textOnBrand,
                secondaryContainer = colors.brandSoft,
                onSecondaryContainer = colors.brandOnSoft,
                outline = colors.borderStrong,
                outlineVariant = colors.borderHairline,
                scrim = colors.bgScrim,
                error = colors.textDanger,
            )
        } else {
            lightColorScheme(
                primary = colors.brandPrimary,
                onPrimary = colors.textOnBrand,
                background = colors.bgPage,
                onBackground = colors.textPrimary,
                surface = colors.bgSurface,
                onSurface = colors.textPrimary,
                onSurfaceVariant = colors.textSecondary,
                surfaceVariant = colors.bgInputField,
                primaryContainer = colors.brandSoft,
                onPrimaryContainer = colors.brandOnSoft,
                secondary = colors.brandAccent,
                onSecondary = colors.textOnBrand,
                secondaryContainer = colors.brandSoft,
                onSecondaryContainer = colors.brandOnSoft,
                outline = colors.borderStrong,
                outlineVariant = colors.borderHairline,
                scrim = colors.bgScrim,
                error = colors.textDanger,
            )
        }
    CompositionLocalProvider(
        LocalWeibanColors provides colors,
        LocalWeibanModeColors provides if (dark) WbColorSets.ModeDark else WbColorSets.ModeLight,
    ) {
        MaterialTheme(colorScheme = scheme, typography = typography, shapes = shapes, content = content)
    }
}

private fun style(
    size: TextUnit,
    weight: FontWeight = WbFontWeight.Regular,
) = TextStyle(
    fontFamily = FontFamily.Default,
    fontSize = size,
    lineHeight = size * WbLineHeight.Normal,
    fontWeight = weight,
)

private val typography =
    Typography(
        displayLarge = style(WbFontSize.Display, WbFontWeight.Bold),
        displayMedium = style(WbFontSize.Display, WbFontWeight.Bold),
        displaySmall = style(WbFontSize.Title1, WbFontWeight.Bold),
        headlineLarge = style(WbFontSize.Title1, WbFontWeight.Semibold),
        headlineMedium = style(WbFontSize.Title2, WbFontWeight.Semibold),
        headlineSmall = style(WbFontSize.Title3, WbFontWeight.Semibold),
        titleLarge = style(WbFontSize.Title3, WbFontWeight.Medium),
        titleMedium = style(WbFontSize.Headline, WbFontWeight.Semibold),
        titleSmall = style(WbFontSize.Subhead, WbFontWeight.Medium),
        bodyLarge = style(WbFontSize.Body),
        bodyMedium = style(WbFontSize.Callout),
        bodySmall = style(WbFontSize.Footnote),
        labelLarge = style(WbFontSize.Subhead, WbFontWeight.Medium),
        labelMedium = style(WbFontSize.Caption1, WbFontWeight.Medium),
        labelSmall = style(WbFontSize.Caption2),
    )
private val shapes =
    Shapes(
        extraSmall = RoundedCornerShape(WbRadius.Xs),
        small = RoundedCornerShape(WbRadius.Sm),
        medium = RoundedCornerShape(WbRadius.Md),
        large = RoundedCornerShape(WbRadius.Lg),
        extraLarge = RoundedCornerShape(WbRadius.Lg),
    )
