package app.weiban.designsystem

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.weiban.designsystem.tokens.WbSpace

/** 参照产品有、微伴用不上的入口（总经理要求都放上，点进去是统一的「暂未开放」页）。 */
data class ComingSoonItem(
    val name: String,
    val glyph: String,
    val tint: Tint,
)

/** 入口清单与网页 features/shell-kit.tsx 的 comingSoon 表一致。 */
object ComingSoon {
    val items: Map<String, ComingSoonItem> =
        linkedMapOf(
            "channels" to ComingSoonItem("视频号", "◎", Tint.Orange),
            "live" to ComingSoonItem("直播", "◉", Tint.Pink),
            "scan" to ComingSoonItem("扫一扫", "⌗", Tint.Blue),
            "listen" to ComingSoonItem("听书", "♫", Tint.Orange),
            "topstories" to ComingSoonItem("看一看", "◐", Tint.Gold),
            "games" to ComingSoonItem("游戏", "♟", Tint.Lilac),
            "qrcode" to ComingSoonItem("二维码名片", "▦", Tint.Gray),
            "cards" to ComingSoonItem("卡包", "▭", Tint.Blue),
            "pay" to ComingSoonItem("收付款", "¥", Tint.Teal),
            "status" to ComingSoonItem("状态", "☺", Tint.Gold),
            "tags" to ComingSoonItem("标签", "#", Tint.Blue),
            "official" to ComingSoonItem("公众号", "✉", Tint.Blue),
            "shop" to ComingSoonItem("购物", "⊞", Tint.Orange),
            "teen" to ComingSoonItem("青少年模式", "✓", Tint.Teal),
            "care" to ComingSoonItem("关怀模式", "♡", Tint.Pink),
            "plugins" to ComingSoonItem("插件", "✦", Tint.Lilac),
            "topics" to ComingSoonItem("话题", "#", Tint.Gray),
            "card" to ComingSoonItem("发送名片", "☷", Tint.Blue),
        )

    fun name(key: String): String = items[key]?.name ?: "这个功能"
}

/** 菜单里的「暂未开放」行。 */
@Composable fun ComingSoonRow(
    key: String,
    withIcon: Boolean = true,
    onOpen: (String) -> Unit,
) {
    val item = ComingSoon.items[key] ?: return
    MenuRow(item.name, if (withIcon) item.glyph else null, item.tint) { onOpen(key) }
}

/** 统一「暂未开放」页：图标 + 「XX 暂未开放」+ 一句说明 + 返回。 */
@Composable fun ComingSoonPage(
    key: String,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val item = ComingSoon.items[key]
    val name = item?.name ?: "这个功能"
    val colors = LocalWeibanColors.current
    Column(Modifier.fillMaxSize().background(colors.bgPage)) {
        WbNavBar(name, onBack)
        Column(
            Modifier.fillMaxWidth().padding(top = 96.dp, start = WbSpace.S7, end = WbSpace.S7),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(WbSpace.S5),
        ) {
            item?.let { IconTile(it.glyph, it.tint, 56.dp) }
            Text("${name}暂未开放", style = MaterialTheme.typography.headlineSmall)
            Text(
                "微伴还在长大，这个功能以后再见。先去和 TA 聊聊吧。",
                color = colors.textSecondary,
                textAlign = TextAlign.Center,
            )
            Button(onClick = onBack) { Text("返回") }
        }
    }
}

/** 气泡菜单（标题栏 ⊕ 等）。items: 名字 to 点击。 */
@Composable fun PopMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    items: List<Pair<String, () -> Unit>>,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        items.forEach { (label, action) ->
            DropdownMenuItem(text = { Text(label) }, onClick = {
                onDismiss()
                action()
            })
        }
    }
}

/** 底部弹层：标题 + 右上关闭 + 内容。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WbSheet(
    title: String?,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalWeibanColors.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = colors.bgPage, dragHandle = null) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = WbSpace.S5)) {
            if (title != null) {
                Box(Modifier.fillMaxWidth().padding(WbSpace.S5)) {
                    Text(title, Modifier.align(Alignment.Center), style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterEnd)) { Text("✕") }
                }
            }
            content()
        }
    }
}
