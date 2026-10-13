package app.weiban.designsystem

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace

/*
 * 换壳通用部件（docs/refactor/02 第 3、4 节；网页 features/shell-kit.tsx 为参照）：
 * 标题栏、菜单分组与菜单行、图标方块、「暂未开放」页。只用现有令牌，不新增令牌。
 */

/** 统一标题栏：左「‹」返回（可无），中间标题，右侧操作。 */
@Composable fun WbNavBar(
    title: String,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = LocalWeibanColors.current
    Box(Modifier.fillMaxWidth().height(WbSize.NavBar + WbSpace.S2).background(colors.bgNavBar)) {
        Text(
            title,
            Modifier.align(Alignment.Center).padding(horizontal = 96.dp),
            style = MaterialTheme.typography.titleMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (onBack != null) {
            Text(
                "‹",
                Modifier
                    .align(Alignment.CenterStart)
                    .clickable(onClick = onBack)
                    .padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
                style = MaterialTheme.typography.headlineMedium,
            )
        }
        Row(
            Modifier.align(Alignment.CenterEnd).padding(end = WbSpace.S3),
            verticalAlignment = Alignment.CenterVertically,
            content = actions,
        )
    }
}

/** 标题栏右侧的文字 / 符号按钮。 */
@Composable fun NavAction(
    text: String,
    onClick: () -> Unit,
) {
    Text(
        text,
        Modifier.clip(RoundedCornerShape(WbRadius.Sm)).clickable(onClick = onClick).padding(WbSpace.S3),
        style = MaterialTheme.typography.titleLarge,
    )
}

/** 圆角方块图标（56 / 32 两档）：点缀色铺底 + 白色符号。 */
@Composable fun IconTile(
    glyph: String,
    tint: Tint,
    size: Dp = 32.dp,
) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(if (size > 40.dp) WbRadius.Md else WbRadius.Sm)).background(tintColor(tint)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            glyph,
            color = Color.White,
            style = if (size > 40.dp) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.titleMedium,
        )
    }
}

/** 菜单分组：分组之间留间隔，组内白底。 */
@Composable fun MenuGroup(
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalWeibanColors.current
    Spacer(Modifier.height(WbSpace.S3))
    title?.let {
        Text(
            it,
            Modifier.padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
            style = MaterialTheme.typography.bodySmall,
            color = colors.textSecondary,
        )
    }
    Column(Modifier.fillMaxWidth().background(colors.bgSurface), content = content)
}

/** 菜单行：图标方块 + 名字 + 右侧值 / 红点 + 「›」。onClick 为空时不显示箭头。 */
@Composable fun MenuRow(
    label: String,
    glyph: String? = null,
    tint: Tint = Tint.Gray,
    value: String? = null,
    dot: Boolean = false,
    danger: Boolean = false,
    enabled: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    val colors = LocalWeibanColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = WbSize.SettingRow)
            .then(if (onClick != null) Modifier.clickable(enabled = enabled, onClick = onClick) else Modifier)
            .padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S4),
    ) {
        glyph?.let { IconTile(it, tint) }
        Text(
            label,
            Modifier.weight(1f),
            color = if (danger) colors.textDanger else colors.textPrimary,
            textAlign = if (danger && glyph == null && value == null) TextAlign.Center else TextAlign.Start,
            style = MaterialTheme.typography.bodyLarge,
        )
        value?.let { Text(it, color = colors.textSecondary, style = MaterialTheme.typography.bodyMedium, maxLines = 1) }
        if (dot) RedDotMark()
        trailing?.invoke()
        if (onClick != null && trailing == null &&
            !danger
        ) {
            Text("›", color = colors.textTertiary, style = MaterialTheme.typography.titleLarge)
        }
    }
    HorizontalDivider(Modifier.padding(start = if (glyph != null) 64.dp else WbSpace.S5), color = colors.borderHairline)
}

/** 菜单里的开关行。 */
@Composable fun MenuSwitchRow(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    onChange: (Boolean) -> Unit,
) {
    MenuRow(label, trailing = { Switch(checked, onChange, enabled = enabled) })
}

/** 未读红点。 */
@Composable fun RedDotMark() {
    Box(Modifier.size(WbSpace.S3).clip(CircleShape).background(LocalWeibanModeColors.current.badgeUnread))
}

/** 带标题栏、可滚动的二级页骨架（系统返回 = onBack）。 */
@Composable fun ShellPage(
    title: String,
    onBack: () -> Unit,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(LocalWeibanColors.current.bgPage)) {
        WbNavBar(title, onBack, actions)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = WbSpace.S8), content = content)
    }
}
