package app.weiban.designsystem

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.weiban.core.designsystem.R

/** 参照产品有、微伴用不上的入口（总经理要求都放上，点了弹轻提示「XX暂未开放」，规格第 8 节）。 */
data class ComingSoonItem(
    val name: String,
    val glyph: String,
    val tint: Tint,
    val icon: Int,
)

/** 入口清单与网页 features/shell-kit.tsx 的 comingSoon 表一致。 */
object ComingSoon {
    val items: Map<String, ComingSoonItem> =
        linkedMapOf(
            "channels" to ComingSoonItem("视频号", "◎", Tint.Orange, R.drawable.wb_finder),
            "live" to ComingSoonItem("直播", "◉", Tint.Pink, R.drawable.wb_color_live),
            "scan" to ComingSoonItem("扫一扫", "⌗", Tint.Blue, R.drawable.wb_discover_scan),
            "listen" to ComingSoonItem("听一听", "♫", Tint.Orange, R.drawable.wb_discover_listen),
            "topstories" to ComingSoonItem("看一看", "◐", Tint.Gold, R.drawable.wb_color_look),
            "shake" to ComingSoonItem("摇一摇", "◌", Tint.Blue, R.drawable.wb_color_shake),
            "games" to ComingSoonItem("游戏", "♟", Tint.Lilac, R.drawable.wb_color_game),
            "qrcode" to ComingSoonItem("二维码名片", "▦", Tint.Gray, R.drawable.wb_grid),
            "cards" to ComingSoonItem("卡包", "▭", Tint.Blue, R.drawable.wb_drawn_cards),
            "pay" to ComingSoonItem("收付款", "¥", Tint.Teal, R.drawable.wb_transfer),
            "status" to ComingSoonItem("状态", "☺", Tint.Gold, R.drawable.wb_smile),
            "tags" to ComingSoonItem("标签", "#", Tint.Blue, R.drawable.wb_tag),
            "official" to ComingSoonItem("公众号", "✉", Tint.Blue, R.drawable.wb_contacts_official),
            "shop" to ComingSoonItem("购物", "⊞", Tint.Orange, R.drawable.wb_store),
            "teen" to ComingSoonItem("青少年模式", "✓", Tint.Teal, R.drawable.wb_info),
            "care" to ComingSoonItem("关怀模式", "♡", Tint.Pink, R.drawable.wb_heart),
            "plugins" to ComingSoonItem("插件", "✦", Tint.Lilac, R.drawable.wb_grid),
            "topics" to ComingSoonItem("话题", "#", Tint.Gray, R.drawable.wb_tag),
            "card" to ComingSoonItem("发送名片", "☷", Tint.Blue, R.drawable.wb_person),
            "background" to ComingSoonItem("聊天背景", "▦", Tint.Gray, R.drawable.wb_picture),
            "forward" to ComingSoonItem("转发", "↗", Tint.Gray, R.drawable.wb_share),
        )

    fun name(key: String): String = items[key]?.name ?: "这个功能"

    /** 轻提示「XX暂未开放」（不跳页）。 */
    fun notice(key: String) = WbToast.show("${name(key)}暂未开放", ToastKind.Info)
}

/** 菜单里的「暂未开放」行：右侧值「暂未开放」，点了弹轻提示。 */
@Suppress("UNUSED_PARAMETER") // 旧调用处传入的跳页回调保留签名；按规格改为轻提示。
@Composable
fun ComingSoonRow(
    key: String,
    withIcon: Boolean = true,
    onOpen: (String) -> Unit = {},
) {
    val item = ComingSoon.items[key] ?: return
    MenuRow(
        item.name,
        icon = if (withIcon) item.icon else null,
        iconTint = if (withIcon) tintColor(item.tint) else null,
        value = "暂未开放",
    ) { ComingSoon.notice(key) }
}

/** 统一「暂未开放」页（外部链接 / 推送仍可能进来）：空状态 + 返回。 */
@Composable fun ComingSoonPage(
    key: String,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val name = ComingSoon.name(key)
    Column(Modifier.fillMaxSize().background(LocalWeibanColors.current.bgPage)) {
        WbNavBar(name, onBack)
        EmptyState(
            "${name}暂未开放",
            ComingSoon.items[key]?.icon ?: R.drawable.wb_info,
            "微伴还在长大，这个功能以后再见。先去和 TA 聊聊吧。",
            "返回",
            onAction = onBack,
        )
    }
}
