package app.weiban.feature.me

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.contracts.Endpoints
import app.weiban.core.designsystem.R as DsR
import app.weiban.data.DeviceNotificationControls
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.MenuSwitchRow
import app.weiban.designsystem.WbPoints
import app.weiban.designsystem.wbText
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 我 › 服务（规格 4.9「服务页」）：纯菜单列表——钱包（积分 · 模型）｜ 模型与花费（积分明细 · 价目表 · 模型排行榜 · 后台预算）｜
 * 偏好（主动消息与免打扰 · 聊天偏好 · 熟悉度总览）。
 */
@Composable internal fun MeServices(
    state: MeState,
    entry: MeEntry = MeEntry(),
) {
    val mode = LocalWeibanModeColors.current
    val colors = LocalWeibanColors.current
    LaunchedEffect(state.owner) {
        if (state.selection == null || state.models.isEmpty()) {
            state.perform {
                state.models = state.call(Endpoints.modelAccessEndpointsListModels).items
                state.selection = state.call(Endpoints.modelAccessEndpointsGetSelection)
            }
        }
    }
    val chatKey = state.selection?.chat?.modelKey
    val chatModel = if (chatKey == null) "平台默认" else state.models.find { it.modelKey == chatKey }?.displayName ?: chatKey
    MenuGroup {
        MenuRow("积分", icon = DsR.drawable.wb_membership, iconSize = 23.dp, value = state.wallet?.let { WbPoints.text(it.availablePoints) }) {
            state.openPage("wallet")
        }
        MenuRow("模型", icon = DsR.drawable.wb_grid, iconTint = mode.tintBlue, value = chatModel) { state.openPage("models") }
    }
    MenuGroup {
        MenuRow("积分明细", icon = DsR.drawable.wb_note, iconTint = mode.tintOrange) { state.openPage("ledger") }
        MenuRow("价目表", icon = DsR.drawable.wb_tag, iconTint = colors.brandPrimary) { state.openPage("prices") }
        MenuRow("模型排行榜", icon = DsR.drawable.wb_star, iconTint = mode.tintGold) { state.openPage("leaderboard") }
        MenuRow("后台预算", icon = DsR.drawable.wb_bell, iconTint = mode.tintCyan) { state.openPage("usage") }
    }
    MenuGroup {
        MenuRow("主动消息与免打扰", icon = DsR.drawable.wb_chat, iconTint = colors.brandPrimary) { state.openPage("proactive") }
        MenuRow("聊天偏好", icon = DsR.drawable.wb_smile, iconTint = mode.tintGold) { state.openPage("general") }
        entry.onGrowth?.let { open -> MenuRow("熟悉度总览", icon = DsR.drawable.wb_heart, iconTint = mode.tintPink) { open("familiarity") } }
    }
}

/** 新消息通知（规格 4.10「通知」子页）：本设备推送 ｜ 声音 · 通知显示消息内容 ｜ 免打扰时段。 */
@Composable internal fun NotificationSettingsPage(
    state: MeState,
    controls: DeviceNotificationControls?,
) {
    val colors = LocalWeibanColors.current
    MenuGroup("本设备") {
        MenuRow(controls?.status ?: "此设备暂不支持消息通知")
        if (controls != null) {
            MenuRow(if (controls.enabled) "重新连接" else "开启通知", enabled = controls.available && !controls.busy, onClick = controls.enable)
            if (controls.enabled) MenuRow("关闭通知", enabled = !controls.busy, onClick = controls.disable)
        }
        controls?.systemSettings?.let { open -> MenuRow("系统通知设置", onClick = open) }
    }
    state.notificationSettings?.let { settings ->
        MenuGroup("提醒方式") {
            MenuSwitchRow("声音", settings.pushSoundEnabled, !state.busy) { enabled ->
                state.perform {
                    state.notificationSettings =
                        state.call(Endpoints.identityEndpointsUpdateNotificationSettings, buildJsonObject { put("pushSoundEnabled", enabled) })
                }
            }
            MenuSwitchRow("通知显示消息内容", settings.pushShowContent, !state.busy, subtitle = "关闭后，通知只显示新消息提醒") { enabled ->
                state.perform {
                    state.notificationSettings =
                        state.call(Endpoints.identityEndpointsUpdateNotificationSettings, buildJsonObject { put("pushShowContent", enabled) })
                }
            }
        }
        QuietHoursSettings(state)
    }
    if (state.notificationSettings == null) {
        Text("正在读取…", Modifier.padding(16.dp), style = wbText(14.sp, color = colors.textSecondary))
    }
}

@Composable private fun QuietHoursSettings(state: MeState) {
    val quiet = state.notificationSettings?.doNotDisturb ?: return
    var start by remember(quiet.start) { mutableStateOf(quiet.start) }
    var end by remember(quiet.end) { mutableStateOf(quiet.end) }
    val valid = Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")

    fun save(
        enabled: Boolean,
        from: String,
        until: String,
    ) {
        state.perform {
            state.notificationSettings =
                state.call(
                    Endpoints.identityEndpointsUpdateNotificationSettings,
                    buildJsonObject {
                        put(
                            "doNotDisturb",
                            buildJsonObject {
                                put("enabled", enabled)
                                put("start", from)
                                put("end", until)
                            },
                        )
                    },
                )
        }
    }
    val timesValid = valid.matches(start) && valid.matches(end)
    MenuGroup("免打扰时段") {
        MenuSwitchRow("免打扰时段", quiet.enabled, !state.busy, subtitle = "按账号时区执行；开始与结束相同时全天静音") {
            save(it, quiet.start, quiet.end)
        }
        TimeRow("开始时间", start, !state.busy) { start = it.take(5) }
        TimeRow("结束时间", end, !state.busy) { end = it.take(5) }
        MenuRow(
            if (timesValid) "保存时段" else "请填写 24 小时制时间，例如 22:00",
            enabled = !state.busy && timesValid,
        ) { save(quiet.enabled, start, end) }
    }
}

@Composable private fun TimeRow(
    label: String,
    value: String,
    enabled: Boolean,
    onChange: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = wbText(17.sp, color = colors.textPrimary))
        BasicTextField(
            value,
            onChange,
            Modifier.width(80.dp).background(colors.bgPage, RoundedCornerShape(6.dp)).padding(horizontal = 10.dp, vertical = 6.dp),
            enabled = enabled,
            singleLine = true,
            textStyle = wbText(16.sp, color = colors.textPrimary),
            cursorBrush = SolidColor(colors.brandPrimary),
        )
    }
    Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).background(colors.borderHairline))
}
